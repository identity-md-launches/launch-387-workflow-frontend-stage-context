import type { Address, Hex } from 'viem';

/** Decoded hook events relevant to one owner. */
export type OrderEvent =
  | { type: 'Place'; orderId: bigint; owner: Address; tickLower: number; liquidity: bigint; blockNumber: bigint; txHash: Hex }
  | { type: 'Cancel'; orderId: bigint; owner: Address; tickLower: number; liquidity: bigint; blockNumber: bigint; txHash: Hex }
  | { type: 'Withdraw'; orderId: bigint; owner: Address; liquidity: bigint; blockNumber: bigint; txHash: Hex }
  | { type: 'Fill'; orderId: bigint; tickLower: number; blockNumber: bigint; txHash: Hex };

export type OrderStatus = 'active' | 'filled' | 'withdrawn' | 'cancelled';

export interface OrderSummary {
  orderId: bigint;
  tickLower: number;
  /** Sum of the owner's Place liquidity. */
  placed: bigint;
  cancelled: bigint;
  withdrawn: bigint;
  /** Status derived from events; confirm with `getOrderLiquidity`. */
  status: OrderStatus;
  filledAt?: bigint;
  firstBlock: bigint;
  lastTxHash: Hex;
}

/** Reduce an owner's Place/Cancel/Withdraw plus shared Fill events. */
export function summarizeOrders(events: OrderEvent[], owner: Address): OrderSummary[] {
  const byId = new Map<string, OrderSummary>();
  const sorted = [...events].sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
  const lower = owner.toLowerCase();
  for (const ev of sorted) {
    const key = ev.orderId.toString();
    if (ev.type === 'Fill') {
      const o = byId.get(key);
      if (o) {
        o.filledAt = ev.blockNumber;
        o.lastTxHash = ev.txHash;
      }
      continue;
    }
    if (ev.owner.toLowerCase() !== lower) continue;
    let o = byId.get(key);
    if (!o) {
      o = {
        orderId: ev.orderId,
        tickLower: ev.type === 'Withdraw' ? NaN : ev.tickLower,
        placed: 0n,
        cancelled: 0n,
        withdrawn: 0n,
        status: 'active',
        firstBlock: ev.blockNumber,
        lastTxHash: ev.txHash,
      };
      byId.set(key, o);
    }
    if (ev.type === 'Place') o.placed += ev.liquidity;
    if (ev.type === 'Cancel') o.cancelled += ev.liquidity;
    if (ev.type === 'Withdraw') o.withdrawn += ev.liquidity;
    if (Number.isNaN(o.tickLower) && ev.type !== 'Withdraw') o.tickLower = ev.tickLower;
    o.lastTxHash = ev.txHash;
  }
  // Fill events that arrived before a Place in block order cannot apply; re-scan for fills.
  for (const ev of sorted) {
    if (ev.type === 'Fill') {
      const o = byId.get(ev.orderId.toString());
      if (o && o.filledAt === undefined) o.filledAt = ev.blockNumber;
    }
  }
  for (const o of byId.values()) {
    if (o.withdrawn > 0n) o.status = 'withdrawn';
    else if (o.filledAt !== undefined) o.status = 'filled';
    else if (o.cancelled >= o.placed) o.status = 'cancelled';
    else o.status = 'active';
  }
  return [...byId.values()].sort((a, b) => (a.firstBlock < b.firstBlock ? 1 : a.firstBlock > b.firstBlock ? -1 : 0));
}
