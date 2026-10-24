import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Icon, type IconName } from './Icon';
import { Progress } from './Progress';
import { Text } from './Text';

/** One source continuation target; unavailable progress stays explicitly unknown. */
export function SourceRow({ title, detail, icon, progress, disabled = false, onPress }: {
  readonly title: string;
  readonly detail: string;
  readonly icon: IconName;
  readonly progress?: number;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={`Resume ${title}`}
    disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.row, !disabled && (hovered || pressed) && styles.hover,
      focused && styles.focus, disabled && styles.disabled]}>
    <View style={styles.media(width <= 650, width <= 600)}>
      <Icon name={icon} size={20} color={theme.colors.muted} />
    </View>
    <View style={styles.info}>
      <Text variant="sourceTitle" numberOfLines={1}>{title}</Text>
      <Text variant="detail" muted numberOfLines={2}>{detail}</Text>
      <Progress label={`${title} progress`} value={progress} />
    </View>
    {width > 600 ? <Text variant="caption">{progress === undefined ? '—' : `${Math.round(progress)}%`}</Text> : null}
  </Pressable>;
}

const styles = StyleSheet.create(theme => ({
  row: { minHeight: 72, minWidth: 0, flexDirection: 'row', alignItems: 'center',
    gap: theme.spacing.compact, padding: theme.spacing.small + theme.spacing.tiny / 2,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius + 4,
    backgroundColor: theme.surfaces.glass },
  media: (narrow: boolean, short: boolean) => ({ width: narrow ? 72 : 140,
    height: short ? 56 : 72, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: 4,
    backgroundColor: theme.surfaces.glass }),
  info: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
  hover: { backgroundColor: theme.surfaces.secondary, borderColor: theme.controls.outline },
  focus: { _web: { outlineWidth: 2, outlineStyle: 'solid',
    outlineColor: theme.colors.accent, outlineOffset: 2 } },
  disabled: { opacity: 0.5 },
}));
