import { useCallback, useRef, useState } from 'react';
import { useConfig, usePublicClient } from 'wagmi';
import { getWalletClient } from '@wagmi/core';
import type { Abi, Address, Hex } from 'viem';
import { describeError } from '../lib/errors';
import { useDeployment } from './useDeployment';

export type ActionPhase = 'idle' | 'simulating' | 'wallet' | 'pending' | 'confirmed' | 'error';

export interface ActionState {
  phase: ActionPhase;
  hash?: Hex;
  message?: string;
  /** Decoded simulation result, when the function returns something. */
  result?: unknown;
}

export interface ActionRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

/**
 * Runs one contract write: simulate (revert reason surfaced before the wallet
 * opens) → sign in wallet → wait for the receipt. `onConfirmed` refetches.
 *
 * The wallet client is resolved at execution time with `getWalletClient` for
 * the manifest chain. wagmi's cached `useWalletClient` query is keyed on the
 * configured chain and does not refetch after the wallet switches networks,
 * which left it in an error state after the add-chain flow.
 */
export function useContractAction(onConfirmed?: () => void) {
  const config = useConfig();
  const publicClient = usePublicClient();
  const { network } = useDeployment();
  const [state, setState] = useState<ActionState>({ phase: 'idle' });
  const running = useRef(false);

  const execute = useCallback(
    async (req: ActionRequest) => {
      if (running.current) return;
      if (!publicClient) {
        setState({ phase: 'error', message: 'No RPC client is available.' });
        return;
      }
      running.current = true;
      try {
        let walletClient;
        try {
          walletClient = await getWalletClient(config, { chainId: network.chainId });
        } catch {
          setState({ phase: 'error', message: `Connect a wallet on ${network.name} first.` });
          return;
        }
        setState({ phase: 'simulating' });
        const sim = await publicClient.simulateContract({
          account: walletClient.account,
          address: req.address,
          abi: req.abi,
          functionName: req.functionName,
          args: req.args as any,
          value: req.value,
        } as any);
        setState({ phase: 'wallet', result: sim.result });
        const hash = await walletClient.writeContract(sim.request as any);
        setState({ phase: 'pending', hash, result: sim.result });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
          setState({ phase: 'error', hash, message: 'The transaction reverted on chain.' });
          return;
        }
        setState({ phase: 'confirmed', hash, result: sim.result });
        onConfirmed?.();
      } catch (err) {
        setState({ phase: 'error', message: describeError(err) });
      } finally {
        running.current = false;
      }
    },
    [config, publicClient, network, onConfirmed],
  );

  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, execute, reset, busy: state.phase === 'simulating' || state.phase === 'wallet' || state.phase === 'pending' };
}
