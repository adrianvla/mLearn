import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Text } from './Text';

export function Screen({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  return <ScrollView style={styles.screen} contentContainerStyle={styles.scroll(insets.top, insets.bottom)} keyboardShouldPersistTaps="handled"><View style={styles.content}>{children}</View></ScrollView>;
}
export function Panel({ children }: PropsWithChildren) { return <View style={styles.panel}>{children}</View>; }
export function Stack({ children }: PropsWithChildren) { return <View style={styles.stack}>{children}</View>; }
export function Row({ children }: PropsWithChildren) { return <View style={styles.row}>{children}</View>; }
/** Keep related setting information and actions together as the row wraps. */
export function SettingRow({ label, description, children }: PropsWithChildren<{
  readonly label: string;
  readonly description?: ReactNode;
}>) {
  return <View style={styles.setting}>
    <View style={styles.settingLabel}><Text>{label}</Text>{description}</View>
    {children}
  </View>;
}
const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  scroll: (top: number, bottom: number) => ({ flexGrow: 1, alignItems: 'center', paddingTop: Math.max(top, theme.spacing.large), paddingBottom: Math.max(bottom, theme.spacing.large), paddingHorizontal: theme.spacing.comfortable }),
  content: { width: '100%', maxWidth: 1040, gap: theme.spacing.comfortable },
  panel: { backgroundColor: theme.colors.surface, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.colors.border, padding: theme.spacing.large, gap: theme.spacing.medium },
  stack: { gap: theme.spacing.compact },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.compact },
  setting: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium, paddingVertical: theme.spacing.large, borderBottomWidth: 1, borderColor: theme.colors.border },
  settingLabel: { flex: 1, minWidth: 0, flexBasis: 180, gap: theme.spacing.small },
}));
