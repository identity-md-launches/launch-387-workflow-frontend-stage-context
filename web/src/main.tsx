import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadDeployment } from './lib/deployment';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

root.render(
  <div className="boot" role="status">
    <p className="muted">Loading deployment configuration…</p>
  </div>,
);

loadDeployment()
  .then((deployment) => {
    root.render(
      <StrictMode>
        <App deployment={deployment} />
      </StrictMode>,
    );
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    root.render(
      <div className="boot" role="alert">
        <div>
          <h1>Unable to load deployment configuration</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            {message}
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            The page needs imd-deployment.json and the ABI files next to index.html. Reload to try again.
          </p>
        </div>
      </div>,
    );
  });
