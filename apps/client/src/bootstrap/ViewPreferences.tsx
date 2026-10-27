import { createContext, useContext } from 'react';
import type { ViewPreferences } from '@mlearn/contracts';

/** Only an acknowledged native value is published; this context owns no persistence. */
export const ViewPreferencesContext = createContext<{
  value: ViewPreferences | null;
  publish: (value: ViewPreferences | null) => void;
} | null>(null);

export function useInlineLevelScale(): string | null {
  return useContext(ViewPreferencesContext)?.value?.inlineLevelScale ?? null;
}
export function useStarCollapse() {
  return useContext(ViewPreferencesContext)?.value?.starCollapse ?? 'auto';
}
export function useViewPreferences() {
  const context = useContext(ViewPreferencesContext);
  if (!context) throw new Error('RuntimeProvider is missing');
  return context;
}
