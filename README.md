# Takeprofit (TKPF)

Foundry contracts and real Uniswap v4 PoolManager tests for the approved Sepolia take-profit launch. `LaunchToken` is Takeprofit / TKPF: 1,000,000,000 tokens, 18 decimals, minted once to its deployer, with no owner or subsequent mint. `TakeProfitHook` extends the vendored OpenZeppelin `LimitOrderHook` and sells the pool's currency1 for native ETH. It has no administrator, proxy, pause, upgrade, hook fee, oracle, or keeper.

```sh
forge build
forge test
forge fmt --check
forge test --match-path test/Gas.t.sol -vv
```

The compiler is pinned to Solidity 0.8.26, targeting Cancun, optimizer 200 runs, `bytecode_hash = "none"`. All Solidity dependencies are ordinary files in `lib/`; no package installation, submodule, RPC, environment configuration, FFI, or filesystem permission is needed to build/test once the pinned compiler and Foundry are installed. Tests use fresh real PoolManagers and the template's native-ETH launch-pool harness. Test ETH, wallets and configuration are deterministic fixtures. Test routers are helpers, not production swap routers.

## Orders

Approve the hook to spend TKPF, then call `placeTakeProfit(key, tick, amount)` with token wei. The hook computes liquidity for `[tick, tick + 60]`, rounding down so the manager's rounded-up debit never exceeds `amount`. Zero liquidity, invalid ticks, uninitialized pools, non-native currency0, wrong hook addresses, and spacing other than 60 revert. `placeOrder(key, tick, false, liquidity)` is the liquidity-denominated equivalent and enforces the same checks. `zeroForOne = true` orders are always refused, even if ETH is forcibly sent to the hook.

The target tick must be a usable multiple of 60 strictly below the current 60-tick range. The entire order initially consists of TKPF. ETH buys (`zeroForOne = true` swaps) push the tick down and increase TKPF's ETH price. A partially traversed range remains active; once the price passes below its lower boundary, `afterSwap` removes its pooled liquidity. Proceeds remain in the PoolManager as ERC-6909 claims owned by the hook, with each owner's entitlement recorded internally. Users do not receive transferable claim tokens.

Owners at the same pool/tick share an order ID until it fills or everybody cancels. New orders there use a new ID. `cancelOrder(key, tick, false, to)` removes the caller's entire active share, returning TKPF and, after a partial cross, ETH. `withdraw(orderId, to)` redeems the caller's entire filled share; it fails before fill, for nonowners, or twice. A rejecting ETH recipient reverts atomically; the owner can retry with another recipient. There are no deadlines or expiry transitions.

Principal pays pro rata by liquidity. Fees are attributed to liquidity that was present when they accrued. A cancelling owner forfeits fees to the owners who remain; the last cancellation receives all remaining fees. Final withdrawals receive residual integer dust. The vendored base required two accounting repairs; see [accounting and review notes](docs/REVIEW.md) and the [exact patch](docs/patches/LimitOrderHook.patch). This is a locally modified experimental base, not an unmodified or independently audited OpenZeppelin release.

## Integration and limits

[ABI documentation](docs/ABI.md) describes order views, events and price conversions. [Deployment notes](docs/DEPLOYMENT.md) list exact constructor parameters, CREATE2 flags and service responsibilities. [Gas measurements](docs/GAS.md) cover 100 crossed steps and dense order fills.

Only the factory-selected native-ETH/TKPF pool is the intended application. The hook learns currencies from each PoolKey; it does not permanently bind itself to a token address. Bookkeeping runs for every attached pool, including ERC20/ERC20 pools, but order entry is restricted to native currency0 and spacing 60. Pool IDs isolate order state. Standard exact-transfer ERC20 behavior is assumed; fee-on-transfer, rebasing, and callback tokens are unsupported.

No swapper identity, router allowlist, reward attribution or `hookData` decoding is used. `hookData` is unauthenticated and ignored; supplying an address or omitting data credits nobody. A router cannot claim another owner's order because placement, cancellation and withdrawal use the direct caller's ownership.

A take-profit order commits to execution across its selected range. Spot prices can be manipulated; this is not MEV protection or a promise of execution at an oracle price. Swapping back cannot reclaim already filled orders' proceeds, but it can change the market after execution. The inherited loop visits every crossed tick step; enough orders can make a large swap exceed transaction/block gas limits. Users must quote, simulate and bound price impact, and split large buys when needed.

This contribution produces source, tests and ABIs. The manifest assignment, independent review, source publication, attestation, admission, deployment and live website are subsequent workflow responsibilities. No deployment transaction or `launch.json` is produced here. Dependency provenance and file hashes are in [dependencies.json](docs/dependencies.json); upstream license notices are in [docs/licenses](docs/licenses).
