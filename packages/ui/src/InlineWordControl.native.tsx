import { useRef } from 'react';
import { Pressable, Text as NativeText, View, AccessibilityInfo, findNodeHandle } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { InlineWordContentProps, InlineWordProps, TextBounds } from './InlineWord.types';
import { PronunciationReading } from './PronunciationReading';

/** Native has no ruby primitive; each reading/source pair is one flow item. */
export function InlineWordContent({ segments, variant = 'body', status }: InlineWordContentProps) {
    const { theme } = useUnistyles();
    return <View style={contentStyles.flow}>
        {segments.map((segment, index) => segment.reading ?
            <View key={index} accessible accessibilityLabel={`${segment.text}, ${segment.reading.text}. ${segment.reading.attribution}`} style={contentStyles.ruby}>
                {segment.contour ? <PronunciationReading contour={segment.contour}
                    variant={variant === 'subtitle' ? 'subtitleRuby' : variant === 'inspectionTitle' ? 'inspectionRuby' : 'bodyRuby'} /> :
                    <NativeText style={contentStyles.reading(variant, status)}>{segment.reading.text}</NativeText>}
                <NativeText style={contentStyles.source(variant, status)}>{segment.reading.base ?? segment.text}</NativeText>
            </View> :
            segment.contour ? <PronunciationReading key={index} contour={segment.contour}
                color={status === 'claimed_known' ? theme.feedback.success : undefined}
                variant={variant === 'inspectionTitle' ? 'inspectionReading' : variant} /> :
                <NativeText key={index} style={contentStyles.source(variant, status)}>{segment.text}</NativeText>
        )}
    </View>;
}

const contentStyles = StyleSheet.create(theme => ({
    flow: { maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', flexShrink: 1 },
    ruby: { maxWidth: '100%', alignItems: 'center', flexShrink: 1 },
    source: (variant: NonNullable<InlineWordContentProps['variant']>, status?: string) => ({
        ...theme.typography[variant],
        flexShrink: 1,
        color: status === 'claimed_known' ? theme.feedback.success : variant === 'body' ? theme.colors.text : theme.media.text,
        ...(variant === 'subtitle' ? { textShadowColor: theme.media.background, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } } : {}),
        textDecorationLine: status === 'claimed_unknown' || status === 'mixed' ? 'underline' : 'none',
        textDecorationStyle: status === 'mixed' ? 'dotted' : 'solid',
    }),
    reading: (variant: NonNullable<InlineWordContentProps['variant']>, status?: string) => ({
        ...theme.typography[variant === 'subtitle' ? 'subtitleRuby' : variant === 'inspectionTitle' ? 'inspectionRuby' : 'bodyRuby'],
        color: status === 'claimed_known' ? theme.feedback.success : variant === 'body' ? theme.colors.text : theme.media.text,
    }),
}));

/** A real inline view keeps each word independently reachable by TalkBack/VoiceOver.
 * Nested NativeText onPress works by touch but collapses into its parent's AX node.
 */
export function InlineWordControl({ text, children, accessibilityLabel, status, onActivate, variant = 'subtitle' }: InlineWordProps) {
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
      accessibilityLabel={accessibilityLabel ?? `${text}: ${status.replaceAll('_', ' ')}`}
      onPress={activate}
      style={styles.target}>
    {children ?? <NativeText style={styles.word(status, variant)}>{text}</NativeText>}</Pressable>;
}
const styles = StyleSheet.create(theme => ({
    target: {
        minHeight: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'flex-end'
    }, word: (status: string, variant: 'subtitle' | 'body') => ({
        ...theme.typography[variant],
        flexShrink: 1,
        ...(variant === 'subtitle' ? { textShadowColor: theme.media.background, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } } : {}),
        color: status === 'claimed_known' ? theme.feedback.success : variant === 'body' ? theme.colors.text : theme.media.text, textDecorationLine: status === 'claimed_unknown' || status === 'mixed' ? 'underline' : 'none', textDecorationStyle: status === 'mixed' ? 'dotted' : 'solid'
    })
}));
