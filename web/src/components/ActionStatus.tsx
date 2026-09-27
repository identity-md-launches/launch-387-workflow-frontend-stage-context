import type { ActionState } from '../hooks/useContractAction';
import { useDeployment } from '../hooks/useDeployment';
import { shortHash } from '../lib/format';

/**
 * One live region per action. Progress uses role="status" (polite); errors
 * use role="alert" and stay until dismissed.
 */
export function ActionStatus({ state, labels, onDismiss }: { state: ActionState; labels: { confirmed: string }; onDismiss?: () => void }) {
  const { network } = useDeployment();
  const txLink = state.hash ? (
    <a href={`${network.explorer.replace(/\/$/, '')}/tx/${state.hash}`} target="_blank" rel="noreferrer">
      View transaction {shortHash(state.hash)}
    </a>
  ) : null;

  if (state.phase === 'error') {
    return (
      <div className="notice notice-danger" role="alert">
        <span className="grow">{state.message}</span>
        {txLink}
        {onDismiss && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={`notice ${state.phase === 'confirmed' ? 'notice-success' : 'notice-info'}`} role="status">
      {state.phase === 'simulating' && (
        <>
          <span className="spinner" aria-hidden="true" /> <span className="grow">Checking the transaction against the pool…</span>
        </>
      )}
      {state.phase === 'wallet' && (
        <>
          <span className="spinner" aria-hidden="true" /> <span className="grow">Confirm in your wallet.</span>
        </>
      )}
      {state.phase === 'pending' && (
        <>
          <span className="spinner" aria-hidden="true" /> <span className="grow">Waiting for confirmation on {network.name}.</span> {txLink}
        </>
      )}
      {state.phase === 'confirmed' && (
        <>
          <span className="grow">{labels.confirmed}</span> {txLink}
          {onDismiss && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onDismiss}>
              Dismiss
            </button>
          )}
        </>
      )}
    </div>
  );
}
