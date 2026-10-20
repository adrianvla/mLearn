import { useId } from 'react';
import { Platform, TextInput, View, type TextInputProps } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Text } from './Text';
import { TextFieldAccessory } from './TextFieldAccessory';
import { Icon } from './Icon';

type Props = Omit<TextInputProps, 'style' | 'accessibilityLabel'> & { label: string; variant?: 'default' | 'search' };
export function TextField({ label, multiline = false, variant = 'default', ...props }: Props) {
  const { theme } = useUnistyles();
  const id = useId();
  const accessory = `${id}-keyboard`;
  const input = <TextInput {...props} multiline={multiline}
    inputAccessoryViewID={Platform.OS === 'ios' ? accessory : undefined}
    accessibilityLabel={label} accessibilityLabelledBy={variant === 'search' ? undefined : id}
    placeholderTextColor={theme.colors.muted} style={styles.input(multiline, variant === 'search')} />;
  return <View style={styles.field}>
    {variant === 'search' ? <View style={styles.search}><Icon name="search" size={18} color={theme.colors.muted} />{input}</View>
      : <><Text nativeID={id} variant="caption">{label}</Text>{input}</>}
    <TextFieldAccessory nativeID={accessory} />
  </View>;
}
const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing.small, minWidth: 0 },
  search: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small, paddingHorizontal: theme.spacing.compact,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius, backgroundColor: theme.controls.field },
  input: (multiline: boolean, search: boolean) => ({ ...theme.typography[search ? 'caption' : 'body'], minWidth: 0, flex: search ? 1 : undefined,
    minHeight: multiline ? 180 : 44, borderWidth: search ? 0 : 1, borderColor: theme.colors.border,
    borderRadius: theme.radius, color: theme.colors.text, backgroundColor: search ? 'transparent' : theme.controls.surface,
    paddingVertical: search ? theme.spacing.small : theme.spacing.compact,
    paddingHorizontal: search ? 0 : theme.spacing.compact, textAlignVertical: multiline ? 'top' : 'center' }),
}));
