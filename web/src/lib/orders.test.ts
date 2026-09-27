import { describe, expect, it } from 'vitest';
import { summarizeOrders, type OrderEvent } from './orders';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const tx = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as `0x${string}`;

describe('summarizeOrders', () => {
  it('builds active, filled, cancelled and withdrawn orders from events', () => {
    const events: OrderEvent[] = [
      { type: 'Place', orderId: 1n, owner: OWNER, tickLower: 173220, liquidity: 100n, blockNumber: 10n, txHash: tx(1) },
      { type: 'Place', orderId: 1n, owner: OWNER, tickLower: 173220, liquidity: 50n, blockNumber: 11n, txHash: tx(2) },
      { type: 'Place', orderId: 2n, owner: OWNER, tickLower: 173100, liquidity: 70n, blockNumber: 12n, txHash: tx(3) },
      { type: 'Fill', orderId: 2n, tickLower: 173100, blockNumber: 13n, txHash: tx(4) },
      { type: 'Place', orderId: 3n, owner: OWNER, tickLower: 172980, liquidity: 10n, blockNumber: 14n, txHash: tx(5) },
      { type: 'Cancel', orderId: 3n, owner: OWNER, tickLower: 172980, liquidity: 10n, blockNumber: 15n, txHash: tx(6) },
      { type: 'Place', orderId: 4n, owner: OWNER, tickLower: 172920, liquidity: 5n, blockNumber: 16n, txHash: tx(7) },
      { type: 'Fill', orderId: 4n, tickLower: 172920, blockNumber: 17n, txHash: tx(8) },
      { type: 'Withdraw', orderId: 4n, owner: OWNER, liquidity: 5n, blockNumber: 18n, txHash: tx(9) },
    ];
    const s = summarizeOrders(events, OWNER);
    expect(s.map((o) => [o.orderId, o.status, o.placed, o.tickLower])).toEqual([
      [4n, 'withdrawn', 5n, 172920],
      [3n, 'cancelled', 10n, 172980],
      [2n, 'filled', 70n, 173100],
      [1n, 'active', 150n, 173220],
    ]);
  });

  it('ignores other owners and shared fills without a matching place', () => {
    const events: OrderEvent[] = [
      { type: 'Place', orderId: 9n, owner: OTHER, tickLower: 173220, liquidity: 100n, blockNumber: 10n, txHash: tx(1) },
      { type: 'Fill', orderId: 9n, tickLower: 173220, blockNumber: 11n, txHash: tx(2) },
    ];
    expect(summarizeOrders(events, OWNER)).toEqual([]);
  });

  it('is case-insensitive on the owner address', () => {
    const events: OrderEvent[] = [{ type: 'Place', orderId: 1n, owner: OWNER.toUpperCase().replace('0X', '0x') as any, tickLower: 173220, liquidity: 1n, blockNumber: 1n, txHash: tx(1) }];
    expect(summarizeOrders(events, OWNER)).toHaveLength(1);
  });
});
