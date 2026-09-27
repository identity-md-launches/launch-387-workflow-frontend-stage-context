import { describe, expect, it, vi } from 'vitest';
import type { EIP1193Provider } from 'viem';
import { addChainParams, chainFromNetwork, ensureWalletChain, isUserRejection } from './chain';
import { describeError } from './errors';
import { validateManifest } from './deployment';
import { formatSig, formatWithGroups, parseDecimalAmount, parsePrice } from './format';
import networkFile from '../../deployment/network.json';
import { makeManifest } from '../test/mockChain';

const network = networkFile.network as any;

describe('chain helpers', () => {
  it('derives the viem chain and wallet_addEthereumChain params from the network block', () => {
    const chain = chainFromNetwork(network);
    expect(chain.id).toBe(11155111);
    expect(chain.rpcUrls.default.http).toEqual(network.rpcUrls);
    // Must equal the walletAddChain block shipped with the handoff.
    expect(addChainParams(network)).toEqual(networkFile.walletAddChain);
  });

  it('switches directly when the wallet knows the chain', async () => {
    const request = vi.fn(async (_req: { method: string; params?: unknown }) => null);
    await ensureWalletChain({ request } as unknown as EIP1193Provider, network);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toEqual({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] });
  });

  it('adds the chain after a 4902 error, then switches again', async () => {
    let known = false;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'wallet_switchEthereumChain' && !known) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
      if (method === 'wallet_addEthereumChain') known = true;
      return null;
    });
    await ensureWalletChain({ request } as unknown as EIP1193Provider, network);
    expect(request.mock.calls.map((c: any) => c[0].method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect((request.mock.calls[1] as any)[0].params[0]).toEqual(networkFile.walletAddChain);
  });

  it('does not add the chain when the user rejected the switch', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    });
    await expect(ensureWalletChain({ request } as unknown as EIP1193Provider, network)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(describeError({ code: 4001, message: 'User rejected the request.' })).toMatch(/rejected in the wallet/);
  });
});

describe('manifest validation', () => {
  it('accepts the shipped manifest shape', () => {
    expect(validateManifest(makeManifest()).chainId).toBe(11155111);
  });
  it('rejects a manifest whose network chainId disagrees', () => {
    const m = makeManifest();
    (m.network as any).chainId = 1;
    expect(() => validateManifest(m)).toThrow(/chainId/);
  });
  it('rejects abiPath traversal or URLs', () => {
    const m = makeManifest();
    m.contracts[0]!.abiPath = '../abi/x.json';
    expect(() => validateManifest(m)).toThrow(/abiPath/);
    m.contracts[0]!.abiPath = 'https://example.com/x.json';
    expect(() => validateManifest(m)).toThrow(/abiPath/);
  });
});

describe('formatting', () => {
  it('formats significant digits without exponents for ordinary magnitudes', () => {
    expect(formatSig(50000000.123, 6)).toBe('50000000');
    expect(formatSig(0.0000000199975, 4)).toBe('0.00000002');
    expect(formatSig(0.000000019997, 5)).toBe('0.000000019997');
    expect(formatWithGroups(49999999.9, 4)).toBe('50,000,000');
    expect(formatSig(0)).toBe('0');
  });
  it('parses decimal amounts and prices strictly', () => {
    expect(parseDecimalAmount('1000', 18)).toBe(1000n * 10n ** 18n);
    expect(parseDecimalAmount('0.5', 18)).toBe(5n * 10n ** 17n);
    expect(parseDecimalAmount('1e3', 18)).toBeNull();
    expect(parseDecimalAmount('1.' + '1'.repeat(19), 18)).toBeNull();
    expect(parsePrice('3e-8')).toBe(3e-8);
    expect(parsePrice('0.00000003')).toBe(3e-8);
    expect(parsePrice('-1')).toBeNull();
    expect(parsePrice('abc')).toBeNull();
  });
});
