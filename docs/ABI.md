# ABI and application integration

Machine-readable exports: [LaunchToken.json](abi/LaunchToken.json) and [TakeProfitHook.json](abi/TakeProfitHook.json). Reproduce from the pinned compiler:

```sh
forge inspect LaunchToken abi --json > docs/abi/LaunchToken.json
forge inspect TakeProfitHook abi --json > docs/abi/TakeProfitHook.json
```

`PoolKey` encodes `(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)` in that order. Currency is ABI-encoded as address. PoolId is `keccak256(abi.encode(key))`. `OrderIdLibrary.OrderId` is ABI-encoded as `uint232`, not bytes32 or uint256. Amounts are token wei/native wei; liquidity is raw uint128 liquidity, not token amounts.

| Call | Meaning |
| --- | --- |
| `placeTakeProfit(key, int24 tick, uint256 amount)` | Nonpayable; pulls at most `amount` currency1 from direct caller. Returns nothing; read the Place event for ID. |
| `placeOrder(key, int24 tick, bool zeroForOne, uint128 liquidity)` | Nonpayable base entry point; only false direction accepted. |
| `liquidityForAmount(int24 tick, uint256 amount)` | Pure uint128 quote for one 60-tick range, rounded down. Checks valid tick and nonzero result; does not check current pool price. |
| `cancelOrder(key, int24 tickLower, bool zeroForOne, address to)` | Nonpayable; use false direction. Cancels all caller liquidity in the active order and pays principal plus earned fees to `to`. |
| `withdraw(uint232 orderId, address to)` | Nonpayable; returns `(uint256 amount0, uint256 amount1)` for a filled order's caller share. |
| `getOrderId(key, int24 tickLower, bool zeroForOne)` | Current active uint232 ID; zero when absent, filled or fully cancelled. Save historic IDs from events. |
| `getOrderInfo(uint232 id)` | `(bool filled, address currency0, address currency1, uint256 currency0Total, uint256 currency1Total, uint128 liquidityTotal)` |
| `getOrderLiquidity(uint232 id, address owner)` | Remaining owner's liquidity, returned as uint256; zero after withdrawal/cancellation. |
| `getTickLowerLast(bytes32 poolId)` | Cached last range boundary used by the base callback. Not a price oracle or exact current tick. |
| `poolManager()` / `getHookPermissions()` | Immutable manager and the 14 permission booleans. |
| `TICK_SPACING()` | int24 constant 60. |

For active orders, currency totals include collected fee claims but do not mark-to-market liquidity still in the pool or uncollected fees. After filling, totals are remaining redeemable claims and decrease with withdrawals. They do not expose a per-owner exact fee quote: simulate `withdraw` (filled) or `cancelOrder` (active) for the owner if a precise payout preview is required. Fees and principal round separately; tiny dust is paid to the final owner. Users can query historical filled IDs after the active ID resets.

`Place(owner indexed, orderId indexed, key, tickLower, zeroForOne, liquidity)`, `Fill(orderId indexed, key, tickLower, zeroForOne)`, `Cancel(owner indexed, orderId indexed, key, tickLower, zeroForOne, liquidity)`, and `Withdraw(owner indexed, orderId indexed, liquidity)` drive the order list. A filled shared order may still be unwithdrawn for some owners. Match Place/Cancel/Withdraw by both owner and order ID, and confirm with `getOrderLiquidity`; Fill is shared. Multiple Place events for one owner/ID accumulate. Use the ABI for full event signatures, including the PoolKey tuple.

Fetch PoolManager slot0 using StateLibrary's extsload layout or the deployed StateView appropriate to that manager. Let `s = sqrtPriceX96` and `Q96 = 2^96`. With TKPF and ETH both using 18 decimals:

- TKPF per ETH = `(s / Q96)^2`.
- ETH per TKPF = `(Q96 / s)^2`.
- For desired ETH-per-TKPF price `P`, theoretical tick = `ln(1 / P) / ln(1.0001)`.

For display only, floating-point math can approximate ticks. Transaction construction must verify bounds with integer TickMath. Round a target lower tick down toward negative infinity to a multiple of 60, and require it strictly below `floor(currentTick / 60) * 60`. Negative ticks need mathematical floor, not truncation toward zero. A buy stopping exactly at the lower sqrt price fills the order when PoolManager records tick `tick - 1`; a price still inside the range does not fill. An order executes throughout `[tick, tick + 60]`; show both boundary prices and expected range execution, not a guaranteed single price. Approval is a separate ERC20 transaction. Pool movement can invalidate a formerly valid tick, in which case placement reverts without taking funds.

Local custom errors include NativePoolRequired, EthSideOrder, InvalidPool, InvalidTick and PoolNotInitialized; inherited entry failures include ZeroLiquidity, InRange, CrossedRange, NotFilled, Filled and NotPoolManager. PoolManager may wrap callback failures in its own error. Cancellation after fill typically finds no active owner liquidity and returns ZeroLiquidity because the base clears the active ID; callers should use the historic ID and withdraw.
