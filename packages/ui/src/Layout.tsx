import type { PropsWithChildren } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';

export function Screen({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return <ScrollView style={styles.screen} contentContainerStyle={styles.scroll(insets.top, insets.bottom)} keyboardShouldPersistTaps="handled"><View style={styles.content}>{children}</View></ScrollView>;
}
export function Panel({ children }: PropsWithChildren) { return <View style={styles.panel}>{children}</View>; }
export function Stack({ children }: PropsWithChildren) { return <View style={styles.stack}>{children}</View>; }
export function Row({ children }: PropsWithChildren) { return <View style={styles.row}>{children}</View>; }
const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  scroll: (top: number, bottom: number) => ({ flexGrow: 1, alignItems: 'center', paddingTop: Math.max(top, 24), paddingBottom: Math.max(bottom, 24), paddingHorizontal: 20 }),
  content: { width: '100%', maxWidth: 860, gap: 20 },
  panel: { backgroundColor: theme.colors.surface, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.colors.border, padding: 24, gap: 16 },
  stack: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
}));
