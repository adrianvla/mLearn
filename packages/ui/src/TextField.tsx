import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, TextInput, View, useWindowDimensions, type TextInputProps } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Text } from './Text';
import { TextFieldAccessory } from './TextFieldAccessory';
import { Icon } from './Icon';

type Props = Omit<TextInputProps, 'style' | 'accessibilityLabel'> & {
  label: string; variant?: 'default' | 'search' | 'composer'; trailing?: ReactNode;
  multilineSize?: 'default' | 'compact';
};
export function TextField({ label, multiline = false, variant = 'default', multilineSize = 'default', trailing, ...props }: Props) {
  const { theme } = useUnistyles();
  const { width } = useWindowDimensions();
  const id = useId();
  const inputRef = useRef<TextInput>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const compact = multiline && variant === 'default' && multilineSize === 'compact';
  const growing = variant === 'composer' || compact;
  const minimumHeight = compact ? 60 : 44;
  const maximumHeight = compact ? 200 : 120;
  useLayoutEffect(() => {
    const node = inputRef.current;
    if (!growing || Platform.OS !== 'web'
      || typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return;
    // Measure natural content, not the previously applied height. Otherwise a
    // cleared long value retains the old textarea height indefinitely.
    // Compact inputs own a 1 px border; the composer border is on its wrapper.
    const previous = node.style.height;
    node.style.height = compact ? '0px' : 'auto';
    const height = Math.min(maximumHeight, Math.max(minimumHeight, node.scrollHeight + (compact ? 2 : 0)));
    node.style.height = previous;
    setContentHeight(height);
  }, [growing, compact, minimumHeight, maximumHeight, props.value, width, theme.typography.body.fontSize, theme.typography.body.lineHeight, theme.spacing.compact]);
  const accessory = `${id}-keyboard`;
  const input = <TextInput {...props} ref={inputRef} multiline={multiline}
    numberOfLines={props.numberOfLines ?? (variant === 'composer' ? 1 : undefined)}
    onContentSizeChange={growing && Platform.OS !== 'web' ? event => {
      setContentHeight(Math.min(maximumHeight, event.nativeEvent.contentSize.height + (compact ? 2 : 0)));
      props.onContentSizeChange?.(event);
    } : props.onContentSizeChange}
    inputAccessoryViewID={Platform.OS === 'ios' ? accessory : undefined}
    accessibilityLabel={label} accessibilityLabelledBy={variant === 'default' ? id : undefined}
    placeholderTextColor={theme.colors.muted}
    style={styles.input(multiline, variant === 'search', variant === 'composer', compact, contentHeight)} />;
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
  input: (multiline: boolean, search: boolean, composer: boolean, compact: boolean, height: number | null) => ({ ...theme.typography[search ? 'caption' : 'body'], minWidth: 0, flex: search || composer ? 1 : undefined,
    minHeight: multiline && !composer ? compact ? 60 : 180 : 44,
    maxHeight: composer ? 120 : compact ? 200 : undefined, height: (composer || compact) && height !== null ? Math.min(compact ? 200 : 120, height) : undefined,
    borderWidth: search || composer ? 0 : 1, borderColor: theme.colors.border,
    borderRadius: theme.radius, color: theme.colors.text,
    backgroundColor: search || composer ? 'transparent' : theme.controls.surface,
    paddingVertical: search ? theme.spacing.small : theme.spacing.compact,
    paddingHorizontal: search ? 0 : theme.spacing.compact,
    textAlignVertical: multiline ? 'top' : 'center',
    _web: { ...theme.typography[search ? 'caption' : 'body']._web,
      ...(search ? { minHeight: 32, paddingVertical: theme.spacing.tiny } : {}) } }),
}));
