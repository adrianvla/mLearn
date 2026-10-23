import { InlineWord, InlineWordContent } from '@mlearn/ui/inline-word';
import type { LinguisticWordProps } from './LinguisticWord.types';
import { readingSegments } from '@mlearn/ui/reading-segments';

export type { LinguisticWordProps, LinguisticVariant } from './LinguisticWord.types';

/** Static source remains text; only an actual activation makes it a control. */
export function LinguisticWord({ text, presentation, variant = 'body', activation }: LinguisticWordProps) {
    const segments = readingSegments(text, presentation?.readings ?? []).map(segment => {
        const contours = presentation?.contours.filter(contour => contour.reading === (segment.reading?.text ?? segment.text));
        // Source ruby selects a reading, not an arbitrary pronunciation alternative.
        // Ambiguous variants remain fully available in Inspector.
        return { ...segment, contour: contours?.length === 1 ? contours[0] : undefined };
    });
    const content = <InlineWordContent segments={segments} variant={variant} status={activation?.status} />;
    if (!activation) return content;
    const readings = presentation?.readings.map(reading => `${reading.text}. ${reading.attribution}`).join('; ');
    return <InlineWord {...activation} text={text} variant={variant === 'subtitle' ? 'subtitle' : 'body'}
        accessibilityLabel={`${text}: ${activation.status.replaceAll('_', ' ')}${readings ? `. ${readings}` : ''}`}>
        {content}
    </InlineWord>;
}
