import { useState, type PropsWithChildren } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export function ActivityCard({ title, description, icon, onPress, accessibilityLabel = title, testID, disabled = false, children }: PropsWithChildren<{
  readonly title: string;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
  readonly description?: string;
  readonly icon: IconName;
  readonly onPress: () => void;
  readonly disabled?: boolean;
}>) {
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const header = <View pointerEvents="none" style={[styles.header, disabled && styles.disabledHeader]}>
    <View style={styles.icon}><Icon name={icon} size={22} color={theme.colors.text} /></View>
    <View style={styles.copy}>
      <Text variant="section" accessibilityRole="header">{title}</Text>
      {description ? <Text variant="caption" muted>{description}</Text> : null}
    </View>
  </View>;
  const action = <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={Platform.OS === 'web' ? styles.stretchedAction : styles.nativeAction}>
    {Platform.OS === 'web' ? null : header}
  </Pressable>;
  return <View style={[styles.card, !disabled && (hovered || pressed) && styles.hover,
    !disabled && focused && styles.focus]}>
    {action}
    {Platform.OS === 'web' ? header : null}
    <View style={styles.content}>{children}</View>
  </View>;
}

const styles = StyleSheet.create(theme => ({
  card: { flexGrow: 1, minWidth: 0, position: 'relative', padding: theme.spacing.medium,
    gap: theme.spacing.compact, borderRadius: theme.radius + 4,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.surfaces.glass },
  stretchedAction: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1, borderRadius: theme.radius + 4 },
  // Native sibling stacking does not lift descendant controls above an overlay.
  // Keep the header action separate so every preview/import retains its target.
  nativeAction: { minHeight: 44, justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.compact },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.controls.outline, borderRadius: theme.radius,
    backgroundColor: theme.surfaces.glass },
  copy: { flex: 1, minWidth: 0 },
  // RN Web Views create stacking contexts. Lift the whole independent preview
  // region, not a descendant button that cannot escape its ancestors.
  content: { gap: theme.spacing.compact, _web: { zIndex: 2 } },
  disabledHeader: { opacity: 0.5 },
  hover: { borderColor: theme.controls.outline, backgroundColor: theme.surfaces.secondary,
    _web: { boxShadow: '0px 18px 50px -10px rgba(0, 0, 0, 0.2)' } },
  focus: { _web: { outlineWidth: 2, outlineStyle: 'solid',
    outlineColor: theme.colors.accent, outlineOffset: 2 } },
}));
