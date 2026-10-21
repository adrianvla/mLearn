import { createContext, useContext, useMemo, useEffect, type PropsWithChildren } from 'react';
import { createHost } from '../host/createHost';
import {applyTheme} from '@mlearn/theme/runtime';
import type { Host } from '../host/types';
import { WindowChrome } from '../host/WindowChrome';
import { UIProvider } from '@mlearn/ui/provider';

const RuntimeContext = createContext<Host | null>(null);
export function RuntimeProvider({ children }: PropsWithChildren) {
  const host = useMemo(createHost, []);
  useEffect(()=>{let active=true;if(host.available)host.client.snapshot().then(s=>{if(active)applyTheme(s.theme);}).catch(()=>{/* Screens expose runtime recovery beside their action. */});return()=>{active=false;};},[host]);
  return <RuntimeContext.Provider value={host}><UIProvider windowMaterial={host.available && host.windowMaterial}>
    {children}<WindowChrome />
  </UIProvider></RuntimeContext.Provider>;
}
export function useRuntime(): Host {
  const host = useContext(RuntimeContext);
  if (!host) throw new Error('RuntimeProvider is missing');
  return host;
}
