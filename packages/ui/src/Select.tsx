import { Platform, ScrollView, View, useWindowDimensions } from 'react-native';
import * as Primitive from '@rn-primitives/select';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Icon } from './Icon';
import { Button } from './Button';
import { Text } from './Text';

type Option = { readonly value: string; readonly label: string; readonly testID?: string };

/** A labelled, keyboard/touch accessible selection with one portable owner. */
export function Select({ label, value, options, onValueChange, disabled = false, placeholder = 'Select' }: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly Option[];
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
}) {
  const { theme } = useUnistyles();
  const { height, width } = useWindowDimensions();
  const selected = options.find(option => option.value === value);
  const items = options.map(option => <Primitive.Item key={option.value} value={option.value}
    label={option.label} aria-label={option.label}>
    <View testID={option.testID} style={[styles.item, option.value === value && styles.selected]}>
      <Text>{option.label}</Text>
      <Primitive.ItemIndicator><View style={styles.indicator}>
        <Icon name="check" size={16} color={theme.colors.text} />
      </View></Primitive.ItemIndicator>
    </View>
  </Primitive.Item>);
  return <Primitive.Root value={selected} onValueChange={option => {
    if (option) onValueChange(option.value);
  }}>
    <Primitive.Trigger asChild disabled={disabled || !options.length}>
      <Button label={selected?.label ?? placeholder} accessibilityLabel={label}
        role="combobox" accessibilityRole="combobox"
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        variant="select" icon="chevronDown" iconPosition="trailing"
        disabled={disabled || !options.length} />
    </Primitive.Trigger>
    <Primitive.Portal>
      <Primitive.Overlay style={styles.overlay}>
        <Primitive.Content sideOffset={4} asChild>
          <View style={[styles.content, {
          backgroundColor: theme.colors.surface, borderColor: theme.colors.border,
          maxHeight: Math.min(320, height - 40), maxWidth: width - 24,
        }]}>
          {Platform.OS === 'web' ? <Primitive.Viewport>{items}</Primitive.Viewport>
            : <ScrollView style={{ maxHeight: Math.min(310, height - 50) }}
                keyboardShouldPersistTaps="handled">{items}</ScrollView>}
          </View>
        </Primitive.Content>
      </Primitive.Overlay>
    </Primitive.Portal>
  </Primitive.Root>;
}

const styles = StyleSheet.create(theme => ({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web' ? { _web: { position: 'fixed', zIndex: 1100 } } : {}) },
  content: { borderWidth: 1, borderRadius: theme.radius, padding: theme.spacing.tiny,
    minWidth: 180, _web: { boxShadow: '0 8px 24px #00000040' } },
  item: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.medium,
    justifyContent: 'space-between', paddingHorizontal: theme.spacing.compact,
    paddingVertical: theme.spacing.small, borderRadius: theme.radius / 2,
    _web: { minHeight: 32, cursor: 'pointer' } },
  selected: { backgroundColor: theme.controls.selected },
  indicator: { width: 16, height: 16 },
}));
