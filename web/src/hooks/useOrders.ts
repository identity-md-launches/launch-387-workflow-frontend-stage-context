import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { getAbiItem, type Address, type Log, type PublicClient } from 'viem';
import { LOG_FROM_BLOCK, REFRESH_INTERVAL_MS } from '../config';
import { summarizeOrders, type OrderEvent, type OrderSummary } from '../lib/orders';
import { useDeployment } from './useDeployment';

export interface OrderView extends OrderSummary {
  /** Owner liquidity still recorded on chain (0 after cancel or withdraw). */
  remaining: bigint;
  /** On-chain filled flag. */
  filledOnChain: boolean;
  currency0Total: bigint;
  currency1Total: bigint;
  liquidityTotal: bigint;
}

const MIN_CHUNK = 2_000n;

/** getLogs over a range, halving the range when the RPC refuses it. */
async function getLogsChunked(
  client: PublicClient,
  params: { address: Address; event: any; args?: any },
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Log[]> {
  try {
    return await client.getLogs({ ...params, fromBlock, toBlock, strict: true } as any);
  } catch (err) {
    if (toBlock - fromBlock < MIN_CHUNK) throw err;
    const mid = fromBlock + (toBlock - fromBlock) / 2n;
    const [a, b] = await Promise.all([
      getLogsChunked(client, params, fromBlock, mid),
      getLogsChunked(client, params, mid + 1n, toBlock),
    ]);
    return [...a, ...b];
  }
}

/** Fetch the owner's orders from hook events, then confirm each with hook views. */
export async function fetchOrders(client: PublicClient, hook: { address: Address; abi: any }, owner: Address): Promise<OrderView[]> {
  const toBlock = await client.getBlockNumber();
  const ev = (name: string) => getAbiItem({ abi: hook.abi, name });
  const [place, cancel, withdraw, fill] = await Promise.all([
    getLogsChunked(client, { address: hook.address, event: ev('Place'), args: { owner } }, LOG_FROM_BLOCK, toBlock),
    getLogsChunked(client, { address: hook.address, event: ev('Cancel'), args: { owner } }, LOG_FROM_BLOCK, toBlock),
    getLogsChunked(client, { address: hook.address, event: ev('Withdraw'), args: { owner } }, LOG_FROM_BLOCK, toBlock),
    getLogsChunked(client, { address: hook.address, event: ev('Fill') }, LOG_FROM_BLOCK, toBlock),
  ]);
  const events: OrderEvent[] = [];
  for (const l of place as any[]) {
    events.push({ type: 'Place', orderId: l.args.orderId, owner: l.args.owner, tickLower: l.args.tickLower, liquidity: l.args.liquidity, blockNumber: l.blockNumber, txHash: l.transactionHash });
  }
  for (const l of cancel as any[]) {
    events.push({ type: 'Cancel', orderId: l.args.orderId, owner: l.args.owner, tickLower: l.args.tickLower, liquidity: l.args.liquidity, blockNumber: l.blockNumber, txHash: l.transactionHash });
  }
  for (const l of withdraw as any[]) {
    events.push({ type: 'Withdraw', orderId: l.args.orderId, owner: l.args.owner, liquidity: l.args.liquidity, blockNumber: l.blockNumber, txHash: l.transactionHash });
  }
  for (const l of fill as any[]) {
    events.push({ type: 'Fill', orderId: l.args.orderId, tickLower: l.args.tickLower, blockNumber: l.blockNumber, txHash: l.transactionHash });
  }
  const summaries = summarizeOrders(events, owner);
  return Promise.all(
    summaries.map(async (s) => {
      const [remaining, info] = await Promise.all([
        client.readContract({ address: hook.address, abi: hook.abi, functionName: 'getOrderLiquidity', args: [s.orderId, owner] }) as Promise<bigint>,
        client.readContract({ address: hook.address, abi: hook.abi, functionName: 'getOrderInfo', args: [s.orderId] }) as Promise<
          readonly [boolean, Address, Address, bigint, bigint, bigint]
        >,
      ]);
      const [filledOnChain, , , currency0Total, currency1Total, liquidityTotal] = info;
      let status = s.status;
      // On-chain state is final: an order with no remaining liquidity is done.
      if (remaining === 0n && status === 'active') status = 'cancelled';
      if (remaining === 0n && status === 'filled') status = 'withdrawn';
      if (remaining > 0n && filledOnChain) status = 'filled';
      if (remaining > 0n && !filledOnChain) status = 'active';
      return { ...s, status, remaining, filledOnChain, currency0Total, currency1Total, liquidityTotal };
    }),
  );
}

export function useOrders(owner: Address | undefined) {
  const client = usePublicClient();
  const { hook } = useDeployment();
  return useQuery<OrderView[]>({
    queryKey: ['orders', owner, hook.address],
    enabled: !!client && !!owner,
    refetchInterval: REFRESH_INTERVAL_MS * 2,
    queryFn: () => fetchOrders(client as PublicClient, hook, owner as Address),
  });
}
