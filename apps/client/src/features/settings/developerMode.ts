import { useSyncExternalStore } from 'react';

// A presentation preference, not learner state: it only reveals diagnostic surfaces.
// Web persists it in localStorage; other hosts keep it for the running session.
const KEY = 'mlearn.developerMode';
const listeners = new Set<() => void>();
const storage = typeof localStorage === 'undefined' ? null : localStorage;
let enabled = storage?.getItem(KEY) === 'true';

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDeveloperMode(): readonly [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(subscribe, () => enabled, () => false);
  return [value, (next: boolean) => {
    enabled = next;
    if (next) storage?.setItem(KEY, 'true'); else storage?.removeItem(KEY);
    listeners.forEach(listener => listener());
  }];
}
