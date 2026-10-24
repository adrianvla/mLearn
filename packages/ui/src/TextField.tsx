import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, TextInput, View, useWindowDimensions, type TextInputProps } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Text } from './Text';
import { TextFieldAccessory } from './TextFieldAccessory';
import { Icon } from './Icon';

type Props = Omit<TextInputProps, 'style' | 'accessibilityLabel'> & {
  label: string; variant?: 'default' | 'search' | 'composer'; trailing?: ReactNode;
};
export function TextField({ label, multiline = false, variant = 'default', trailing, ...props }: Props) {
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const id = useId();
  const inputRef = useRef<TextInput>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (variant !== 'composer' || Platform.OS !== 'web'
      || typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return;
    // Measure natural content, not the previously applied height. Otherwise a
    // cleared long message retains the old textarea height indefinitely.
    const previous = node.style.height;
    node.style.height = 'auto';
    const height = Math.min(120, Math.max(44, node.scrollHeight));
    node.style.height = previous;
    setContentHeight(height);
  }, [variant, props.value, width, theme.typography.body.fontSize, theme.typography.body.lineHeight]);
  const accessory = `${id}-keyboard`;
  const input = <TextInput {...props} ref={inputRef} multiline={multiline}
    numberOfLines={props.numberOfLines ?? (variant === 'composer' ? 1 : undefined)}
    onContentSizeChange={variant === 'composer' && Platform.OS !== 'web' ? event => {
      setContentHeight(Math.min(120, event.nativeEvent.contentSize.height));
      props.onContentSizeChange?.(event);
    } : props.onContentSizeChange}
    inputAccessoryViewID={Platform.OS === 'ios' ? accessory : undefined}
    accessibilityLabel={label} accessibilityLabelledBy={variant === 'default' ? id : undefined}
    placeholderTextColor={theme.colors.muted}
    style={styles.input(multiline, variant === 'search', variant === 'composer', contentHeight)} />;
  return <View style={styles.field}>
    {variant === 'search' ? <View style={styles.search}><Icon name="search" size={18} color={theme.colors.muted} />{input}</View>
      : variant === 'composer' ? <View style={styles.composer}>{input}
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}</View>
      : <>{variant === 'default' ? <Text nativeID={id} variant="caption">{label}</Text> : null}{input}</>}
    <TextFieldAccessory nativeID={accessory} />
  </View>;
}
const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.spacing.small, minWidth: 0 },
  search: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small, paddingHorizontal: theme.spacing.compact,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius, backgroundColor: theme.controls.field },
  composer: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius, backgroundColor: theme.surfaces.glass },
  trailing: { padding: theme.spacing.tiny },
  input: (multiline: boolean, search: boolean, composer: boolean, height: number | null) => ({ ...theme.typography[search ? 'caption' : 'body'], minWidth: 0, flex: search || composer ? 1 : undefined,
    minHeight: multiline && !composer ? 180 : 44,
    maxHeight: composer ? 120 : undefined, height: composer && height !== null ? Math.min(120, height) : undefined,
    borderWidth: search || composer ? 0 : 1, borderColor: theme.colors.border,
    borderRadius: theme.radius, color: theme.colors.text,
    backgroundColor: search || composer ? 'transparent' : theme.controls.surface,
    paddingVertical: search ? theme.spacing.small : theme.spacing.compact,
    paddingHorizontal: search ? 0 : theme.spacing.compact,
    textAlignVertical: multiline ? 'top' : 'center',
    _web: { ...theme.typography[search ? 'caption' : 'body']._web,
      ...(search ? { minHeight: 32, paddingVertical: theme.spacing.tiny } : {}) } }),
}));
