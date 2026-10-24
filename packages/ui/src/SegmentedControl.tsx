import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from './Button';

export function SegmentedControl({ value, options, onValueChange }: {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onValueChange: (value: string) => void;
}) {
  return <View style={styles.group}>{options.map(option => <View key={option.value} style={styles.segment}>
    <Button label={option.label} variant="segment" size="compact"
      accessibilityState={{ selected: value === option.value }}
      onPress={() => onValueChange(option.value)} />
  </View>)}</View>;
}

const styles = StyleSheet.create(theme => ({
  group: { flexDirection: 'row', padding: theme.spacing.tiny, gap: theme.spacing.tiny,
    backgroundColor: theme.surfaces.secondary, borderRadius: theme.radius },
  segment: { flex: 1, minWidth: 0 },
}));
