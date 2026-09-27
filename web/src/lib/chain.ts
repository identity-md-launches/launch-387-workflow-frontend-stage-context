import type { Chain, EIP1193Provider } from 'viem';
import { numberToHex } from 'viem';
import { createConfig, createStorage, fallback, http, type Config } from 'wagmi';
import { injected } from '@wagmi/core';
import type { NetworkBlock } from './deployment';

/** viem chain object derived from the manifest network block. */
export function chainFromNetwork(n: NetworkBlock): Chain {
  return {
    id: n.chainId,
    name: n.name,
    testnet: n.testnet,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: n.explorer } },
  };
}

/** Exact `wallet_addEthereumChain` parameters, derived from the same block. */
export function addChainParams(n: NetworkBlock) {
  return {
    chainId: numberToHex(n.chainId),
    chainName: n.name,
    rpcUrls: n.rpcUrls,
    nativeCurrency: n.nativeCurrency,
    blockExplorerUrls: [n.explorer],
  };
}

/**
 * wagmi config: the manifest chain only, browser wallets only, and reads
 * through the public RPC list with fallback. No WalletConnect project ID is
 * configured for this deployment (see `config.ts`).
 */
export function createAppConfig(n: NetworkBlock, storage: Storage | null = globalThis.localStorage ?? null): Config {
  const chain = chainFromNetwork(n);
  return createConfig({
    chains: [chain],
    connectors: [injected({ shimDisconnect: true })],
    multiInjectedProviderDiscovery: true,
    storage: storage ? createStorage({ storage }) : null,
    transports: {
      [chain.id]: fallback(
        n.rpcUrls.map((u) => http(u, { batch: false, retryCount: 1, timeout: 15_000 })),
        { rank: false },
      ),
    },
  });
}

function isUnknownChainError(err: unknown): boolean {
  const e = err as { code?: number; message?: string; data?: { originalError?: { code?: number } } };
  const code = e?.code ?? e?.data?.originalError?.code;
  if (code === 4902) return true;
  const msg = String(e?.message ?? '');
  return /unrecognized chain|unknown chain|not (been )?added|4902/i.test(msg);
}

export function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; name?: string; cause?: unknown; message?: string };
  if (e?.code === 4001 || e?.name === 'UserRejectedRequestError') return true;
  if (/user rejected|user denied|rejected the request/i.test(String(e?.message ?? ''))) return true;
  return e?.cause ? isUserRejection(e.cause) : false;
}

/**
 * Switch the wallet to the manifest chain. When the wallet does not know it
 * (EIP-3326 code 4902 or an equivalent message) the chain is added with
 * `wallet_addEthereumChain` and the switch is retried.
 */
export async function ensureWalletChain(provider: EIP1193Provider, n: NetworkBlock): Promise<void> {
  const chainId = numberToHex(n.chainId);
  const switchChain = () => provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
  try {
    await switchChain();
  } catch (err) {
    if (isUserRejection(err) || !isUnknownChainError(err)) throw err;
    await provider.request({ method: 'wallet_addEthereumChain', params: [addChainParams(n)] });
    await switchChain();
  }
}
