import { Stack } from 'expo-router';
import { UIProvider } from '@mlearn/ui/provider';
import { RuntimeProvider } from '../bootstrap/RuntimeProvider';

export default function RootLayout() {
  return <UIProvider><RuntimeProvider><Stack screenOptions={{ headerShown: false }} /></RuntimeProvider></UIProvider>;
}
