import { forwardRef } from 'react';
import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';

type Props = Omit<NativeTextProps, 'style' | 'onPress' | 'onLongPress'> & { variant?: 'heading' | 'section' | 'body' | 'caption'; muted?: boolean; tone?: 'content' | 'media' };
export const Text = forwardRef<NativeText, Props>(function Text({ variant = 'body', muted = false, tone = 'content', ...props }, ref) {
  return <NativeText {...props} ref={ref} style={styles.text(variant, muted, tone)} />;
});
const styles = StyleSheet.create((theme) => ({
  text: (variant: 'heading' | 'section' | 'body' | 'caption', muted: boolean, tone: 'content' | 'media') => ({
    color: tone === 'media' ? (muted ? theme.media.muted : theme.media.text) : (muted ? theme.colors.muted : theme.colors.text),
    fontFamily: theme.typography.family,
    fontSize: theme.typography[variant] * theme.textScale,
    lineHeight: (variant === 'heading' ? 36 : variant === 'section' ? 28 : variant === 'caption' ? 20 : 24) * theme.textScale,
    fontWeight: variant === 'heading' || variant === 'section' ? '600' : '400',
  }),
}));
