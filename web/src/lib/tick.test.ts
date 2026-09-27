import { describe, expect, it } from 'vitest';
import {
  ethPerTokenAtTick,
  ethPerTokenFromSqrtPrice,
  expectedEthOut,
  floorToSpacing,
  maxUsableTick,
  minUsableTick,
  targetTick,
  tickForPrice,
  tokenPerEthFromSqrtPrice,
} from './tick';

// Live Sepolia slot0 observed while building: tick 177284.
const SQRT = 560227709747861399187319382274582n;
const TICK = 177284;

describe('tick math', () => {
  it('floors to spacing with mathematical floor for negative ticks', () => {
    expect(floorToSpacing(177284, 60)).toBe(177240);
    expect(floorToSpacing(-61, 60)).toBe(-120);
    expect(floorToSpacing(-60, 60)).toBe(-60);
    expect(floorToSpacing(59, 60)).toBe(0);
  });

  it('usable tick bounds match TickMath for spacing 60', () => {
    expect(minUsableTick(60)).toBe(-887220);
    expect(maxUsableTick(60)).toBe(887220);
  });

  it('converts sqrtPriceX96 both ways consistently with the tick', () => {
    const tokenPerEth = tokenPerEthFromSqrtPrice(SQRT);
    const ethPerToken = ethPerTokenFromSqrtPrice(SQRT);
    expect(tokenPerEth * ethPerToken).toBeCloseTo(1, 9);
    // 1.0001^177284 ≈ 5.0e7 TKPF per ETH
    expect(Math.abs(Math.log(tokenPerEth) / Math.log(1.0001) - TICK)).toBeLessThan(1);
  });

  it('price → theoretical tick round-trips for both units', () => {
    expect(tickForPrice(ethPerTokenAtTick(173220), 'ethPerToken')).toBeCloseTo(173220, 6);
    expect(tickForPrice(Math.pow(1.0001, 173220), 'tokenPerEth')).toBeCloseTo(173220, 6);
  });

  it('rounds a target price down to a valid tick strictly below the current range', () => {
    const r = targetTick(0.00000003, 'ethPerToken', TICK, 60);
    expect(r.ok).toBe(true);
    expect(r.tick).toBe(173220);
    expect(r.tick % 60).toBe(0);
    expect(r.currentRange).toBe(177240);
    // The rounded tick gives a price at or above the target.
    expect(ethPerTokenAtTick(r.tick)).toBeGreaterThanOrEqual(0.00000003);
  });

  it('rejects targets in or above the current range', () => {
    const inRange = targetTick(ethPerTokenAtTick(177250), 'ethPerToken', TICK, 60);
    expect(inRange.ok).toBe(false);
    expect(inRange.reason).toMatch(/above the current price/);
    const below = targetTick(0.00000001, 'ethPerToken', TICK, 60); // lower ETH price = higher tick
    expect(below.ok).toBe(false);
    const exactBoundary = targetTick(ethPerTokenAtTick(177180), 'ethPerToken', TICK, 60);
    expect(exactBoundary.ok).toBe(true);
    expect(exactBoundary.tick).toBe(177180);
  });

  it('rejects nonsense prices and out-of-domain ticks', () => {
    expect(targetTick(0, 'ethPerToken', TICK, 60).ok).toBe(false);
    expect(targetTick(NaN, 'ethPerToken', TICK, 60).ok).toBe(false);
    expect(targetTick(1e300, 'ethPerToken', TICK, 60).ok).toBe(false);
  });

  it('expected ETH uses the geometric mean price of the range', () => {
    const out = expectedEthOut(1000, 173220, 60);
    expect(out).toBeCloseTo(1000 * Math.pow(1.0001, -173250), 12);
    expect(out).toBeGreaterThan(1000 * ethPerTokenAtTick(173280));
    expect(out).toBeLessThan(1000 * ethPerTokenAtTick(173220));
  });
});
