import { forwardRef } from 'react';
import { Platform, Text as NativeText, type TextProps as NativeTextProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import type { ResolvedTheme } from '@mlearn/theme';

type TextRole = keyof ResolvedTheme['typography'];
type Props = Omit<NativeTextProps, 'style' | 'onPress' | 'onLongPress'> & { variant?: TextRole; muted?: boolean; tone?: 'content' | 'media' | 'success'; align?: 'left' | 'center' | 'right'; tabIndex?: -1 | 0 };
export const Text = forwardRef<NativeText, Props>(function Text({ variant = 'body', muted = false, tone = 'content', align = 'left', tabIndex, ...props }, ref) {
  return <NativeText {...props} {...(Platform.OS === 'web' && tabIndex !== undefined ? { tabIndex } : {})} ref={ref} style={styles.text(variant, muted, tone, align)} />;
});
const styles = StyleSheet.create((theme) => ({
  text: (variant: TextRole, muted: boolean, tone: 'content' | 'media' | 'success', align: 'left' | 'center' | 'right') => ({
    ...theme.typography[variant],
    color: tone === 'success' ? theme.feedback.success : tone === 'media' ? (muted ? theme.media.muted : theme.media.text) : (muted ? theme.colors.muted : theme.colors.text),
    textAlign: align,
    ...(variant === 'subtitle' ? { textShadowColor: theme.media.background, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } } : {}),
  }),
}));
