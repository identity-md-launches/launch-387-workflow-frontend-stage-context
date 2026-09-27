import { useCallback, useState } from 'react';
import { useAccount, useConnect, useConnectors, useDisconnect } from 'wagmi';
import type { EIP1193Provider } from 'viem';
import { ensureWalletChain } from '../lib/chain';
import { describeError } from '../lib/errors';
import { useDeployment } from './useDeployment';

/** Wallet connection, chain check and the switch/add-chain flow. */
export function useWallet() {
  const { network } = useDeployment();
  const account = useAccount();
  const connectors = useConnectors();
  const { connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  const hasBrowserWallet =
    typeof window !== 'undefined' && (!!(window as any).ethereum || connectors.some((c) => c.id !== 'injected'));
  const isConnected = account.status === 'connected';
  const onRightChain = isConnected && account.chainId === network.chainId;

  const connect = useCallback(
    async (connectorId?: string) => {
      setError(null);
      const connector = connectors.find((c) => c.id === connectorId) ?? connectors[0];
      if (!connector) return;
      try {
        await connectAsync({ connector });
      } catch (err) {
        setError(describeError(err));
      }
    },
    [connectAsync, connectors],
  );

  const switchToNetwork = useCallback(async () => {
    if (!account.connector) return;
    setError(null);
    setSwitching(true);
    try {
      const provider = (await account.connector.getProvider()) as EIP1193Provider;
      await ensureWalletChain(provider, network);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSwitching(false);
    }
  }, [account.connector, network]);

  return {
    account,
    address: account.address,
    connectors,
    hasBrowserWallet,
    isConnected,
    onRightChain,
    connecting,
    switching,
    error,
    connect,
    disconnect: () => disconnect(),
    switchToNetwork,
  };
}
