import { useRef, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, Platform, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { PronunciationContour } from '@mlearn/contracts';
import { Button } from './Button';
import { PronunciationReading } from './PronunciationReading';
import type { TextAnchor, TextBounds } from './InlineWord.types';

/** Compact dictionary content with the same focus/anchor contract as source words. */
export function DictionaryCard({ meaning, reading, contours = [], onActivate, focusFallback }: {
    readonly meaning: string;
    readonly reading: string;
    /** Package prosody for the entry; drawn only when exactly one alternative matches the shown reading. */
    readonly contours?: readonly PronunciationContour[];
    readonly onActivate: (anchor: TextAnchor) => void;
    readonly focusFallback?: RefObject<View | null>;
}) {
    const ref = useRef<View>(null);
    const matching = contours.filter(contour => contour.reading === reading);
    const contour = matching.length === 1 ? matching[0] : null;
    const measure = (publish: (bounds: TextBounds) => void) =>
        ref.current?.measureInWindow((x, y, width, height) => publish({ x, y, width, height }));
    const card = <Button ref={ref} label={meaning} detail={contour ? undefined : reading} variant="dictionary" size="compact"
        accessibilityLabel={`${meaning} · ${reading}`}
        onPress={() => measure(bounds => onActivate({
            ...bounds, measure, restoreFocus: () => {
                const target = ref.current ?? focusFallback?.current;
                if (Platform.OS === 'web') target?.focus();
                else {
                    const tag = findNodeHandle(target ?? null);
                    if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
                }
            },
        }))} />;
    if (!contour) return card;
    return <View style={styles.card}>
        {card}
        <View style={styles.reading}><PronunciationReading contour={contour} pill compact /></View>
    </View>;
}

const styles = StyleSheet.create(theme => ({
    card: { gap: theme.spacing.tiny },
    reading: { alignSelf: 'flex-start', paddingHorizontal: theme.spacing.tiny },
}));
