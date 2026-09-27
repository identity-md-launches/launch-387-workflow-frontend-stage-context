import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Deployment } from '../lib/deployment';
import { poolIdOf, poolKeyFor, type PoolKey } from '../lib/pool';
import type { Hex } from 'viem';

interface DeploymentContextValue extends Deployment {
  poolKey: PoolKey;
  poolId: Hex;
}

const Ctx = createContext<DeploymentContextValue | null>(null);

export function DeploymentProvider({ deployment, children }: { deployment: Deployment; children: ReactNode }) {
  const value = useMemo(() => {
    const poolKey = poolKeyFor(deployment.token.address, deployment.hook.address);
    return { ...deployment, poolKey, poolId: poolIdOf(poolKey) };
  }, [deployment]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeployment(): DeploymentContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDeployment must be used inside DeploymentProvider');
  return v;
}
