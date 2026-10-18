import { useRef, type ReactNode } from 'react';
import { Platform, View, Text as NativeText } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { InlineWord, type TextAnchor, type TextBounds } from '@mlearn/ui/inline-word';
import type { CueAnalysis, OccurrenceKnowledge, AnalyzedToken } from '@mlearn/contracts';
/** Presentation only. One native batch owns analysis and all target projections. */
export function AnnotatedText({ analysis, rawText, annotations, onInspect }: {
    analysis: CueAnalysis | null;
    rawText: string;
    annotations: OccurrenceKnowledge[];
    onInspect: (token: AnalyzedToken, anchor: TextAnchor) => void;
}) {
    const paragraph = useRef<View>(null);
    if (!analysis)
        return <NativeText style={styles.line}>{rawText}</NativeText>;
    const native = Platform.OS !== 'web';
    function inspect(token: AnalyzedToken, anchor: TextAnchor) {
        const measure = (publish: (bounds: TextBounds) => void) => anchor.measure(word => {
            const node = paragraph.current;
            node?.measureInWindow((_x, y, _width, height) => {
                if (paragraph.current === node) publish({ ...word, y, height });
            });
        });
        // Horizontal placement follows the occurrence; vertical clearance keeps
        // its entire authored cue readable, including preceding subtitle lines.
        measure(bounds => onInspect(token, { ...bounds, measure, restoreFocus: anchor.restoreFocus }));
    }
    function segment(token: AnalyzedToken, text: string, key: string) {
        return token.targets.length ? <InlineWord
    key={key}
    text={text}
    status={annotations.find(a => a.cueIndex === analysis!.cue.index && a.tokenStart === token.start)?.status ?? 'untracked'}
    onActivate={anchor => inspect(token, anchor)}/> : <NativeText
      key={key}
      style={native ? styles.line : undefined}>{text}</NativeText>;
    }
    if (!native)
        return <View ref={paragraph} testID="annotated-text" style={styles.paragraph}><NativeText
      accessible={false}
      style={styles.line}>{analysis.tokens.map(token => segment(token, token.text, String(token.start)))}</NativeText></View>;
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
        style={styles.nativeLine}>{line}</View>)}</View>;
}
const styles = StyleSheet.create(theme => ({
    paragraph: {
        alignSelf: 'stretch'
    }, nativeLine: {
        flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', minHeight: 44 * theme.textScale
    }, line: {
        fontSize: 26 * theme.textScale, lineHeight: 44 * theme.textScale, color: theme.media.text, textAlign: 'center', textShadowColor: theme.media.background, textShadowRadius: 4, textShadowOffset: {
            width: 0, height: 1
        }
    }
}));
