import { useState } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from './Text';
import type { SourceThumbnail } from './InlineWordDocument';
export type { SourceThumbnail } from './InlineWordDocument';

/** A source preview is itself the navigation target, not a second action card. */
export function SourcePreview({ text, thumbnail, page, selected, disabled, onPress }: {
  readonly text: string;
  readonly thumbnail?: SourceThumbnail;
  readonly page: number | null;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const label = page === null ? `Read ${Array.from(text.slice(0, 160)).slice(0, 80).join('')}` : `Page ${page + 1}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    {...(Platform.OS === 'web' ? { 'aria-pressed': selected } : {})}
    accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.preview, selected && styles.selected,
      !disabled && (hovered || pressed) && styles.hover, focused && styles.focus,
      disabled && styles.disabled]}>
    {thumbnail ? <Image source={{ uri: thumbnail.uri }} resizeMode="contain"
      style={styles.image(thumbnail.width / thumbnail.height)} accessibilityLabel={text} accessibilityIgnoresInvertColors />
      : <View style={styles.copy(page !== null)}><Text variant="detail" numberOfLines={9}>{text}</Text></View>}
    {page !== null ? <View style={styles.page}><Text variant="detail">{page + 1}</Text></View> : null}
  </Pressable>;
}

const styles = StyleSheet.create(theme => ({
  preview: { minHeight: 44, minWidth: 44, overflow: 'hidden', position: 'relative',
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius,
    backgroundColor: theme.surfaces.glass },
  image: (aspect: number) => ({ width: '100%', aspectRatio: aspect }),
  copy: (hasPage: boolean) => ({ padding: theme.spacing.small,
    paddingBottom: hasPage ? theme.spacing.large : theme.spacing.small }),
  page: { position: 'absolute', right: theme.spacing.tiny, bottom: theme.spacing.tiny,
    paddingHorizontal: theme.spacing.tiny, borderRadius: theme.radius / 2,
    backgroundColor: theme.controls.selected },
  selected: { borderColor: theme.colors.accent },
  hover: { backgroundColor: theme.surfaces.secondary },
  focus: { _web: { outlineWidth: 2, outlineStyle: 'solid',
    outlineColor: theme.colors.accent, outlineOffset: -2 } },
  disabled: { opacity: 0.5 },
}));
