import { useRef } from 'react';
import { Pressable, Text as NativeText, View, AccessibilityInfo, findNodeHandle } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { InlineWordProps, TextBounds } from './InlineWord.types';
/** A real inline view keeps each word independently reachable by TalkBack/VoiceOver.
 * Nested NativeText onPress works by touch but collapses into its parent's AX node.
 */
export function InlineWordControl({ text, status, onActivate, variant = 'subtitle' }: InlineWordProps) {
    const ref = useRef<View>(null);
    const restoreFocus = () => {
        const tag = findNodeHandle(ref.current);
        if (tag)
            AccessibilityInfo.setAccessibilityFocus(tag);
    };
    const measure = (publish: (bounds: TextBounds) => void) =>
        ref.current?.measureInWindow((x, y, width, height) => publish({ x, y, width, height }));
    const activate = () => measure(bounds => onActivate({ ...bounds, measure, restoreFocus }));
    return <Pressable
      ref={ref}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${text}: ${status.replaceAll('_', ' ')}`}
      onPress={activate}
      style={styles.target}>
    <NativeText style={styles.word(status, variant)}>{text}</NativeText></Pressable>;
}
const styles = StyleSheet.create(theme => ({
    target: {
        minHeight: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center'
    }, word: (status: string, variant: 'subtitle' | 'body') => ({
        flexShrink: 1, fontSize: (variant === 'body' ? theme.typography.body : 26) * theme.textScale,
        lineHeight: (variant === 'body' ? 24 : 44) * theme.textScale,
        ...(variant === 'subtitle' ? { textShadowColor: theme.media.background, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } } : {}),
        color: status === 'claimed_known' ? theme.colors.accent : variant === 'body' ? theme.colors.text : theme.media.text, textDecorationLine: status === 'claimed_unknown' || status === 'mixed' ? 'underline' : 'none', textDecorationStyle: status === 'mixed' ? 'dotted' : 'solid'
    })
}));
