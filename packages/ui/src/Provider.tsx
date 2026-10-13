import type { PropsWithChildren } from 'react';
import { PortalHost } from '@rn-primitives/portal';
import { SafeAreaProvider } from 'react-native-safe-area-context';
export function UIProvider({ children }: PropsWithChildren) {
  return <SafeAreaProvider>{children}<PortalHost /></SafeAreaProvider>;
}
