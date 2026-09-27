import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { WagmiProvider } from 'wagmi';
import { ContractsCard } from './components/ContractsCard';
import { OrdersList } from './components/OrdersList';
import { PlaceOrderForm } from './components/PlaceOrderForm';
import { PriceCard } from './components/PriceCard';
import { WalletPanel } from './components/WalletPanel';
import { DeploymentProvider } from './hooks/useDeployment';
import { createAppConfig } from './lib/chain';
import type { Deployment } from './lib/deployment';

export function App({ deployment, storage }: { deployment: Deployment; storage?: Storage | null }) {
  const config = useMemo(() => createAppConfig(deployment.network, storage), [deployment, storage]);
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }), []);
  return (
    <DeploymentProvider deployment={deployment}>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
          <div className="page">
            <header className="page-header">
              <div>
                <h1>Takeprofit (TKPF) take-profit orders</h1>
                <p className="lede">
                  Sell TKPF for ETH at a price you choose on the {deployment.network.name} Uniswap v4 pool. Orders are one-range limit orders held by the
                  TakeProfitHook; there is no backend and no administrator.
                </p>
              </div>
              <WalletPanel />
            </header>
            <main id="main" style={{ display: 'contents' }}>
              <PriceCard />
              <PlaceOrderForm />
              <OrdersList />
              <ContractsCard />
            </main>
            <footer className="footer">
              <p>
                Reads use the public RPC endpoints listed above; transactions are signed only in your wallet. Prices can be moved by anyone trading the pool;
                an order executes across its range, not at one guaranteed price.
              </p>
            </footer>
          </div>
        </QueryClientProvider>
      </WagmiProvider>
    </DeploymentProvider>
  );
}
