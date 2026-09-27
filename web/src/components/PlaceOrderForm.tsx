import { useId, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { ActionStatus } from './ActionStatus';
import { useContractAction } from '../hooks/useContractAction';
import { useDeployment } from '../hooks/useDeployment';
import { usePoolState, useTokenAccount } from '../hooks/usePool';
import { useWallet } from '../hooks/useWallet';
import { formatAmount, formatSig, formatWithGroups, parseDecimalAmount, parsePrice } from '../lib/format';
import { ethPerTokenAtTick, expectedEthOut, targetTick, tokenPerEthAtTick, type PriceUnit } from '../lib/tick';

const TOKEN_DECIMALS = 18;

export function PlaceOrderForm() {
  const ids = { unit: useId(), price: useId(), amount: useId(), priceErr: useId(), amountErr: useId(), preview: useId() };
  const { token, hook, poolKey } = useDeployment();
  const client = usePublicClient();
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const pool = usePoolState();
  const account = useTokenAccount(wallet.onRightChain ? wallet.address : undefined);

  const [unit, setUnit] = useState<PriceUnit>('ethPerToken');
  const [priceText, setPriceText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const price = parsePrice(priceText);
  const amountWei = parseDecimalAmount(amountText, TOKEN_DECIMALS);
  const spacing = poolKey.tickSpacing;

  const target = useMemo(() => {
    if (price === null || !pool.data) return null;
    return targetTick(price, unit, pool.data.tick, spacing);
  }, [price, unit, pool.data, spacing]);

  const priceError =
    priceText === '' ? (submitted ? 'Enter a target price.' : null) : price === null ? 'Enter a number greater than zero, for example 0.00000003.' : target && !target.ok ? target.reason ?? null : null;
  const amountError =
    amountText === '' ? (submitted ? 'Enter an amount of TKPF.' : null) : amountWei === null ? 'Enter a decimal amount with at most 18 decimals.' : amountWei === 0n ? 'Enter an amount greater than zero.' : account.data && amountWei > account.data.balance ? 'The amount is more than your TKPF balance.' : null;

  const previewReady = !!target?.ok && amountWei !== null && amountWei > 0n;

  const liquidity = useQuery({
    queryKey: ['liquidityForAmount', target?.tick, amountWei?.toString()],
    enabled: previewReady && !!client,
    queryFn: async () =>
      client!.readContract({ address: hook.address, abi: hook.abi, functionName: 'liquidityForAmount', args: [target!.tick, amountWei!] }) as Promise<bigint>,
    retry: false,
  });

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ['tokenAccount'] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['pool'] });
  };
  const approve = useContractAction(refetchAll);
  const place = useContractAction(() => {
    refetchAll();
    setAmountText('');
    setSubmitted(false);
  });

  const needsApproval = account.data !== undefined && amountWei !== null && account.data.allowance < amountWei;
  const canAct = wallet.isConnected && wallet.onRightChain && !!account.data;
  // Contract-safety prerequisites keep the button disabled; input validation runs on submit.
  const placeDisabled = !canAct || needsApproval || approve.busy || place.busy;

  const onApprove = () => {
    if (!amountWei) return;
    approve.execute({ address: token.address, abi: token.abi, functionName: 'approve', args: [hook.address, amountWei] });
  };

  const onPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const form = e.currentTarget as HTMLFormElement;
    if (placeDisabled || !target?.ok || !amountWei || amountError || priceError || liquidity.isError) {
      const firstInvalid = form.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ?? (!priceText ? form.querySelector<HTMLInputElement>(`#${CSS.escape(ids.price)}`) : form.querySelector<HTMLInputElement>(`#${CSS.escape(ids.amount)}`));
      firstInvalid?.focus();
      return;
    }
    // Re-read the pool right before sending: a quoted tick can become in-range.
    const fresh = await pool.refetch();
    const nowTick = fresh.data?.tick ?? pool.data?.tick;
    if (nowTick !== undefined && price !== null) {
      const recheck = targetTick(price, unit, nowTick, spacing);
      if (!recheck.ok || recheck.tick !== target.tick) {
        setPriceText((t) => t); // keep input; error shows via derived state
        return;
      }
    }
    place.execute({ address: hook.address, abi: hook.abi, functionName: 'placeTakeProfit', args: [poolKey, target.tick, amountWei] });
  };

  const amountNumber = amountWei !== null ? Number(formatUnits(amountWei, TOKEN_DECIMALS)) : 0;

  return (
    <section className="card" aria-labelledby="place-heading">
      <div className="card-header">
        <h2 id="place-heading">Place a take-profit order</h2>
        {account.data && (
          <span className="muted num">
            Balance {formatAmount(account.data.balance, TOKEN_DECIMALS, 4)} TKPF
          </span>
        )}
      </div>
      <p className="muted">
        A take-profit sells TKPF for ETH once the price rises into a 60-tick range at or above your target. The order fills when a buy
        fully crosses that range; a price still inside the range leaves it active.
      </p>

      {!wallet.isConnected && (
        <div className="notice notice-info" role="status">
          <span className="grow">Connect a wallet to place an order. You can preview a target without connecting.</span>
        </div>
      )}
      {wallet.isConnected && !wallet.onRightChain && (
        <div className="notice notice-warning" role="status">
          <span className="grow">Switch your wallet to the pool's network to place an order.</span>
        </div>
      )}

      <form className="form" onSubmit={onPlace} noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor={ids.unit}>Price unit</label>
            <select id={ids.unit} value={unit} onChange={(e) => setUnit(e.target.value as PriceUnit)}>
              <option value="ethPerToken">ETH per TKPF</option>
              <option value="tokenPerEth">TKPF per ETH</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.price}>Target price</label>
            <input
              id={ids.price}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={unit === 'ethPerToken' ? 'for example 0.00000003' : 'for example 30000000'}
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              aria-invalid={priceError ? 'true' : undefined}
              aria-describedby={priceError ? ids.priceErr : undefined}
            />
            {priceError ? (
              <span id={ids.priceErr} className="error">
                {priceError}
              </span>
            ) : (
              <span className="hint">
                {unit === 'ethPerToken' ? 'Rounded down to the nearest valid tick, so the order fills at or above this price.' : 'Rounded to the nearest valid tick so the order fills at this rate or better.'}
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor={ids.amount}>Amount to sell (TKPF)</label>
          <div className="input-group">
            <input
              id={ids.amount}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="for example 1000"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              aria-invalid={amountError ? 'true' : undefined}
              aria-describedby={amountError ? ids.amountErr : undefined}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!account.data}
              onClick={() => account.data && setAmountText(formatUnits(account.data.balance, TOKEN_DECIMALS))}
            >
              Use max
            </button>
          </div>
          {amountError && (
            <span id={ids.amountErr} className="error">
              {amountError}
            </span>
          )}
        </div>

        {target?.ok && (
          <dl className="details" id={ids.preview} aria-label="Order preview">
            <dt>Order tick</dt>
            <dd className="num">
              {target.tick.toLocaleString('en-US')} (range {target.tick.toLocaleString('en-US')} to {(target.tick + spacing).toLocaleString('en-US')}; current range starts at{' '}
              {target.currentRange.toLocaleString('en-US')})
            </dd>
            <dt>Executes between</dt>
            <dd className="num">
              {formatSig(ethPerTokenAtTick(target.tick + spacing), 4)} and {formatSig(ethPerTokenAtTick(target.tick), 4)} ETH per TKPF ({formatWithGroups(tokenPerEthAtTick(target.tick + spacing), 4)} to{' '}
              {formatWithGroups(tokenPerEthAtTick(target.tick), 4)} TKPF per ETH)
            </dd>
            {previewReady && (
              <>
                <dt>Expected ETH if filled</dt>
                <dd className="num">about {formatSig(expectedEthOut(amountNumber, target.tick, spacing), 4)} ETH, plus any LP fees earned</dd>
                <dt>Liquidity</dt>
                <dd className="num">
                  {liquidity.data !== undefined ? liquidity.data.toString() : liquidity.isError ? 'Amount too small for this range. Enter a larger amount.' : 'Calculating…'}
                </dd>
              </>
            )}
          </dl>
        )}

        <ol className="steps" aria-label="Steps">
          <li className={`step ${canAct && !needsApproval && amountWei ? 'step-done' : ''}`}>
            <div className="step-body">
              <span>
                Approve the hook to spend {amountWei ? `${formatAmount(amountWei, TOKEN_DECIMALS, 4)} TKPF` : 'the amount'}.
                {account.data && amountWei && !needsApproval ? ' Approved.' : ''}
              </span>
              {needsApproval && (
                <div className="actions">
                  <button type="button" className="btn btn-secondary" disabled={!canAct || approve.busy || !!amountError} onClick={onApprove}>
                    {approve.busy ? 'Approving…' : 'Approve TKPF'}
                  </button>
                </div>
              )}
              {approve.state.phase !== 'idle' && <ActionStatus state={approve.state} labels={{ confirmed: 'Approval confirmed.' }} onDismiss={approve.reset} />}
            </div>
          </li>
          <li className={`step ${place.state.phase === 'confirmed' ? 'step-done' : ''}`}>
            <div className="step-body">
              <span>Place the order. The transaction moves your TKPF into the pool as a one-range limit order.</span>
              <div className="actions">
                <button type="submit" className="btn btn-primary" disabled={placeDisabled}>
                  {place.busy ? 'Placing…' : 'Place take-profit order'}
                </button>
                {!canAct && <span className="caption">Connect a wallet on the right network to enable this step.</span>}
                {canAct && needsApproval && <span className="caption">Approve first.</span>}
              </div>
              {place.state.phase !== 'idle' && <ActionStatus state={place.state} labels={{ confirmed: 'Order placed.' }} onDismiss={place.reset} />}
            </div>
          </li>
        </ol>
      </form>
    </section>
  );
}
