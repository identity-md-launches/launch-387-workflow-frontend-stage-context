# Deployment handoff

| Parameter | Approved value |
| --- | --- |
| Chain | Sepolia, chain ID 11155111; Cancun support required |
| Token artifact | `src/LaunchToken.sol:LaunchToken` |
| Token constructor arguments | `[]` |
| Name / symbol / decimals | Takeprofit / TKPF / 18 |
| Supply in token wei | `1000000000000000000000000000` |
| Initial supply recipient | `msg.sender` of the token constructor (the deploying factory) |
| Hook artifact | `src/TakeProfitHook.sol:TakeProfitHook` |
| Hook constructor | `constructor(IPoolManager manager)` |
| Hook constructor arguments | `["0xE03A1074c86CFeDd5C142C4F04F1a1536e203543"]` |
| Hook permissions | `afterInitialize`, `afterSwap`; every other flag false |
| Hook address check | `uint160(hook) & 0x3FFF == 0x1040` |
| Pool currencies | currency0 = `address(0)` (native ETH); currency1 = deployed TKPF |
| Pool LP fee / spacing | 3000 (0.30%) / 60 |
| Administrative roles | None |
| Website label for later stage | `lab-limit-order-hook` |

The manifest contributor must use the literal Sepolia manager constructor argument above. The address is a constructor parameter, not a source hardcode, allowing tests to use a fresh real manager. There is no post-deployment configuration and no token, owner, fee recipient or router constructor argument. `getHookPermissions()` is inherited from LimitOrderHook; BaseHook validates all 14 address bits during construction.

The deploying factory mines a CREATE2 salt over the actual factory/deployer address and `keccak256(creationCode ++ abi.encode(manager))`. Use the vendored `v4-periphery/src/utils/HookMiner.sol` or the equivalent formula in `test/Adversarial.t.sol`. Compile the final reviewed source before mining: changing constructor arguments, compiler settings or the accounting patch changes the address. Confirm the predicted address is unused and deploy exactly that creation code. The test suite includes a real mined CREATE2 deployment as well as the faster template fixture deployment. Salt search has a finite attempt limit; failure to find a salt should restart with a new search range.

Initialize the native pool and add the factory's token-only seed without funding the hook with ETH. The harness models start tick 138000 and seed range `[-887220, 138000]` using the entire billion-token supply, minus insignificant liquidity rounding dust. These are benchmark parameters, not hook constants or a claim about a deployed pool. The deployment service must confirm its actual initial price, seed range, amount and price limits match the reviewed launch configuration, then rehearse the first buy with a PoolManager starting at zero ETH. No callback restricts initialization or liquidity seeding for other pools.

Source-producing work owns the contracts, tests, ABI exports and documentation. A separate manifest assignment owns `launch.json`. An independent contributor must inspect the accepted source, local base patch and manifest together. Policy and signed-artifact linkage belong to publishing/admission services; concrete constructor, source, pool-policy or authorization mismatches are review findings. Passing local tests is not independent review or deployment approval.

After review, services publish source, attest compiled artifacts, admit and deploy. Services must verify the manager code on Sepolia, permissions, deployed bytecode, ABI, constructor arguments, token supply held by the factory, pool key and initial liquidity. Recent-state fork rehearsal belongs to that stage: the local suite uses the actual v4 implementation but makes no live-network or fork claim. Services then supply the deployed token/hook/pool addresses, deployment block and public RPC to the later static website stage, whose export must have `dist/index.html`.

Operationally, the website should show the forfeited-fee rule before cancellation, simulate current order placement and swaps, set swap price/output bounds, and surface gas failures. Re-query the current tick before submission because a quoted order can become in-range. Index events from deployment with reorg handling and refresh on-chain ownership/state; RPC logs alone are not final. Monitor gas growth, outstanding claims and PoolManager health. There is no hook administrator able to rescue mistakes, change policy or pause trading. Receivers must accept native ETH; rejected payouts remain retryable by their owner.
