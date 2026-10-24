import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';
import { RuntimeProvider } from '../bootstrap/RuntimeProvider';

export default function RootLayout() {
  const { theme } = useUnistyles();
  const navigationTheme = theme.shell.light ? DefaultTheme : DarkTheme;
  return <RuntimeProvider><ThemeProvider value={{ ...navigationTheme,
    colors: { ...navigationTheme.colors, background: 'transparent' } }}>
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }} />
  </ThemeProvider></RuntimeProvider>;
}
