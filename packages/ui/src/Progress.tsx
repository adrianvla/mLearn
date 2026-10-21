import { View, type StyleProp, type ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** Read-only native progress; an unknown total leaves the current value absent. */
export function Progress({ label, value, style }: {
  readonly label: string;
  readonly value: number | undefined;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const percent = value === undefined ? undefined : Math.max(0, Math.min(100, value));
  return <View accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 0, max: 100, now: percent }} style={[styles.track, style]}>
    {percent === undefined ? null : <View style={[styles.fill, { width: `${percent}%` }]} />}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  track: {
    height: 6, borderWidth: 1, borderRadius: 3, overflow: 'hidden',
    borderColor: theme.controls.outline, backgroundColor: theme.controls.field,
  },
  fill: { height: '100%', backgroundColor: theme.colors.accent },
}));
