import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { decodeFunctionData } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { loadDeployment } from './lib/deployment';
import { HOOK, OWNER, TOKEN, hookAbi, installMock, makeState, tokenAbi, type MockState } from './test/mockChain';

const LONG = { timeout: 10_000 };

async function renderApp(state: MockState, opts: { withWallet?: boolean } = {}) {
  const mock = installMock(state, opts);
  const deployment = await loadDeployment('http://localhost/preview/');
  render(<App deployment={deployment} storage={null} />);
  return { ...mock, deployment };
}

async function connect() {
  await userEvent.click(await screen.findByRole('button', { name: /connect wallet/i }));
  await screen.findByText(/0x1111…1111/, undefined, LONG);
}

describe('deployment loading', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads the manifest and ABIs relative to the page', async () => {
    const state = makeState();
    const { deployment, fetchMock } = await renderApp(state);
    expect(deployment.hook.address).toBe(HOOK);
    expect(deployment.token.address).toBe(TOKEN);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('http://localhost/preview/imd-deployment.json');
    expect(urls).toContain('http://localhost/preview/abi/TakeProfitHook.json');
    expect(urls).toContain('http://localhost/preview/abi/LaunchToken.json');
  });
});

describe('App', () => {
  let state: MockState;
  beforeEach(() => {
    state = makeState();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the live price both ways and contract links without a wallet', async () => {
    await renderApp(state);
    const price = await screen.findByRole('region', { name: /current price/i });
    await within(price).findByText(/50,000,0\d\d/, undefined, LONG);
    expect(within(price).getByText('TKPF per ETH')).toBeInTheDocument();
    expect(within(price).getByText('ETH per TKPF')).toBeInTheDocument();
    expect(within(price).getAllByText(/0\.0000000\d+/).length).toBeGreaterThan(0);
    expect(within(price).getByText('177,284')).toBeInTheDocument();
    expect(within(price).getByText(/no liquidity is active/i)).toBeInTheDocument();
    const contracts = screen.getByRole('region', { name: /contracts and network/i });
    expect(within(contracts).getByRole('link', { name: HOOK })).toHaveAttribute('href', `https://sepolia.etherscan.io/address/${HOOK}`);
    expect(within(contracts).getByRole('link', { name: TOKEN })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place take-profit order/i })).toBeDisabled();
    expect(screen.getByText(/connect a wallet to place an order/i)).toBeInTheDocument();
  });

  it('explains when no browser wallet is installed', async () => {
    await renderApp(state, { withWallet: false });
    expect(await screen.findByText(/no browser wallet found/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect wallet/i })).not.toBeInTheDocument();
  });

  it('offers a switch and adds the chain after the wallet reports it unknown', async () => {
    state.walletChainId = 1;
    state.knownChains = new Set([1]);
    const { provider } = await renderApp(state);
    await connect();
    expect(await screen.findByText(/wrong network/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place take-profit order/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /switch to sepolia/i }));
    await waitFor(() => expect(screen.getByText('Sepolia', { selector: '.badge' })).toBeInTheDocument(), LONG);
    const methods = provider.request.mock.calls.map((c: any) => c[0].method);
    const first = methods.indexOf('wallet_switchEthereumChain');
    expect(methods.slice(first, first + 3)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    const addParams = provider.request.mock.calls.find((c: any) => c[0].method === 'wallet_addEthereumChain')![0].params[0];
    expect(addParams.chainId).toBe('0xaa36a7');
    expect(addParams.rpcUrls).toEqual(state.requests.length ? ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.ethpandaops.io', 'https://sepolia.rpc.sentio.xyz'] : []);
  });

  it('can approve right after the add-chain flow (wallet client is not stale)', async () => {
    state.walletChainId = 1;
    state.knownChains = new Set([1]);
    await renderApp(state);
    await connect();
    await userEvent.click(await screen.findByRole('button', { name: /switch to sepolia/i }));
    await waitFor(() => expect(screen.getByText('Sepolia', { selector: '.badge' })).toBeInTheDocument(), LONG);
    await screen.findByText(/balance 1,000,000 tkpf/i, undefined, LONG);
    await userEvent.type(screen.getByLabelText(/target price/i), '0.00000003');
    await userEvent.type(screen.getByLabelText(/amount to sell/i), '1000');
    await userEvent.click(await screen.findByRole('button', { name: /approve tkpf/i }));
    await screen.findByText(/approval confirmed/i, undefined, LONG);
    expect(state.sent).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('validates the target price and amount on submit', async () => {
    await renderApp(state);
    await connect();
    await screen.findByText(/balance 1,000,000 tkpf/i, undefined, LONG);
    const price = screen.getByLabelText(/target price/i);
    await userEvent.type(price, '0.00000001'); // below the current price
    expect(await screen.findByText(/must be above the current price/i)).toBeInTheDocument();
    expect(price).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(price);
    await userEvent.type(price, '0.00000003');
    expect(await screen.findByText('173,220', { exact: false })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /place take-profit order/i }));
    expect(await screen.findByText(/enter an amount of tkpf/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/amount to sell/i)).toHaveFocus();
    expect(state.sent).toHaveLength(0);
  });

  it('places an order: approve TKPF, then placeTakeProfit with the rounded tick', async () => {
    await renderApp(state);
    await connect();
    await screen.findByText(/balance 1,000,000 tkpf/i, undefined, LONG);
    await userEvent.type(screen.getByLabelText(/target price/i), '0.00000003');
    await userEvent.type(screen.getByLabelText(/amount to sell/i), '1000');
    expect(await screen.findByText(/expected eth if filled/i)).toBeInTheDocument();
    expect(await screen.findByText(/about 0\.0000\d+ ETH/)).toBeInTheDocument();
    const approveBtn = await screen.findByRole('button', { name: /approve tkpf/i });
    expect(screen.getByRole('button', { name: /place take-profit order/i })).toBeDisabled();
    await userEvent.click(approveBtn);
    await screen.findByText(/approval confirmed/i, undefined, LONG);
    expect(state.sent).toHaveLength(1);
    const approve = decodeFunctionData({ abi: tokenAbi, data: state.sent[0]!.data });
    expect(state.sent[0]!.to.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(approve.functionName).toBe('approve');
    expect((approve.args as any)[0].toLowerCase()).toBe(HOOK.toLowerCase());
    expect((approve.args as any)[1]).toBe(1000n * 10n ** 18n);

    const placeBtn = screen.getByRole('button', { name: /place take-profit order/i });
    await waitFor(() => expect(placeBtn).toBeEnabled(), LONG);
    await userEvent.click(placeBtn);
    await screen.findByText(/order placed/i, undefined, LONG);
    expect(state.sent).toHaveLength(2);
    expect(state.sent[1]!.to.toLowerCase()).toBe(HOOK.toLowerCase());
    const place = decodeFunctionData({ abi: hookAbi, data: state.sent[1]!.data });
    expect(place.functionName).toBe('placeTakeProfit');
    const [key, tick, amount] = place.args as any;
    expect(key.currency0).toBe('0x0000000000000000000000000000000000000000');
    expect(key.currency1.toLowerCase()).toBe(TOKEN.toLowerCase());
    expect(key.fee).toBe(3000);
    expect(key.tickSpacing).toBe(60);
    expect(key.hooks.toLowerCase()).toBe(HOOK.toLowerCase());
    expect(tick).toBe(173220);
    expect(amount).toBe(1000n * 10n ** 18n);
    // The new order shows up in the list.
    const orders = screen.getByRole('region', { name: /my orders/i });
    await within(orders).findByText(/^active$/i, undefined, LONG);
  });

  it('surfaces a simulation revert before the wallet opens', async () => {
    state.allowance = 10n ** 30n;
    state.revertWith.placeTakeProfit = 'InRange';
    await renderApp(state);
    await connect();
    await screen.findByText(/balance 1,000,000 tkpf/i, undefined, LONG);
    await userEvent.type(screen.getByLabelText(/target price/i), '0.00000003');
    await userEvent.type(screen.getByLabelText(/amount to sell/i), '1000');
    await userEvent.click(screen.getByRole('button', { name: /place take-profit order/i }));
    const alert = await screen.findByRole('alert', undefined, LONG);
    expect(alert).toHaveTextContent(/moved into that price range/i);
    expect(alert).toHaveTextContent(/InRange/);
    expect(state.sent).toHaveLength(0);
  });

  it('reports a wallet rejection without pretending anything was sent', async () => {
    state.allowance = 10n ** 30n;
    state.rejectSend = true;
    await renderApp(state);
    await connect();
    await screen.findByText(/balance 1,000,000 tkpf/i, undefined, LONG);
    await userEvent.type(screen.getByLabelText(/target price/i), '0.00000003');
    await userEvent.type(screen.getByLabelText(/amount to sell/i), '1000');
    await userEvent.click(screen.getByRole('button', { name: /place take-profit order/i }));
    const alert = await screen.findByRole('alert', undefined, LONG);
    expect(alert).toHaveTextContent(/rejected in the wallet/i);
  });

  it('lists orders from events with status, and cancels or withdraws them', async () => {
    state.orders = [
      { orderId: 1n, tickLower: 173220, placedLiquidity: 500n, remaining: 500n, filled: false, liquidityTotal: 1000n, currency1Total: 0n },
      { orderId: 2n, tickLower: 172980, placedLiquidity: 300n, remaining: 300n, filled: true, liquidityTotal: 300n, currency0Total: 12345600000000000n, currency1Total: 0n },
      { orderId: 3n, tickLower: 172920, placedLiquidity: 100n, remaining: 0n, filled: false, cancelled: 100n },
    ];
    await renderApp(state);
    await connect();
    const orders = screen.getByRole('region', { name: /my orders/i });
    const items = await within(orders).findAllByRole('listitem', undefined, LONG);
    expect(items).toHaveLength(3);
    expect(within(orders).getByText(/^active$/i)).toBeInTheDocument();
    expect(within(orders).getByText(/filled, ready to withdraw/i)).toBeInTheDocument();
    expect(within(orders).getByText(/^cancelled$/i)).toBeInTheDocument();
    expect(within(orders).getByText(/500 of 500 placed/)).toBeInTheDocument();
    expect(within(orders).getByText(/0\.012345 ETH/)).toBeInTheDocument();

    await userEvent.click(within(orders).getByRole('button', { name: /withdraw proceeds/i }));
    await within(orders).findByText(/proceeds withdrawn/i, undefined, LONG);
    const w = decodeFunctionData({ abi: hookAbi, data: state.sent[0]!.data });
    expect(w.functionName).toBe('withdraw');
    expect((w.args as any)[0]).toBe(2n);
    expect((w.args as any)[1].toLowerCase()).toBe(OWNER.toLowerCase());

    await userEvent.click(within(orders).getByRole('button', { name: /cancel order/i }));
    await within(orders).findByText(/order cancelled/i, undefined, LONG);
    const c = decodeFunctionData({ abi: hookAbi, data: state.sent[1]!.data });
    expect(c.functionName).toBe('cancelOrder');
    const [key, tickLower, zeroForOne, to] = c.args as any;
    expect(key.hooks.toLowerCase()).toBe(HOOK.toLowerCase());
    expect(tickLower).toBe(173220);
    expect(zeroForOne).toBe(false);
    expect(to.toLowerCase()).toBe(OWNER.toLowerCase());
    // After refetch both are done.
    await waitFor(() => expect(within(orders).getByText(/^withdrawn$/i)).toBeInTheDocument(), LONG);
  });

  it('shows an error when the public RPC cannot be read', async () => {
    const { fetchMock } = await renderApp(state);
    fetchMock.mockImplementation(async (_input: any, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('bad gateway', { status: 502 });
      return new Response('not found', { status: 404 });
    });
    await userEvent.click(await screen.findByRole('button', { name: /^refresh$/i }));
    expect(await screen.findByText(/unable to read the pool/i, undefined, LONG)).toBeInTheDocument();
  });
});
