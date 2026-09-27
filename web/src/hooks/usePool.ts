import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { REFRESH_INTERVAL_MS } from '../config';
import { stateViewAbi } from '../lib/pool';
import { floorToSpacing } from '../lib/tick';
import { useDeployment } from './useDeployment';

export interface PoolState {
  sqrtPriceX96: bigint;
  tick: number;
  /** Lower boundary of the current 60-tick range. */
  currentRange: number;
  lpFee: number;
  liquidity: bigint;
  tickLowerLast: number;
  fetchedAt: number;
}

/** Live pool state from StateView and the hook, refreshed on an interval. */
export function usePoolState() {
  const client = usePublicClient();
  const { network, hook, poolId, poolKey } = useDeployment();
  return useQuery<PoolState>({
    queryKey: ['pool', poolId],
    enabled: !!client,
    refetchInterval: REFRESH_INTERVAL_MS,
    queryFn: async () => {
      if (!client) throw new Error('No RPC client');
      const stateView = network.uniswapV4.stateView;
      const [slot0, liquidity, tickLowerLast] = await Promise.all([
        client.readContract({ address: stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] }),
        client.readContract({ address: stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId] }),
        client.readContract({ address: hook.address, abi: hook.abi, functionName: 'getTickLowerLast', args: [poolId] }) as Promise<number>,
      ]);
      const [sqrtPriceX96, tick, , lpFee] = slot0;
      return {
        sqrtPriceX96,
        tick,
        currentRange: floorToSpacing(tick, poolKey.tickSpacing),
        lpFee,
        liquidity,
        tickLowerLast,
        fetchedAt: Date.now(),
      };
    },
  });
}

/** Owner's TKPF balance and allowance for the hook. */
export function useTokenAccount(owner: Address | undefined) {
  const client = usePublicClient();
  const { token, hook } = useDeployment();
  return useQuery({
    queryKey: ['tokenAccount', owner],
    enabled: !!client && !!owner,
    refetchInterval: REFRESH_INTERVAL_MS,
    queryFn: async () => {
      if (!client || !owner) throw new Error('No RPC client');
      const [balance, allowance] = await Promise.all([
        client.readContract({ address: token.address, abi: token.abi, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>,
        client.readContract({ address: token.address, abi: token.abi, functionName: 'allowance', args: [owner, hook.address] }) as Promise<bigint>,
      ]);
      return { balance, allowance };
    },
  });
}
