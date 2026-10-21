import { useRef, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { type InspectionMode, type TextAnchor, type TextBounds } from '@mlearn/ui/inline-word';
import { Text } from '@mlearn/ui/text';
import type { CueAnalysis, OccurrenceKnowledge, AnalyzedToken } from '@mlearn/contracts';
import { LinguisticWord } from '../linguistic';
/** Presentation only. One native batch owns analysis and all target projections. */
export function AnnotatedText({ analysis, rawText, annotations, onInspect, inspectionMode, variant = 'subtitle' }: {
    analysis: CueAnalysis | null;
    rawText: string;
    annotations: OccurrenceKnowledge[];
    onInspect: (token: AnalyzedToken, anchor: TextAnchor) => void;
    inspectionMode?: InspectionMode;
    variant?: 'subtitle' | 'body';
}) {
    const paragraph = useRef<View>(null);
    if (!analysis)
        return <Text variant={variant} tone={variant === 'body' ? 'content' : 'media'} align={variant === 'body' ? 'left' : 'center'}>{rawText}</Text>;
    const native = Platform.OS !== 'web';
    function inspect(token: AnalyzedToken, anchor: TextAnchor) {
        if (process.env.EXPO_PUBLIC_MLEARN_METRICS === '1')
            console.info(`annotation-ui phase=inspect_action timestamp_ms=${Date.now()}`);
        const measure = (publish: (bounds: TextBounds) => void) => anchor.measure(word => {
            const node = paragraph.current;
            node?.measureInWindow((_x, y, _width, height) => {
                if (paragraph.current === node) publish({ ...word, y, height });
            });
        });
        // Horizontal placement follows the occurrence; vertical clearance keeps
        // its entire authored cue readable, including preceding subtitle lines.
        measure(bounds => onInspect(token, { ...bounds, measure, subscribe: anchor.subscribe, restoreFocus: anchor.restoreFocus }));
    }
    function segment(token: AnalyzedToken, text: string, key: string) {
        return <LinguisticWord
    key={key}
    text={text}
    presentation={text === token.text ? token.presentation : undefined}
    variant={variant}
    activation={token.targets.length ? {
        inspectionMode,
        status: annotations.find(a => a.cueIndex === analysis?.cue.index && a.tokenStart === token.start)?.status ?? 'untracked',
        onActivate: anchor => inspect(token, anchor),
    } : undefined} />;
    }
    if (!native)
        return <View ref={paragraph} testID="annotated-text" style={styles.paragraph}><Text
      accessible={false}
      variant={variant} tone={variant === 'body' ? 'content' : 'media'} align={variant === 'body' ? 'left' : 'center'}>{analysis.tokens.map(token => segment(token, token.text, String(token.start)))}</Text></View>;
    // Native inline-view attachments use the view bottom as a text baseline. A
    // baseline-aligned flow keeps real accessible buttons and punctuation aligned.
    // Explicit rows preserve authored newlines, including blank lines.
    const lines: ReactNode[][] = [[]];
    for (const token of analysis.tokens) {
        token.text.split('\n').forEach((text, index) => {
            if (index)
                lines.push([]);
            if (text)
                lines[lines.length - 1].push(segment(token, text, `${token.start}-${index}`));
        });
    }
    return <View ref={paragraph} testID="annotated-text" style={styles.paragraph}>{lines.map((line, index) => <View
        key={index}
        style={styles.nativeLine(variant)}>{line}</View>)}</View>;
}
const styles = StyleSheet.create(theme => ({
    paragraph: {
        alignSelf: 'stretch'
    }, nativeLine: (variant: 'subtitle' | 'body') => ({
        flexDirection: 'row', flexWrap: 'wrap', justifyContent: variant === 'body' ? 'flex-start' : 'center', alignItems: 'baseline', minHeight: 44 * theme.textScale
    })
}));
