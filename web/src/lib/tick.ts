/**
 * Tick and price helpers for the native-ETH / TKPF pool.
 *
 * currency0 = ETH, currency1 = TKPF, both 18 decimals, so the pool price
 * `1.0001^tick` is TKPF per ETH and its inverse is ETH per TKPF. Floating
 * point is used for display and for choosing a tick; the contract validates
 * every tick with integer TickMath before it moves funds.
 */

export const Q96 = 2n ** 96n;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export type PriceUnit = 'ethPerToken' | 'tokenPerEth';

export function minUsableTick(spacing: number): number {
  return Math.ceil(MIN_TICK / spacing) * spacing;
}

export function maxUsableTick(spacing: number): number {
  return Math.floor(MAX_TICK / spacing) * spacing;
}

/** Mathematical floor to a multiple of `spacing` (works for negative ticks). */
export function floorToSpacing(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

/** TKPF per ETH from the pool's sqrtPriceX96. */
export function tokenPerEthFromSqrtPrice(sqrtPriceX96: bigint): number {
  const s = Number(sqrtPriceX96) / Number(Q96);
  return s * s;
}

export function ethPerTokenFromSqrtPrice(sqrtPriceX96: bigint): number {
  return 1 / tokenPerEthFromSqrtPrice(sqrtPriceX96);
}

/** TKPF per ETH at a tick. */
export function tokenPerEthAtTick(tick: number): number {
  return Math.pow(1.0001, tick);
}

/** ETH per TKPF at a tick. */
export function ethPerTokenAtTick(tick: number): number {
  return Math.pow(1.0001, -tick);
}

/** Theoretical (unrounded) tick for a target price. */
export function tickForPrice(price: number, unit: PriceUnit): number {
  const tokenPerEth = unit === 'tokenPerEth' ? price : 1 / price;
  return Math.log(tokenPerEth) / Math.log(1.0001);
}

export interface TargetTickResult {
  ok: boolean;
  tick: number;
  /** Lower boundary of the current 60-tick range. */
  currentRange: number;
  reason?: string;
}

/**
 * Choose the order tick for a target price: rounded down to a multiple of
 * `spacing` (a lower tick means a higher ETH price, so the order fills at or
 * above the target), and it must lie strictly below the current range.
 */
export function targetTick(price: number, unit: PriceUnit, currentTick: number, spacing: number): TargetTickResult {
  const currentRange = floorToSpacing(currentTick, spacing);
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, tick: NaN, currentRange, reason: 'Enter a price greater than zero.' };
  }
  const tick = floorToSpacing(tickForPrice(price, unit), spacing);
  const min = minUsableTick(spacing);
  const max = maxUsableTick(spacing) - spacing;
  if (tick < min || tick > max) {
    return { ok: false, tick, currentRange, reason: 'That price is outside the range the pool supports.' };
  }
  if (tick >= currentRange) {
    return {
      ok: false,
      tick,
      currentRange,
      reason: 'A take-profit must be above the current price. Enter a higher ETH price per TKPF (fewer TKPF per ETH).',
    };
  }
  return { ok: true, tick, currentRange };
}

/**
 * Expected ETH for `amountToken` TKPF sold across [tick, tick + spacing],
 * before LP fees: amount1 / (sqrtP(tick) * sqrtP(tick + spacing)).
 */
export function expectedEthOut(amountToken: number, tick: number, spacing: number): number {
  return amountToken * Math.pow(1.0001, -(tick + spacing / 2));
}
