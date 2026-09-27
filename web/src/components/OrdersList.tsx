import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ActionStatus } from './ActionStatus';
import { useContractAction } from '../hooks/useContractAction';
import { useDeployment } from '../hooks/useDeployment';
import { useOrders, type OrderView } from '../hooks/useOrders';
import { useWallet } from '../hooks/useWallet';
import { describeError } from '../lib/errors';
import { formatAmount, formatSig, shortHash } from '../lib/format';
import { ethPerTokenAtTick } from '../lib/tick';

const STATUS_LABEL: Record<OrderView['status'], string> = {
  active: 'Active',
  filled: 'Filled, ready to withdraw',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

export function OrdersList() {
  const { hook, poolKey, network } = useDeployment();
  const wallet = useWallet();
  const owner = wallet.isConnected ? wallet.address : undefined;
  const orders = useOrders(owner);
  const queryClient = useQueryClient();
  const [active, setActive] = useState<{ id: string; kind: 'cancel' | 'withdraw' } | null>(null);
  const action = useContractAction(() => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['tokenAccount'] });
  });
  const explorer = network.explorer.replace(/\/$/, '');

  const cancel = (o: OrderView) => {
    if (!wallet.address) return;
    setActive({ id: o.orderId.toString(), kind: 'cancel' });
    action.execute({ address: hook.address, abi: hook.abi, functionName: 'cancelOrder', args: [poolKey, o.tickLower, false, wallet.address] });
  };
  const withdraw = (o: OrderView) => {
    if (!wallet.address) return;
    setActive({ id: o.orderId.toString(), kind: 'withdraw' });
    action.execute({ address: hook.address, abi: hook.abi, functionName: 'withdraw', args: [o.orderId, wallet.address] });
  };

  return (
    <section className="card" aria-labelledby="orders-heading">
      <div className="card-header">
        <h2 id="orders-heading">My orders</h2>
        {owner && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => orders.refetch()} disabled={orders.isFetching}>
            {orders.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {!owner && <p className="muted">Connect a wallet to see orders placed from its address. Orders are read from the hook's Place, Fill, Cancel and Withdraw events.</p>}
      {owner && orders.isLoading && (
        <p className="muted" role="status">
          Reading order events from {network.name}…
        </p>
      )}
      {owner && orders.isError && (
        <div className="notice notice-danger" role="alert">
          <span className="grow">
            Unable to read order events from the public RPC. Refresh to try again. <span className="caption">({describeError(orders.error)})</span>
          </span>
        </div>
      )}
      {owner && orders.data && orders.data.length === 0 && (
        <div>
          <p style={{ fontWeight: 500 }}>No orders yet</p>
          <p className="muted">Orders you place from this address appear here with their status, and can be cancelled or withdrawn.</p>
        </div>
      )}

      {owner && orders.data && orders.data.length > 0 && (
        <ul className="order-list">
          {orders.data.map((o) => {
            const id = o.orderId.toString();
            const canCancel = o.status === 'active' && wallet.onRightChain;
            const canWithdraw = o.status === 'filled' && wallet.onRightChain;
            const busyHere = action.busy && active?.id === id;
            return (
              <li key={id} className="order">
                <div className="order-head">
                  <div>
                    <span className={`badge badge-${o.status}`}>{STATUS_LABEL[o.status]}</span>
                  </div>
                  <span className="caption mono" title={`Order ID ${id}`}>
                    Order {id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id}
                  </span>
                </div>
                <dl className="details">
                  <dt>Range</dt>
                  <dd className="num">
                    tick {o.tickLower.toLocaleString('en-US')} to {(o.tickLower + poolKey.tickSpacing).toLocaleString('en-US')} ({formatSig(ethPerTokenAtTick(o.tickLower + poolKey.tickSpacing), 4)} to{' '}
                    {formatSig(ethPerTokenAtTick(o.tickLower), 4)} ETH per TKPF)
                  </dd>
                  <dt>Your liquidity</dt>
                  <dd className="num">
                    {o.remaining.toString()} of {o.placed.toString()} placed
                  </dd>
                  {(o.status === 'filled' || o.status === 'active') && (
                    <>
                      <dt>Order holds</dt>
                      <dd className="num">
                        {formatAmount(o.currency0Total, 18, 6)} ETH and {formatAmount(o.currency1Total, 18, 4)} TKPF in claims
                        {o.liquidityTotal > 0n && o.remaining > 0n ? ` (your share ${((Number(o.remaining) / Number(o.liquidityTotal)) * 100).toFixed(1)}%)` : ''}
                      </dd>
                    </>
                  )}
                  <dt>Last transaction</dt>
                  <dd>
                    <a href={`${explorer}/tx/${o.lastTxHash}`} target="_blank" rel="noreferrer">
                      {shortHash(o.lastTxHash)}
                    </a>
                  </dd>
                </dl>
                {(canCancel || canWithdraw || (!wallet.onRightChain && (o.status === 'active' || o.status === 'filled'))) && (
                  <div className="actions">
                    {o.status === 'active' && (
                      <button type="button" className="btn btn-danger btn-sm" disabled={!canCancel || action.busy} onClick={() => cancel(o)}>
                        {busyHere ? 'Cancelling…' : 'Cancel order'}
                      </button>
                    )}
                    {o.status === 'filled' && (
                      <button type="button" className="btn btn-primary btn-sm" disabled={!canWithdraw || action.busy} onClick={() => withdraw(o)}>
                        {busyHere ? 'Withdrawing…' : 'Withdraw proceeds'}
                      </button>
                    )}
                    {!wallet.onRightChain && <span className="caption">Switch to {network.name} to manage this order.</span>}
                    {o.status === 'active' && wallet.onRightChain && <span className="caption">Cancelling returns your TKPF, plus any ETH and fees earned so far.</span>}
                    {o.status === 'filled' && wallet.onRightChain && <span className="caption">Withdrawing sends your share of the ETH proceeds to your address.</span>}
                  </div>
                )}
                {active?.id === id && action.state.phase !== 'idle' && (
                  <ActionStatus
                    state={action.state}
                    labels={{ confirmed: active.kind === 'cancel' ? 'Order cancelled.' : 'Proceeds withdrawn.' }}
                    onDismiss={() => {
                      action.reset();
                      setActive(null);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
