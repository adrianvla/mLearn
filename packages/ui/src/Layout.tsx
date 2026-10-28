import type { PropsWithChildren, ReactNode } from 'react';
import { Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Text } from './Text';
import { useWindowMaterial } from './Provider';

/** Bounded application frame with independently scrolling compact controls and content. */
export function AppShell({ header, navigation, contentInset = 'standard', children }: PropsWithChildren<{
  readonly header: ReactNode;
  readonly navigation?: ReactNode;
  readonly contentInset?: 'standard' | 'none';
}>) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const windowMaterial = useWindowMaterial();
  // Keep the scroll viewport itself below desktop overlay traffic lights;
  // padding inside scrolling navigation would disappear as the user scrolls.
  const top = Platform.OS === 'web' && compact ? Math.max(insets.top, 28) : insets.top;
  return <View testID="app-shell" style={styles.shell(top, insets.bottom, compact, windowMaterial)}>
    {Platform.OS === 'web' ? <View pointerEvents="none" style={styles.material(windowMaterial)} /> : null}
    {navigation ? <ScrollView style={styles.navigationViewport(compact)}
      contentContainerStyle={styles.navigation(compact)} keyboardShouldPersistTaps="handled">
      {navigation}
    </ScrollView> : null}
    <View style={styles.main(!!navigation, windowMaterial)}>
      <ScrollView testID="app-shell-header" scrollEnabled={compact}
        style={styles.headerViewport(compact)} contentContainerStyle={styles.shellHeader(!!navigation && !compact)}
        keyboardShouldPersistTaps="handled">{header}</ScrollView>
      <ScrollView testID="app-shell-content" style={styles.shellScroll} contentContainerStyle={styles.shellBody(!!navigation && !compact, contentInset)}
        keyboardShouldPersistTaps="handled">
        <View style={styles.shellContent(contentInset)}>{children}</View>
      </ScrollView>
    </View>
  </View>;
}
export function Panel({ children, inset = 'standard', material = 'glass' }: PropsWithChildren<{
  readonly inset?: 'standard' | 'compact' | 'spacious';
  readonly material?: 'glass' | 'solid' | 'card';
}>) {
  return <View style={styles.panel(inset, material)}>
    {material === 'card' ? <View pointerEvents="none" style={styles.cardTint} /> : null}
    {children}
  </View>;
}
export function Stack({ children }: PropsWithChildren) { return <View style={styles.stack}>{children}</View>; }
export function Section({ title, children }: PropsWithChildren<{ readonly title: string }>) {
  return <View style={styles.section}>
    <View style={styles.sectionHeading}><View style={styles.sectionMarker} /><Text variant="groupTitle" accessibilityRole="header">{title}</Text></View>
    <View>{children}</View>
  </View>;
}
export function Row({ children, wrap = true }: PropsWithChildren<{ readonly wrap?: boolean }>) {
  return <View style={styles.row(wrap)}>{children}</View>;
}
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
  shell: (top: number, bottom: number, compact: boolean, windowMaterial: boolean) => ({
    flex: 1, minHeight: 0, backgroundColor: windowMaterial && theme.shell.windowTint ? 'transparent' : theme.shell.navigation,
    paddingTop: top, paddingBottom: bottom, flexDirection: compact ? 'column' : 'row',
  }),
  material: (windowMaterial: boolean) => ({
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: windowMaterial && theme.shell.windowTint ? theme.shell.windowTint : 'transparent',
    _web: windowMaterial ? { backdropFilter: theme.shell.windowFilter, WebkitBackdropFilter: theme.shell.windowFilter } : {},
  }),
  navigation: (compact: boolean) => ({
    width: compact ? '100%' : 200, paddingHorizontal: theme.spacing.compact,
    paddingTop: compact ? theme.spacing.small : theme.spacing.section + theme.spacing.small,
    paddingBottom: theme.spacing.small, gap: theme.spacing.tiny,
    flexDirection: compact ? 'row' : 'column', flexWrap: 'wrap',
  }),
  main: (sidebar: boolean, windowMaterial: boolean) => ({
    flex: 1, minWidth: 0, minHeight: 0,
    backgroundColor: sidebar ? theme.shell.content : windowMaterial && theme.shell.windowTint ? 'transparent' : theme.colors.background,
    _web: sidebar ? {} : { backgroundImage: `linear-gradient(180deg, transparent 0%, transparent 30%, ${theme.shell.canvas} 130%)` },
  }),
  shellHeader: (sidebar: boolean) => ({
    flexShrink: 0, gap: sidebar ? theme.spacing.tiny : theme.spacing.small, paddingHorizontal: sidebar ? theme.spacing.section + theme.spacing.small : theme.spacing.large,
    paddingTop: sidebar ? theme.spacing.large : theme.spacing.section + theme.spacing.small,
    paddingBottom: sidebar ? theme.spacing.large : theme.spacing.medium,
  }),
  headerViewport: (compact: boolean) => ({
    flexGrow: 0, flexShrink: compact ? 1 : 0, maxHeight: compact ? '35%' : undefined,
  }),
  shellScroll: { flex: 1, minHeight: 0 },
  shellBody: (sidebar: boolean, inset: 'standard' | 'none') => ({ flexGrow: 1,
    paddingLeft: inset === 'none' ? 0 : sidebar ? theme.spacing.section + theme.spacing.small : theme.spacing.large,
    paddingRight: inset === 'none' ? 0 : sidebar ? theme.spacing.section : theme.spacing.large,
    paddingTop: inset === 'none' ? 0 : theme.spacing.medium,
    paddingBottom: theme.spacing.large, alignItems: 'center' }),
  shellContent: (inset: 'standard' | 'none') => ({ width: '100%', maxWidth: inset === 'none' ? undefined : 1184, gap: theme.spacing.comfortable }),
  panel: (inset: 'standard' | 'compact' | 'spacious', material: 'glass' | 'solid' | 'card') => ({
    backgroundColor: material === 'solid' || material === 'card' ? theme.colors.surface : theme.surfaces.glass,
    borderRadius: theme.radius + 4, borderWidth: 1, borderColor: theme.colors.border,
    padding: inset === 'compact' ? material === 'card' ? theme.spacing.compact : theme.spacing.small + theme.spacing.tiny / 2
      : inset === 'spacious' ? theme.spacing.large : theme.spacing.medium, gap: theme.spacing.compact }),
  cardTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: theme.radius + 4, backgroundColor: theme.surfaces.card },
  stack: { gap: theme.spacing.compact },
  section: { gap: theme.spacing.small },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small },
  sectionMarker: { width: 2, height: theme.typography.groupTitle.fontSize, borderRadius: 1, backgroundColor: theme.colors.muted },
  row: (wrap: boolean) => ({ flexDirection: 'row', flexWrap: wrap ? 'wrap' : 'nowrap', alignItems: 'center', gap: theme.spacing.compact }),
  setting: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.medium, paddingVertical: theme.spacing.compact, borderBottomWidth: 1, borderColor: theme.colors.border },
  settingLabel: { flex: 1, minWidth: 0, flexBasis: 180, gap: theme.spacing.tiny / 2 },
}));
