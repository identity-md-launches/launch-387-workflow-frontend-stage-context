import { BaseError, ContractFunctionRevertedError } from 'viem';
import { isUserRejection } from './chain';

const REASONS: Record<string, string> = {
  InRange: 'The pool has moved into that price range. Choose a higher target price.',
  CrossedRange: 'The pool has moved past that price. Choose a higher target price.',
  InvalidTick: 'That tick is not a usable multiple of 60.',
  ZeroLiquidity: 'The amount is too small to form an order at that price. Enter a larger amount.',
  NativePoolRequired: 'This pool does not use native ETH as currency0.',
  EthSideOrder: 'Only TKPF-selling orders are allowed.',
  InvalidPool: 'The pool key does not match this hook.',
  PoolNotInitialized: 'The pool is not initialised.',
  NotFilled: 'This order has not filled yet, so it cannot be withdrawn. Cancel it instead.',
  Filled: 'This order already filled. Withdraw it instead of cancelling.',
  ERC20InsufficientAllowance: 'The hook is not approved to spend that much TKPF. Approve first.',
  ERC20InsufficientBalance: 'Your TKPF balance is lower than the amount.',
};

/** Human-readable message for wallet and contract errors. */
export function describeError(err: unknown): string {
  if (isUserRejection(err)) return 'Request rejected in the wallet. Nothing was sent.';
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (revert) {
      const name = revert.data?.errorName ?? revert.reason;
      if (name && REASONS[name]) return `${REASONS[name]} (${name})`;
      if (name) return `The contract rejected this call: ${name}.`;
      return 'The contract rejected this call. Check the amount and price, then try again.';
    }
    const short = err.shortMessage || err.message;
    if (/insufficient funds/i.test(short)) return 'Insufficient ETH for gas.';
    return short;
  }
  const e = err as { message?: string };
  return e?.message ? String(e.message) : 'Unexpected error. Try again.';
}
