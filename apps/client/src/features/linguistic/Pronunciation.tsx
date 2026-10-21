import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Text } from '@mlearn/ui/text';
import { Badge } from '@mlearn/ui/badge';
import { PronunciationReading } from '@mlearn/ui/inline-word';
import type { LinguisticPresentation } from '@mlearn/contracts';

export type PronunciationProps = {
    readonly presentation?: LinguisticPresentation | null;
    /** A genuine entry reading for packages without structured contours. */
    readonly reading?: string | null;
    /** The consumer owns its disclosure control; all alternatives remain visible. */
    readonly expanded?: boolean;
};

/** Static package metadata; no language categories, lookup, or learner state. */
export function Pronunciation({ presentation, reading, expanded = false }: PronunciationProps) {
    if (!presentation?.contours.length && !presentation?.labels.length && !presentation?.readings.length && !reading) return null;
    return <View style={styles.metadata}>
        {presentation?.contours.length ? presentation.contours.map(contour =>
            <View key={contour.id} style={styles.alternative}>
                <PronunciationReading contour={contour} pill />
                {expanded ? <Text variant="detail" tone="media" muted selectable>{contour.label} · {contour.attribution}</Text> : null}
            </View>
        ) : reading ? <Badge label={reading} variant="reading" selectable /> :
            presentation?.readings.map(span => <View key={`${span.start}-${span.end}`} accessible
                accessibilityLabel={`${span.text}. ${span.attribution}`}>
                <Badge label={span.text} variant="reading" selectable />
            </View>)}
        {expanded ? presentation?.readings.map(span =>
            <Text key={`source-${span.start}-${span.end}`} variant="detail" tone="media" muted selectable>{span.text} · {span.attribution}</Text>
        ) : null}
        {presentation?.labels.map(label => <View key={label.id} style={styles.alternative}
            accessible accessibilityLabel={`${label.label}. ${label.attribution}`}>
            <Badge label={label.label} color={label.color} variant="label" selectable />
            {expanded ? <Text variant="detail" tone="media" muted selectable>{label.attribution}</Text> : null}
        </View>)}
    </View>;
}

const styles = StyleSheet.create(theme => ({
    metadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: theme.spacing.small },
    alternative: { maxWidth: '100%', gap: theme.spacing.tiny },
}));
