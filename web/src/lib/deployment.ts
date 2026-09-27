import type { Abi, Address } from 'viem';
import { isAddress } from 'viem';
import { CONTRACT_NAMES, DEPLOYMENT_MANIFEST_PATH } from '../config';

/** Shape of `dist/imd-deployment.json` (schema version 1). */
export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  network: NetworkBlock;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

/** Manifest plus the ABIs it references, resolved and ready to use. */
export interface Deployment {
  manifest: DeploymentManifest;
  token: { address: Address; abi: Abi; abiHash: string; explorerUrl: string };
  hook: { address: Address; abi: Abi; abiHash: string; explorerUrl: string };
  network: NetworkBlock;
}

export class DeploymentError extends Error {}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new DeploymentError(message);
}

/** Validate the manifest structure before anything trusts it. */
export function validateManifest(raw: unknown): DeploymentManifest {
  assert(raw && typeof raw === 'object', 'Deployment manifest is not an object.');
  const m = raw as Record<string, unknown>;
  assert(m.version === 1, 'Deployment manifest version is not 1.');
  assert(typeof m.launchId === 'string' && m.launchId, 'Deployment manifest is missing launchId.');
  assert(typeof m.chainId === 'number' && Number.isInteger(m.chainId), 'Deployment manifest chainId is not a number.');
  assert(typeof m.sourceCommit === 'string', 'Deployment manifest is missing sourceCommit.');
  assert(typeof m.attestationHash === 'string', 'Deployment manifest is missing attestationHash.');
  assert(Array.isArray(m.contracts) && m.contracts.length > 0, 'Deployment manifest has no contracts.');
  for (const c of m.contracts as Record<string, unknown>[]) {
    assert(typeof c.name === 'string', 'A manifest contract has no name.');
    assert(typeof c.address === 'string' && isAddress(c.address), `Contract ${c.name} has an invalid address.`);
    assert(typeof c.abiHash === 'string' && /^[0-9a-f]{64}$/.test(c.abiHash), `Contract ${c.name} has an invalid abiHash.`);
    assert(
      typeof c.abiPath === 'string' && !c.abiPath.includes('..') && !/^[a-z]+:/i.test(c.abiPath) && !c.abiPath.startsWith('/'),
      `Contract ${c.name} has an invalid abiPath.`,
    );
  }
  assert(Array.isArray(m.assets), 'Deployment manifest has no assets list.');
  const n = m.network as Record<string, unknown> | undefined;
  assert(n && typeof n === 'object', 'Deployment manifest has no network block.');
  assert(n.chainId === m.chainId, 'Network block chainId does not match manifest chainId.');
  assert(Array.isArray(n.rpcUrls) && n.rpcUrls.length > 0, 'Network block has no RPC URLs.');
  assert(typeof n.explorer === 'string', 'Network block has no explorer.');
  const u = n.uniswapV4 as Record<string, unknown> | undefined;
  assert(u && typeof u === 'object', 'Network block has no uniswapV4 addresses.');
  for (const k of ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2']) {
    assert(typeof u[k] === 'string' && isAddress(u[k] as string), `uniswapV4.${k} is not an address.`);
  }
  return raw as DeploymentManifest;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new DeploymentError(`Unable to load ${url} (HTTP ${res.status}).`);
  return res.json();
}

/** Load the manifest and both ABIs relative to the current page. */
export async function loadDeployment(base: string = document.baseURI): Promise<Deployment> {
  const manifestUrl = new URL(DEPLOYMENT_MANIFEST_PATH, base).toString();
  const manifest = validateManifest(await fetchJson(manifestUrl));
  const find = (name: string) => {
    const c = manifest.contracts.find((x) => x.name === name);
    assert(c, `Deployment manifest has no contract named ${name}.`);
    return c;
  };
  const tokenEntry = find(CONTRACT_NAMES.token);
  const hookEntry = find(CONTRACT_NAMES.hook);
  const [tokenAbi, hookAbi] = await Promise.all([
    fetchJson(new URL(tokenEntry.abiPath, manifestUrl).toString()),
    fetchJson(new URL(hookEntry.abiPath, manifestUrl).toString()),
  ]);
  assert(Array.isArray(tokenAbi) && Array.isArray(hookAbi), 'An ABI file is not a JSON array.');
  const explorer = manifest.network.explorer.replace(/\/$/, '');
  return {
    manifest,
    network: manifest.network,
    token: {
      address: tokenEntry.address,
      abi: tokenAbi as Abi,
      abiHash: tokenEntry.abiHash,
      explorerUrl: `${explorer}/address/${tokenEntry.address}`,
    },
    hook: {
      address: hookEntry.address,
      abi: hookAbi as Abi,
      abiHash: hookEntry.abiHash,
      explorerUrl: `${explorer}/address/${hookEntry.address}`,
    },
  };
}
