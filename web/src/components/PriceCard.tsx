import { useEffect, useState } from 'react';
import { useDeployment } from '../hooks/useDeployment';
import { usePoolState } from '../hooks/usePool';
import { describeError } from '../lib/errors';
import { formatAmount, formatSig, formatWithGroups } from '../lib/format';
import { ethPerTokenAtTick, ethPerTokenFromSqrtPrice, tokenPerEthAtTick, tokenPerEthFromSqrtPrice } from '../lib/tick';

function useAgo(ts: number | undefined) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 5 ? 'just now' : `${s} s ago`;
}

export function PriceCard() {
  const { poolKey, network } = useDeployment();
  const pool = usePoolState();
  const ago = useAgo(pool.data?.fetchedAt);
  const d = pool.data;

  return (
    <section className="card" aria-labelledby="price-heading">
      <div className="card-header">
        <h2 id="price-heading">Current price</h2>
        <div className="actions">
          <span className="caption" role="status">
            {pool.isFetching ? 'Refreshing…' : d ? `Updated ${ago}` : ''}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => pool.refetch()} disabled={pool.isFetching}>
            Refresh
          </button>
        </div>
      </div>

      {pool.isError && (
        <div className="notice notice-danger" role="alert">
          <span className="grow">
            Unable to read the pool from the public RPC. Check your connection and refresh. <span className="caption">({describeError(pool.error)})</span>
          </span>
        </div>
      )}
      {!d && !pool.isError && (
        <p className="muted" role="status">
          Loading pool state from {network.name}…
        </p>
      )}

      {d && (
        <>
          <dl className="stats">
            <div className="stat">
              <dt>TKPF per ETH</dt>
              <dd>
                {formatWithGroups(tokenPerEthFromSqrtPrice(d.sqrtPriceX96), 6)} <small>TKPF</small>
              </dd>
            </div>
            <div className="stat">
              <dt>ETH per TKPF</dt>
              <dd>
                {formatSig(ethPerTokenFromSqrtPrice(d.sqrtPriceX96), 6)} <small>ETH</small>
              </dd>
            </div>
          </dl>
          <dl className="details">
            <dt>Current tick</dt>
            <dd className="num">{d.tick.toLocaleString('en-US')}</dd>
            <dt>Current range</dt>
            <dd className="num">
              {d.currentRange.toLocaleString('en-US')} to {(d.currentRange + poolKey.tickSpacing).toLocaleString('en-US')} ({formatSig(ethPerTokenAtTick(d.currentRange + poolKey.tickSpacing), 4)} to{' '}
              {formatSig(ethPerTokenAtTick(d.currentRange), 4)} ETH per TKPF, {formatWithGroups(tokenPerEthAtTick(d.currentRange), 4)} to{' '}
              {formatWithGroups(tokenPerEthAtTick(d.currentRange + poolKey.tickSpacing), 4)} TKPF per ETH)
            </dd>
            <dt>Liquidity in range</dt>
            <dd className="num">{d.liquidity === 0n ? 'None' : formatAmount(d.liquidity, 0, 0)}</dd>
            <dt>LP fee</dt>
            <dd className="num">{(d.lpFee / 10_000).toFixed(2)}%</dd>
            <dt>Hook cursor</dt>
            <dd className="num">tick {d.tickLowerLast.toLocaleString('en-US')}</dd>
          </dl>
          {d.liquidity === 0n && (
            <p className="caption">
              No liquidity is active at the current price. A buy moves the price down to the nearest liquidity; orders below the
              current range still fill when a buy crosses them.
            </p>
          )}
        </>
      )}
    </section>
  );
}
