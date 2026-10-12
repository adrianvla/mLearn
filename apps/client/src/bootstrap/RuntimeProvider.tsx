import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { createHost } from '../host/createHost';
import type { Host } from '../host/types';

const RuntimeContext = createContext<Host | null>(null);
export function RuntimeProvider({ children }: PropsWithChildren) {
  const host = useMemo(createHost, []);
  return <RuntimeContext.Provider value={host}>{children}</RuntimeContext.Provider>;
}
export function useRuntime(): Host {
  const host = useContext(RuntimeContext);
  if (!host) throw new Error('RuntimeProvider is missing');
  return host;
}
