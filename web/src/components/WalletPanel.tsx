import { useDeployment } from '../hooks/useDeployment';
import { useWallet } from '../hooks/useWallet';
import { shortAddress } from '../lib/format';

export function WalletPanel() {
  const { network } = useDeployment();
  const w = useWallet();

  if (!w.isConnected) {
    return (
      <div className="actions" aria-label="Wallet">
        {w.hasBrowserWallet ? (
          w.connectors.length > 1 ? (
            w.connectors.map((c) => (
              <button key={c.uid} type="button" className="btn btn-primary" disabled={w.connecting} onClick={() => w.connect(c.id)}>
                Connect {c.name}
              </button>
            ))
          ) : (
            <button type="button" className="btn btn-primary" disabled={w.connecting} onClick={() => w.connect()}>
              {w.connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          )
        ) : (
          <p className="muted">No browser wallet found. Install a browser wallet such as MetaMask, then reload this page.</p>
        )}
        {w.error && (
          <p className="error caption" role="alert">
            {w.error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="actions" aria-label="Wallet">
      <span className="mono" title={w.address}>
        {shortAddress(w.address ?? '')}
      </span>
      {w.onRightChain ? (
        <span className="badge badge-filled">{network.name}</span>
      ) : (
        <>
          <span className="badge badge-cancelled">Wrong network</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={w.switching} onClick={w.switchToNetwork}>
            {w.switching ? 'Switching…' : `Switch to ${network.name}`}
          </button>
        </>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={w.disconnect}>
        Disconnect
      </button>
      {w.error && (
        <p className="error caption" role="alert" style={{ flexBasis: '100%' }}>
          {w.error}
        </p>
      )}
    </div>
  );
}
