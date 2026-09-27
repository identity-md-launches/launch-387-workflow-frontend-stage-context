import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from 'viem';
import { POOL } from '../config';

/** PoolKey tuple as the hook expects it: currency0 ETH, currency1 TKPF. */
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export function poolKeyFor(token: Address, hook: Address): PoolKey {
  return { currency0: POOL.pairedCurrency, currency1: token, fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: hook };
}

/** PoolId = keccak256(abi.encode(key)). */
export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Minimal Uniswap v4 StateView ABI (address comes from the manifest network block). */
export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);
