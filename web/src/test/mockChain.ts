/**
 * Mock EIP-1193 provider plus JSON-RPC-over-fetch for the interaction tests.
 * Contract calls are decoded with the real ABIs and answered from a small
 * in-memory state, so the app under test runs its real encoding/decoding.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  getAbiItem,
  numberToHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { vi } from 'vitest';
import { stateViewAbi } from '../lib/pool';
import tokenAbiJson from '../../../docs/abi/LaunchToken.json';
import hookAbiJson from '../../../docs/abi/TakeProfitHook.json';
import handoff from '../../deployment/deployment.json';
import networkFile from '../../deployment/network.json';
import type { DeploymentManifest } from '../lib/deployment';

export const tokenAbi = tokenAbiJson as Abi;
export const hookAbi = hookAbiJson as Abi;

export const OWNER = '0x1111111111111111111111111111111111111111' as Address;
export const TOKEN = handoff.contracts.find((c) => c.name === 'LaunchToken')!.address as Address;
export const HOOK = handoff.contracts.find((c) => c.name === 'TakeProfitHook')!.address as Address;
export const STATE_VIEW = networkFile.network.uniswapV4.stateView as Address;
export const CHAIN_ID = handoff.chainId;

export function makeManifest(): DeploymentManifest {
  return {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({ name: c.name, address: c.address as Address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` })),
    assets: [],
    network: networkFile.network as DeploymentManifest['network'],
  };
}

export interface OrderRecord {
  orderId: bigint;
  tickLower: number;
  placedLiquidity: bigint;
  remaining: bigint;
  filled: boolean;
  cancelled?: bigint;
  withdrawn?: bigint;
  currency0Total?: bigint;
  currency1Total?: bigint;
  liquidityTotal?: bigint;
}

export interface MockState {
  walletChainId: number;
  knownChains: Set<number>;
  accounts: Address[];
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  tickLowerLast: number;
  balance: bigint;
  allowance: bigint;
  orders: OrderRecord[];
  /** Function names whose simulation should revert with this custom error. */
  revertWith: Record<string, string>;
  rejectSend: boolean;
  sent: { to: Address; data: Hex; value?: Hex }[];
  requests: { method: string; params?: unknown }[];
  blockNumber: bigint;
}

export function makeState(over: Partial<MockState> = {}): MockState {
  return {
    walletChainId: CHAIN_ID,
    knownChains: new Set([CHAIN_ID, 1]),
    accounts: [OWNER],
    // Live values seen on Sepolia when this app was built: tick 177284.
    sqrtPriceX96: 560227709747861399187319382274582n,
    tick: 177284,
    liquidity: 0n,
    tickLowerLast: 177240,
    balance: 1_000_000n * 10n ** 18n,
    allowance: 0n,
    orders: [],
    revertWith: {},
    rejectSend: false,
    sent: [],
    requests: [],
    blockNumber: 11_800_000n,
    ...over,
  };
}

function rpcError(code: number, message: string, data?: unknown) {
  const e = new Error(message) as Error & { code: number; data?: unknown };
  e.code = code;
  if (data !== undefined) e.data = data;
  return e;
}

function handleCall(state: MockState, to: Address, data: Hex): Hex {
  const lower = to.toLowerCase();
  if (lower === STATE_VIEW.toLowerCase()) {
    const { functionName } = decodeFunctionData({ abi: stateViewAbi, data });
    if (functionName === 'getSlot0') {
      return encodeFunctionResult({ abi: stateViewAbi, functionName, result: [state.sqrtPriceX96, state.tick, 0, 3000] });
    }
    if (functionName === 'getLiquidity') return encodeFunctionResult({ abi: stateViewAbi, functionName, result: state.liquidity });
  }
  if (lower === TOKEN.toLowerCase()) {
    const { functionName, args } = decodeFunctionData({ abi: tokenAbi, data }) as { functionName: string; args: readonly unknown[] };
    if (functionName === 'balanceOf') return encodeFunctionResult({ abi: tokenAbi, functionName, result: state.balance });
    if (functionName === 'allowance') return encodeFunctionResult({ abi: tokenAbi, functionName, result: state.allowance });
    if (functionName === 'approve') {
      if (state.revertWith.approve) throw revert(tokenAbi, state.revertWith.approve);
      return encodeFunctionResult({ abi: tokenAbi, functionName, result: true });
    }
    void args;
  }
  if (lower === HOOK.toLowerCase()) {
    const { functionName, args } = decodeFunctionData({ abi: hookAbi, data }) as { functionName: string; args: readonly any[] };
    const err = state.revertWith[functionName];
    if (err) throw revert(hookAbi, err);
    switch (functionName) {
      case 'getTickLowerLast':
        return encodeFunctionResult({ abi: hookAbi, functionName, result: state.tickLowerLast });
      case 'liquidityForAmount': {
        const amount = args[1] as bigint;
        if (amount < 10n ** 12n) throw revert(hookAbi, 'ZeroLiquidity');
        return encodeFunctionResult({ abi: hookAbi, functionName, result: amount / 10n ** 6n });
      }
      case 'getOrderLiquidity': {
        const o = state.orders.find((x) => x.orderId === (args[0] as bigint));
        return encodeFunctionResult({ abi: hookAbi, functionName, result: o?.remaining ?? 0n });
      }
      case 'getOrderInfo': {
        const o = state.orders.find((x) => x.orderId === (args[0] as bigint));
        return encodeFunctionResult({
          abi: hookAbi,
          functionName,
          result: [o?.filled ?? false, '0x0000000000000000000000000000000000000000', TOKEN, o?.currency0Total ?? 0n, o?.currency1Total ?? 0n, o?.liquidityTotal ?? o?.remaining ?? 0n],
        });
      }
      case 'placeTakeProfit':
        return '0x';
      case 'cancelOrder':
        return '0x';
      case 'withdraw': {
        const o = state.orders.find((x) => x.orderId === (args[0] as bigint));
        return encodeFunctionResult({ abi: hookAbi, functionName, result: [o?.currency0Total ?? 0n, o?.currency1Total ?? 0n] });
      }
    }
  }
  throw new Error(`mock: unhandled call to ${to} data ${data.slice(0, 10)}`);
}

/** Apply a sent transaction to the mock state the way the chain would. */
function applyTx(state: MockState, to: Address, data: Hex) {
  if (to.toLowerCase() === TOKEN.toLowerCase()) {
    const { functionName, args } = decodeFunctionData({ abi: tokenAbi, data }) as { functionName: string; args: readonly any[] };
    if (functionName === 'approve') state.allowance = args[1] as bigint;
  }
  if (to.toLowerCase() === HOOK.toLowerCase()) {
    const { functionName, args } = decodeFunctionData({ abi: hookAbi, data }) as { functionName: string; args: readonly any[] };
    if (functionName === 'placeTakeProfit') {
      const amount = args[2] as bigint;
      state.allowance -= amount;
      state.balance -= amount;
      state.orders.push({ orderId: BigInt(state.orders.length + 1), tickLower: args[1] as number, placedLiquidity: amount / 10n ** 6n, remaining: amount / 10n ** 6n, filled: false });
    }
    if (functionName === 'cancelOrder') {
      const o = state.orders.find((x) => x.tickLower === (args[1] as number) && x.remaining > 0n && !x.filled);
      if (o) {
        o.cancelled = o.remaining;
        o.remaining = 0n;
      }
    }
    if (functionName === 'withdraw') {
      const o = state.orders.find((x) => x.orderId === (args[0] as bigint));
      if (o) {
        o.withdrawn = o.remaining;
        o.remaining = 0n;
      }
    }
  }
}

function revert(abi: Abi, errorName: string) {
  const data = encodeErrorResult({ abi, errorName, args: [] });
  return rpcError(3, 'execution reverted', data);
}

const zeroForOneFalse = false;

function orderLogs(state: MockState, topics: (Hex | Hex[] | null)[] | undefined) {
  const logs: any[] = [];
  const poolKey = { currency0: '0x0000000000000000000000000000000000000000' as Address, currency1: TOKEN, fee: 3000, tickSpacing: 60, hooks: HOOK };
  let idx = 0;
  const push = (eventName: string, indexedArgs: Record<string, unknown>, dataArgs: readonly unknown[], dataTypes: any[], block: bigint) => {
    const eventTopics = encodeEventTopics({ abi: hookAbi, eventName, args: indexedArgs } as any);
    logs.push({
      address: HOOK,
      topics: eventTopics,
      data: encodeAbiParameters(dataTypes, dataArgs as unknown[]),
      blockNumber: numberToHex(block),
      transactionHash: `0x${(idx++).toString(16).padStart(64, '0')}` as Hex,
      transactionIndex: '0x0',
      blockHash: `0x${'ab'.repeat(32)}`,
      logIndex: numberToHex(idx),
      removed: false,
    });
  };
  const keyType = getAbiItem({ abi: hookAbi, name: 'Place' }) as any;
  const keyComponent = keyType.inputs.find((i: any) => i.name === 'key');
  for (const o of state.orders) {
    push('Place', { owner: OWNER, orderId: o.orderId }, [poolKey, o.tickLower, zeroForOneFalse, o.placedLiquidity], [keyComponent, { type: 'int24' }, { type: 'bool' }, { type: 'uint128' }], 11_791_700n);
    if (o.filled) push('Fill', { orderId: o.orderId }, [poolKey, o.tickLower, zeroForOneFalse], [keyComponent, { type: 'int24' }, { type: 'bool' }], 11_791_800n);
    if (o.cancelled) push('Cancel', { owner: OWNER, orderId: o.orderId }, [poolKey, o.tickLower, zeroForOneFalse, o.cancelled], [keyComponent, { type: 'int24' }, { type: 'bool' }, { type: 'uint128' }], 11_791_900n);
    if (o.withdrawn) push('Withdraw', { owner: OWNER, orderId: o.orderId }, [o.withdrawn], [{ type: 'uint128' }], 11_791_950n);
  }
  if (!topics) return logs;
  return logs.filter((l) =>
    topics.every((t, i) => {
      if (t === null || t === undefined) return true;
      const want = Array.isArray(t) ? t : [t];
      return want.some((w) => w.toLowerCase() === (l.topics[i] ?? '').toLowerCase());
    }),
  );
}

export function handleRpc(state: MockState, method: string, params: any): unknown {
  state.requests.push({ method, params });
  switch (method) {
    case 'eth_chainId':
      return numberToHex(state.walletChainId);
    case 'eth_accounts':
    case 'eth_requestAccounts':
      return state.accounts;
    case 'wallet_switchEthereumChain': {
      const id = Number(params[0].chainId);
      if (!state.knownChains.has(id)) throw rpcError(4902, 'Unrecognized chain ID. Try adding the chain first.');
      state.walletChainId = id;
      return null;
    }
    case 'wallet_addEthereumChain': {
      state.knownChains.add(Number(params[0].chainId));
      return null;
    }
    case 'eth_blockNumber':
      return numberToHex(state.blockNumber);
    case 'eth_call':
      return handleCall(state, params[0].to, params[0].data);
    case 'eth_estimateGas':
      return '0x5208';
    case 'eth_gasPrice':
      return '0x3b9aca00';
    case 'eth_maxPriorityFeePerGas':
      return '0x3b9aca00';
    case 'eth_getBlockByNumber':
      return { number: numberToHex(state.blockNumber), baseFeePerGas: '0x3b9aca00', hash: `0x${'cd'.repeat(32)}`, timestamp: '0x1', transactions: [] };
    case 'eth_getTransactionCount':
      return '0x1';
    case 'eth_sendTransaction': {
      if (state.rejectSend) throw rpcError(4001, 'User rejected the request.');
      const tx = params[0];
      state.sent.push({ to: tx.to, data: tx.data, value: tx.value });
      applyTx(state, tx.to, tx.data);
      return `0x${(state.sent.length).toString(16).padStart(64, 'f')}`;
    }
    case 'eth_getTransactionReceipt':
      return {
        transactionHash: params[0],
        status: '0x1',
        blockNumber: numberToHex(state.blockNumber),
        blockHash: `0x${'cd'.repeat(32)}`,
        transactionIndex: '0x0',
        from: OWNER,
        to: HOOK,
        cumulativeGasUsed: '0x5208',
        gasUsed: '0x5208',
        effectiveGasPrice: '0x3b9aca00',
        logs: [],
        logsBloom: `0x${'0'.repeat(512)}`,
        type: '0x2',
      };
    case 'eth_getLogs':
      return orderLogs(state, params[0].topics);
    case 'wallet_getCapabilities':
    case 'wallet_requestPermissions':
      throw rpcError(4200, 'Unsupported method');
    default:
      throw rpcError(-32601, `mock: method ${method} not supported`);
  }
}

/** Install `window.ethereum` and a fetch stub answering JSON-RPC and asset requests. */
export function installMock(state: MockState, opts: { withWallet?: boolean } = {}) {
  const listeners = new Map<string, Set<(...a: any[]) => void>>();
  const provider = {
    isMetaMask: true,
    request: vi.fn(async ({ method, params }: { method: string; params?: any }) => handleRpc(state, method, params)),
    on: (ev: string, fn: (...a: any[]) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
    },
    removeListener: (ev: string, fn: (...a: any[]) => void) => listeners.get(ev)?.delete(fn),
    emit: (ev: string, ...args: any[]) => listeners.get(ev)?.forEach((fn) => fn(...args)),
  };
  // wallet_switchEthereumChain in a real wallet emits chainChanged; do the same.
  const origRequest = provider.request;
  provider.request = vi.fn(async (req: { method: string; params?: any }) => {
    const result = await origRequest(req);
    if (req.method === 'wallet_switchEthereumChain') provider.emit('chainChanged', numberToHex(state.walletChainId));
    return result;
  }) as any;
  if (opts.withWallet !== false) (window as any).ethereum = provider;
  else delete (window as any).ethereum;

  const manifest = makeManifest();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith('imd-deployment.json')) return new Response(JSON.stringify(manifest), { status: 200 });
    if (url.endsWith('abi/LaunchToken.json')) return new Response(JSON.stringify(tokenAbiJson), { status: 200 });
    if (url.endsWith('abi/TakeProfitHook.json')) return new Response(JSON.stringify(hookAbiJson), { status: 200 });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      const reqs = Array.isArray(body) ? body : [body];
      const results = reqs.map((r) => {
        try {
          return { jsonrpc: '2.0', id: r.id, result: handleRpc(state, r.method, r.params) };
        } catch (e: any) {
          if (process.env.MOCK_DEBUG) console.log('mock rpc error', r.method, JSON.stringify(r.params)?.slice(0, 200), e.message);
          return { jsonrpc: '2.0', id: r.id, error: { code: e.code ?? -32000, message: e.message, data: e.data } };
        }
      });
      return new Response(JSON.stringify(Array.isArray(body) ? results : results[0]), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { provider, fetchMock, manifest };
}
