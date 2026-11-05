import { createContext, useContext, type PropsWithChildren } from 'react';
import { PortalHost } from '@rn-primitives/portal';
import { SafeAreaProvider } from 'react-native-safe-area-context';
const WindowMaterial = createContext(false);
export function useWindowMaterial() { return useContext(WindowMaterial); }
export function UIProvider({ children, windowMaterial = false }: PropsWithChildren<{ windowMaterial?: boolean }>) {
  return <WindowMaterial.Provider value={windowMaterial}><SafeAreaProvider>{children}<PortalHost /></SafeAreaProvider></WindowMaterial.Provider>;
}
