# Swap gas envelope

Reproduce with `forge test --match-path test/Gas.t.sol -vv`. Solidity 0.8.26, optimizer 200, Cancun; local real PoolManager and its test swap router. The pool starts at tick 138000 with a billion TKPF in `[-887220, 138000]`. Dense fixtures first buy 1 ETH, then place 1,000 TKPF at every successive 60-tick range below the current range.

Orders are committed in each fixture's `setUp`, outside the measured swap. Account/storage accesses are marked cold before measurement. The recorded `gasleft()` difference surrounds the full router call, including settlement and returning unused ETH. It excludes setup, transaction intrinsic/calldata costs and any refund credit. This conservative execution measurement is more useful for transaction feasibility than Forge's net gas number, which subtracts refunds.

| Crossed order ranges / steps | Filled orders | ETH actually spent | Execution gas before refunds |
| --- | ---: | ---: | ---: |
| 100 steps | 0 | 356.553353601 | 201,475 |
| 100 order ranges | 100 | 359.965698968 | 16,688,124 |
| 140 order ranges | 140 | 536.014006621 | 23,309,545 |
| 150 order ranges | 150 | 583.428808092 | 24,967,225 |
| 200 order ranges | 200 | 843.074438165 | 33,265,556 |
| 2,000 steps | 0 | 410,088.235180435 | 259,703 |

Dense swaps also enter the final range below the last filled order. The callback now visits initialized ticks from the manager bitmap rather than every spacing interval; adjacent order removals may leave a harmless stale bit in the cached word. The 100-empty-step test asserts the cached tick range moves exactly 6,000 ticks. Prices use explicit sqrt-price limits and the tests assert they are reached; the router refunds the offered input that was not spent. The large ETH fixtures are benchmarks, not intended deployment funding.

Using a **30 million execution-gas budget and a 20% reserve** as an explicit planning assumption, the largest *tested populated* swap that fits comfortably is **140 ranges, about 536.014 ETH, 23.310 million gas**. The 150-order case loses that reserve; 200 orders exceed 30 million before refunds. The 2,000-step empty-order path costs about 410,088 ETH and 0.260 million gas after bitmap traversal replaces the interval scan. These are measured cases, not a universal maximum or an assertion about Sepolia's current block/transaction limits. Confirm those limits and RPC gas caps at deployment.

For buys, the callback scans one bitmap word per 256 spacing intervals and processes initialized ticks; each filled order still removes pooled liquidity and updates claims. Sells only update the cursor, since this hook cannot hold orders in that fill direction. At spacing 60 the entire valid tick domain spans at most 116 bitmap words. Initialized LP ticks without orders still incur an order lookup, so gas depends on all liquidity fragmentation, not just order count. There is no on-chain step cap, pagination or keeper. An adversary can spread small orders across many ticks to increase the gas needed for a large buy. Applying a partial callback budget would leave accounting inconsistent, so this implementation does not stop processing midway. Swaps that exceed available gas revert atomically; smaller swaps with suitable price limits can still advance the price. Simulate against current order density, reserve gas for the actual production router, and split large buys. Cancel and withdraw process one owner's position independently of the number of crossed ticks.

## Empty-gap regression

`forge test --match-path test/ReviewRegression.t.sol -vv` measures cold router calls with an explicit **2,000,000 gas cap per call**. The high start tick and token-only seed allow a 1-wei sell to traverse the empty upper gap without moving tokens or ETH. PoolManager still moves the price; the fix makes later trading affordable without a recovery keeper or cursor-reset transaction.

| Scenario | Sell execution gas | Subsequent buy execution gas |
| --- | ---: | ---: |
| Free sell to MAX sqrt price minus 1, then 1 ETH buy | 395,747 | 581,766 |
| Split free sells via tick 400020, then 0.01 ETH buy | 209,421 + 279,274 | 573,181 |
| Sell after initial funding, then buy to fill an order at its exact lower boundary | 500,537 | 824,474 |
| Repeat funded sell after a 0.01 ETH buy, then another 0.01 ETH buy | 500,537 | 570,206 |

The first path previously required 54,971,299 gas for the free sell and 232,315,226 gas for the buy in the reproduction fixture. The upper gap is 12,487 spacing intervals, far beyond the original 2,000-step benchmark. Another regression traverses the full empty tick domain from MAX to MIN under the same 2-million-gas call cap. These tests assert settled balances and successful fills, not just lower gas readings. They do not remove the dense-order limit above; production routers and current chain/RPC limits must still be simulated by deployment and frontend services.
