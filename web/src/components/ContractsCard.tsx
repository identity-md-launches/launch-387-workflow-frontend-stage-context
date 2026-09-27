import { useDeployment } from '../hooks/useDeployment';

export function ContractsCard() {
  const { manifest, network, token, hook } = useDeployment();
  const explorer = network.explorer.replace(/\/$/, '');
  const rows = [
    { name: 'Takeprofit token (TKPF)', address: token.address, abiHash: token.abiHash },
    { name: 'TakeProfitHook', address: hook.address, abiHash: hook.abiHash },
    { name: 'Uniswap v4 PoolManager', address: network.uniswapV4.poolManager },
    { name: 'Uniswap v4 StateView (price reads)', address: network.uniswapV4.stateView },
  ];
  return (
    <section className="card" aria-labelledby="contracts-heading">
      <h2 id="contracts-heading">Contracts and network</h2>
      <div className="contracts">
        {rows.map((r) => (
          <div className="contract" key={r.address}>
            <span>{r.name}</span>
            <a className="mono" href={`${explorer}/address/${r.address}`} target="_blank" rel="noreferrer">
              {r.address}
            </a>
            {r.abiHash && <span className="caption mono">ABI keccak {r.abiHash.slice(0, 16)}…</span>}
          </div>
        ))}
      </div>
      <dl className="details">
        <dt>Network</dt>
        <dd>
          {network.name} (chain ID {network.chainId}){network.testnet ? ', test network' : ''}
        </dd>
        <dt>Pool</dt>
        <dd>ETH / TKPF, 0.30% fee, tick spacing 60, hooked by TakeProfitHook</dd>
        <dt>Public RPC</dt>
        <dd className="mono">{network.rpcUrls.join(', ')}</dd>
        <dt>Launch</dt>
        <dd className="mono">{manifest.launchId}</dd>
        <dt>Source commit</dt>
        <dd className="mono">{manifest.sourceCommit}</dd>
      </dl>
      {network.testnet && network.faucets.length > 0 && (
        <p className="caption">
          Need test ETH for gas? Faucets:{' '}
          {network.faucets.map((f, i) => (
            <span key={f}>
              <a href={f} target="_blank" rel="noreferrer">
                {new URL(f).hostname}
              </a>
              {i < network.faucets.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
