import type { PropsWithChildren, ReactNode } from 'react';
import { Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Text } from './Text';

/** Bounded application frame: navigation stays put; only content scrolls. */
export function AppShell({ header, navigation, children }: PropsWithChildren<{
  readonly header: ReactNode;
  readonly navigation?: ReactNode;
}>) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  // Keep the scroll viewport itself below desktop overlay traffic lights;
  // padding inside scrolling navigation would disappear as the user scrolls.
  const top = Platform.OS === 'web' && compact && navigation ? Math.max(insets.top, 28) : insets.top;
  return <View style={styles.shell(top, insets.bottom, compact)}>
    {navigation ? <ScrollView style={styles.navigationViewport(compact)}
      contentContainerStyle={styles.navigation(compact)} keyboardShouldPersistTaps="handled">
      {navigation}
    </ScrollView> : null}
    <View style={styles.main(!!navigation)}>
      <View style={styles.shellHeader(!!navigation && !compact)}>{header}</View>
      <ScrollView style={styles.shellScroll} contentContainerStyle={styles.shellBody(!!navigation && !compact)}
        keyboardShouldPersistTaps="handled">
        <View style={styles.shellContent}>{children}</View>
      </ScrollView>
    </View>
  </View>;
}
export function Panel({ children, inset = 'standard' }: PropsWithChildren<{ inset?: 'standard' | 'compact' }>) {
  return <View style={styles.panel(inset === 'compact')}>{children}</View>;
}
export function Stack({ children }: PropsWithChildren) { return <View style={styles.stack}>{children}</View>; }
export function Section({ title, children }: PropsWithChildren<{ readonly title: string }>) {
  return <View style={styles.section}>
    <View style={styles.sectionHeading}><View style={styles.sectionMarker} /><Text variant="groupTitle" accessibilityRole="header">{title}</Text></View>
    <View>{children}</View>
  </View>;
}
export function Row({ children }: PropsWithChildren) { return <View style={styles.row}>{children}</View>; }
/** Keep related setting information and actions together as the row wraps. */
export function SettingRow({ label, description, children }: PropsWithChildren<{
  readonly label: string;
  readonly description?: ReactNode;
}>) {
  return <View style={styles.setting}>
    <View style={styles.settingLabel}><Text variant="caption">{label}</Text>{description}</View>
    {children}
  </View>;
}
const styles = StyleSheet.create((theme) => ({
  navigationViewport: (compact: boolean) => ({
    width: compact ? '100%' : 200, maxHeight: compact ? '35%' : undefined,
    flexGrow: 0, flexShrink: compact ? 1 : 0,
    borderRightWidth: compact ? 0 : 1, borderBottomWidth: compact ? 1 : 0,
    borderColor: theme.colors.border,
  }),
  shell: (top: number, bottom: number, compact: boolean) => ({
    flex: 1, minHeight: 0, backgroundColor: theme.shell.navigation,
    paddingTop: top, paddingBottom: bottom, flexDirection: compact ? 'column' : 'row',
  }),
  navigation: (compact: boolean) => ({
    width: compact ? '100%' : 200, paddingHorizontal: theme.spacing.compact,
    paddingTop: compact ? theme.spacing.small : theme.spacing.section + theme.spacing.small,
    paddingBottom: theme.spacing.small, gap: theme.spacing.tiny,
    flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap',
  }),
  main: (sidebar: boolean) => ({
    flex: 1, minWidth: 0, minHeight: 0,
    backgroundColor: sidebar ? theme.shell.content : theme.colors.background,
    _web: sidebar ? {} : { backgroundImage: `linear-gradient(180deg, transparent 0%, transparent 30%, ${theme.shell.canvas} 130%)` },
  }),
  shellHeader: (sidebar: boolean) => ({
    flexShrink: 0, gap: sidebar ? theme.spacing.tiny : theme.spacing.small, paddingHorizontal: sidebar ? theme.spacing.section + theme.spacing.small : theme.spacing.large,
    paddingTop: sidebar ? theme.spacing.large : theme.spacing.section + theme.spacing.small,
    paddingBottom: sidebar ? theme.spacing.large : theme.spacing.medium,
  }),
  shellScroll: { flex: 1, minHeight: 0 },
  shellBody: (sidebar: boolean) => ({ flexGrow: 1, paddingLeft: sidebar ? theme.spacing.section + theme.spacing.small : theme.spacing.large,
    paddingRight: sidebar ? theme.spacing.section : theme.spacing.large, paddingTop: theme.spacing.medium, paddingBottom: theme.spacing.large, alignItems: 'center' }),
  shellContent: { width: '100%', maxWidth: 1184, gap: theme.spacing.comfortable },
  panel: (compact: boolean) => ({ backgroundColor: theme.surfaces.glass, borderRadius: theme.radius + 4, borderWidth: 1, borderColor: theme.colors.border,
    padding: compact ? theme.spacing.small + theme.spacing.tiny / 2 : theme.spacing.medium, gap: theme.spacing.compact }),
  stack: { gap: theme.spacing.compact },
  section: { gap: theme.spacing.small },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small },
  sectionMarker: { width: 2, height: theme.typography.groupTitle.fontSize, borderRadius: 1, backgroundColor: theme.colors.muted },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing.compact },
  setting: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium, paddingVertical: theme.spacing.compact, borderBottomWidth: 1, borderColor: theme.colors.border },
  settingLabel: { flex: 1, minWidth: 0, flexBasis: 180, gap: theme.spacing.tiny / 2 },
}));
