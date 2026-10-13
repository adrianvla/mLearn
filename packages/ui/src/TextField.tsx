import { useId } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Text } from './Text';

type Props = Omit<TextInputProps, 'style' | 'accessibilityLabel'> & { label: string };
export function TextField({ label, multiline = false, ...props }: Props) {
  const id = useId();
  return <View style={styles.field}><Text nativeID={id} variant="caption">{label}</Text><TextInput {...props} multiline={multiline} accessibilityLabel={label} accessibilityLabelledBy={id} style={styles.input(multiline)} /></View>;
}
const styles = StyleSheet.create((theme) => ({
  field: { gap: 6, minWidth: 0 },
  input: (multiline: boolean) => ({ minHeight: multiline ? 180 : 44, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius, color: theme.colors.text, backgroundColor: theme.colors.background, padding: 12, fontSize: 16 * theme.textScale, textAlignVertical: 'top' }),
}));
