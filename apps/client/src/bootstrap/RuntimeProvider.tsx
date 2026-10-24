import { createContext, useContext, useMemo, useEffect, useLayoutEffect, useState, type PropsWithChildren } from 'react';
import { createHost } from '../host/createHost';
import {applyTheme} from '@mlearn/theme/runtime';
import type { Host } from '../host/types';
import { WindowChrome } from '../host/WindowChrome';
import { UIProvider } from '@mlearn/ui/provider';

const RuntimeContext = createContext<Host | null>(null);
export function RuntimeProvider({ children }: PropsWithChildren) {
  const host = useMemo(createHost, []);
  const [windowMaterial, setWindowMaterial] = useState(false);
  useLayoutEffect(() => {
    if (host.available && host.initialTheme) applyTheme(host.initialTheme);
  }, [host]);
  useEffect(() => {
    if (!host.available || !host.subscribeWindowMaterial) return;
    let active = true;
    let stop: (() => void) | undefined;
    host.subscribeWindowMaterial(value => { if (active) setWindowMaterial(value); })
      .then(unsubscribe => { if (active) stop = unsubscribe; else unsubscribe(); })
      .catch(error => { console.error('Native window material unavailable', error); });
    return () => { active = false; stop?.(); };
  }, [host]);
  useEffect(()=>{let active=true;if(host.available)host.client.snapshot().then(s=>{if(active)applyTheme(s.theme);}).catch(()=>{/* Screens expose runtime recovery beside their action. */});return()=>{active=false;};},[host]);
  return <RuntimeContext.Provider value={host}><UIProvider windowMaterial={windowMaterial}>
    {children}<WindowChrome />
  </UIProvider></RuntimeContext.Provider>;
}
export function useRuntime(): Host {
  const host = useContext(RuntimeContext);
  if (!host) throw new Error('RuntimeProvider is missing');
  return host;
}
