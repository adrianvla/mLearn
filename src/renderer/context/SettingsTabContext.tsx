import { createContext, useContext } from 'solid-js';

interface SettingsTabContextValue {
  tabId: string;
}

const SettingsTabContext = createContext<SettingsTabContextValue | undefined>(undefined);

export { SettingsTabContext };

export function useSettingsTab(): SettingsTabContextValue | undefined {
  return useContext(SettingsTabContext);
}
