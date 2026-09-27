# Swap gas envelope

Reproduce with `forge test --match-path test/Gas.t.sol -vv`. Solidity 0.8.26, optimizer 200, Cancun; local real PoolManager and its test swap router. The pool starts at tick 138000 with a billion TKPF in `[-887220, 138000]`. Dense fixtures first buy 1 ETH, then place 1,000 TKPF at every successive 60-tick range below the current range.

Orders are committed in each fixture's `setUp`, outside the measured swap. Account/storage accesses are marked cold before measurement. The recorded `gasleft()` difference surrounds the full router call, including settlement and returning unused ETH. It excludes setup, transaction intrinsic/calldata costs and any refund credit. This conservative execution measurement is more useful for transaction feasibility than Forge's net gas number, which subtracts refunds.

| Crossed order ranges / steps | Filled orders | ETH actually spent | Execution gas before refunds |
| --- | ---: | ---: | ---: |
| 100 steps | 0 | 356.553353601 | 875,660 |
| 100 order ranges | 100 | 359.965698968 | 16,653,814 |
| 140 order ranges | 140 | 536.014006621 | 23,261,897 |
| 150 order ranges | 150 | 583.428808092 | 24,916,291 |
| 200 order ranges | 200 | 843.074438165 | 33,197,915 |
| 2,000 steps | 0 | 410,088.235180435 | 17,502,328 |

Dense swaps also enter the final range below the last filled order, so the callback visits one more step than the number of populated order ranges. The 100-empty-step test asserts the cached tick range moves exactly 6,000 ticks. Prices use explicit sqrt-price limits and the tests assert they are reached; the router refunds the offered input that was not spent. The large ETH fixtures are benchmarks, not intended deployment funding.

Using a **30 million execution-gas budget and a 20% reserve** as an explicit planning assumption, the largest *tested populated* swap that fits comfortably is **140 ranges, about 536.014 ETH, 23.262 million gas**. The 150-order case loses that reserve; 200 orders exceed 30 million before refunds. The largest tested empty-path swap is 2,000 steps, about 410,088 ETH and 17.502 million gas. These are measured cases, not a universal maximum or an assertion about Sepolia's current block/transaction limits. Confirm those limits and RPC gas caps at deployment.

The base afterSwap loop is linear in every crossed spacing interval, including empty ones, and each filled order removes pooled liquidity and updates claims. There is no on-chain step cap, pagination or keeper. An adversary can spread small orders across many ticks to increase the gas needed for a large buy. Applying a partial callback budget would leave accounting inconsistent, so this implementation does not stop processing midway. Swaps that exceed available gas revert atomically; smaller swaps with suitable price limits can still advance the price. Simulate against current order density, reserve gas for the actual production router, and split large buys. Cancel and withdraw process one owner's position independently of the number of crossed ticks.
