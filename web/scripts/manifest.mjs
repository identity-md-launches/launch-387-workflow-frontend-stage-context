#!/usr/bin/env node
/**
 * Emit dist/imd-deployment.json after `vite build`.
 *
 * 1. Reads the deployment handoff and network block (defaults:
 *    web/deployment/deployment.json and web/deployment/network.json; override
 *    with IMD_DEPLOYMENT / IMD_NETWORK).
 * 2. Copies each contract's implementation-derived ABI from docs/abi/<Name>.json
 *    into dist/abi/<Name>.json and verifies keccak256 of the canonical JSON
 *    (keys sorted recursively, no whitespace) against the handoff abiHash.
 * 3. Hashes every file under dist/ except the manifest itself (SHA-256, lowercase
 *    hex) and writes the manifest with the network block copied unchanged.
 *
 * Usage: node scripts/manifest.mjs   (from web/)
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'viem';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const repoDir = path.resolve(webDir, '..');
const distDir = path.join(repoDir, 'dist');
const abiSrcDir = path.join(repoDir, 'docs', 'abi');
const deploymentPath = process.env.IMD_DEPLOYMENT ?? path.join(webDir, 'deployment', 'deployment.json');
const networkPath = process.env.IMD_NETWORK ?? path.join(webDir, 'deployment', 'network.json');

const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const TARGET_TOTAL_BYTES = 24 * 1024 * 1024; // keep well under half the 64 MiB checker budget

function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
}

export function canonicalAbiHash(abi) {
  return keccak256(new TextEncoder().encode(JSON.stringify(sortDeep(abi)))).slice(2);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

async function main() {
  const handoff = JSON.parse(await fs.readFile(deploymentPath, 'utf8'));
  const networkFile = JSON.parse(await fs.readFile(networkPath, 'utf8'));
  if (!networkFile.network) throw new Error(`${networkPath} has no network block`);
  if (networkFile.network.chainId !== handoff.chainId) throw new Error('network.json chainId differs from the handoff chainId');
  if (handoff.version !== 1) throw new Error(`Unsupported handoff version ${handoff.version}`);

  await fs.access(path.join(distDir, 'index.html')).catch(() => {
    throw new Error('dist/index.html not found; run `npm run build` first');
  });
  await fs.mkdir(path.join(distDir, 'abi'), { recursive: true });

  const contracts = [];
  for (const c of handoff.contracts) {
    const src = path.join(abiSrcDir, `${c.name}.json`);
    const bytes = await fs.readFile(src);
    const abi = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(abi)) throw new Error(`${src} is not a JSON array`);
    const hash = canonicalAbiHash(abi);
    if (hash !== c.abiHash) throw new Error(`ABI hash mismatch for ${c.name}: computed ${hash}, handoff ${c.abiHash}`);
    const abiPath = `abi/${c.name}.json`;
    await fs.writeFile(path.join(distDir, abiPath), bytes);
    contracts.push({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath });
    console.log(`ABI ${c.name}: keccak ${hash} verified → dist/${abiPath}`);
  }

  const files = (await walk(distDir)).filter((p) => p !== 'imd-deployment.json');
  const assets = [];
  let total = 0;
  for (const p of files) {
    const bytes = await fs.readFile(path.join(distDir, p));
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`${p} exceeds 8 MiB`);
    total += bytes.length;
    assets.push({ path: p, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  if (assets.length > MAX_ASSETS) throw new Error(`${assets.length} assets exceed the limit of ${MAX_ASSETS}`);
  if (total > TARGET_TOTAL_BYTES) throw new Error(`export is ${total} bytes, above the ${TARGET_TOTAL_BYTES} byte target`);

  const manifest = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts,
    assets,
    network: networkFile.network,
  };
  await fs.writeFile(path.join(distDir, 'imd-deployment.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`dist/imd-deployment.json written: ${assets.length} assets, ${total} bytes total`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
