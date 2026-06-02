import { createContext, useContext, Accessor } from 'solid-js';

export interface SettingsSearchContextValue {
  searchQuery: Accessor<string>;
  matchCounts: Accessor<Record<string, number>>;
  registerMatch: (tabId: string, rowId: string, matches: boolean) => void;
}

const SettingsSearchContext = createContext<SettingsSearchContextValue | undefined>(undefined);

export { SettingsSearchContext };

export function useSettingsSearch(): SettingsSearchContextValue | undefined {
  return useContext(SettingsSearchContext);
}
