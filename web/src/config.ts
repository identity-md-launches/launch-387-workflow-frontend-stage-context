/**
 * Single place for build-time configuration.
 *
 * Contract addresses, the chain, ABIs, public RPC URLs and the Uniswap v4
 * addresses are NOT here: they are read at runtime from `imd-deployment.json`
 * next to `index.html` (see `lib/deployment.ts`). Keeping them out of the
 * bundle means the export cannot disagree with the attested handoff.
 *
 * Everything below is either a pointer to that file or a value that the
 * contracts themselves enforce and that is not part of the manifest schema.
 */

/** Runtime deployment manifest, relative to the page so subpath hosting works. */
export const DEPLOYMENT_MANIFEST_PATH = './imd-deployment.json';

/** Names used in the manifest `contracts` list. */
export const CONTRACT_NAMES = {
  token: 'LaunchToken',
  hook: 'TakeProfitHook',
} as const;

/**
 * Launch pool parameters from the approved manifest (`launch.json` / handoff
 * `manifest.pool`). The hook rejects any other spacing or a non-native
 * currency0, so these cannot silently drift from the deployed contract.
 */
export const POOL = {
  /** Native ETH is currency0. */
  pairedCurrency: '0x0000000000000000000000000000000000000000',
  fee: 3000,
  tickSpacing: 60,
} as const;

/**
 * Block in which the contracts were deployed (handoff `blockNumber`). Used
 * only as the lower bound for event scanning; it is a performance hint, not
 * an address or chain setting.
 */
export const LOG_FROM_BLOCK = 11791633n;

/** How often live reads refresh, in milliseconds. */
export const REFRESH_INTERVAL_MS = 15_000;

/**
 * Optional WalletConnect project ID. Not supplied for this deployment, so only
 * browser (injected / EIP-6963) wallets are offered. Set it at build time with
 * `VITE_WALLETCONNECT_PROJECT_ID` if you add the WalletConnect connector.
 */
export const WALLETCONNECT_PROJECT_ID: string | undefined =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || undefined;
