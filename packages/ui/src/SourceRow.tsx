import { useState } from 'react';
import { Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Icon, type IconName } from './Icon';
import { Progress } from './Progress';
import { Text } from './Text';

/** One source continuation target; unavailable progress stays explicitly unknown. */
export function SourceRow({ title, detail, meta, icon, progress, disabled = false, onPress }: {
  readonly title: string;
  readonly detail: string;
  readonly meta?: string;
  readonly icon: IconName;
  readonly progress?: number;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // UIKit groups these descendants; its value keeps detail separate from the
  // action label. Android would append that value to the label instead.
  return <Pressable accessibilityRole="button" accessibilityLabel={`Continue ${title}`}
    accessibilityValue={Platform.OS === 'ios' ? { text: meta ? `${detail}, ${meta}` : detail } : undefined}
    disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.row, !disabled && (hovered || pressed) && styles.hover,
      focused && styles.focus, disabled && styles.disabled]}>
    <Icon name={icon} size={24} color={theme.colors.muted} />
    <View style={styles.info}>
      <Text variant="sourceTitle" numberOfLines={1}>{title}</Text>
      <View style={styles.metadata}>
        <Text variant="detail" muted numberOfLines={2}>{detail}</Text>
        {meta ? <Text variant="detail" muted>{meta}</Text> : null}
      </View>
      {progress !== undefined ? <Progress label={`${title} progress`} value={progress} /> : null}
    </View>
    {width > 600 && progress !== undefined ? <Text variant="caption">{Math.round(progress)}%</Text> : null}
  </Pressable>;
}

const styles = StyleSheet.create(theme => ({
  row: { minHeight: 72, minWidth: 0, flexDirection: 'row', alignItems: 'center',
    gap: theme.spacing.compact, padding: theme.spacing.small + theme.spacing.tiny / 2,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius + 4,
    backgroundColor: theme.surfaces.glass },
  info: { flex: 1, minWidth: 0, gap: theme.spacing.tiny },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.small },
  hover: { backgroundColor: theme.surfaces.secondary, borderColor: theme.controls.outline },
  focus: { _web: { outlineWidth: 2, outlineStyle: 'solid',
    outlineColor: theme.colors.accent, outlineOffset: 2 } },
  disabled: { opacity: 0.5 },
}));
