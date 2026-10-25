import { useUnistyles } from 'react-native-unistyles';
import type { InlineWordContentProps, InlineWordProps } from './InlineWord.types';
import { DocumentWordContent, InlineWordElement } from './InlineWordElement.web';
import { PronunciationReading } from './PronunciationReading';
import { LevelStars } from './LevelStars.web';

export function InlineWordContent(props: InlineWordContentProps) {
    if (props.documentFlow) return <DocumentWordContent {...props} />;
    return <ThemedWordContent {...props} />;
}

function ThemedWordContent({ segments, variant = 'body', status, level, starCollapse }: InlineWordContentProps) {
    const { theme } = useUnistyles();
    const { _web: sourceWeb, ...source } = theme.typography[variant];
    const { _web: rubyWeb, ...ruby } = theme.typography[
        variant === 'subtitle' ? 'subtitleRuby' : variant === 'inspectionTitle' ? 'inspectionRuby' : 'bodyRuby'
    ];
    return <span style={{
        display: level ? 'inline-block' : undefined, position: level ? 'relative' : undefined,
        ...source, ...sourceWeb, lineHeight: `${source.lineHeight}px`,
        color: status === 'claimed_known' || status === 'assessed_known' ? theme.feedback.success : variant === 'body' ? theme.colors.text : theme.media.text,
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
        ...(variant === 'subtitle' ? { textShadow: `0 1px 4px ${theme.media.background}` } : {}),
    }}>{segments.map((segment, index) => segment.reading ? <ruby key={index} style={{
        display: 'inline-flex', flexDirection: 'column-reverse', alignItems: 'center', maxWidth: '100%', verticalAlign: 'bottom',
    }}>
        <span style={{ minWidth: 0, width: '100%', maxWidth: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{segment.reading.base ?? segment.text}</span><rp>(</rp><rt style={{
            ...ruby, ...rubyWeb, display: 'block', maxWidth: '100%', lineHeight: `${ruby.lineHeight}px`,
        }} title={segment.reading.attribution}>
            {segment.contour ? <PronunciationReading contour={segment.contour}
                variant={variant === 'subtitle' ? 'subtitleRuby' : variant === 'inspectionTitle' ? 'inspectionRuby' : 'bodyRuby'} /> : segment.reading.text}
        </rt><rp>)</rp>
    </ruby> : segment.contour ? <PronunciationReading key={index} contour={segment.contour}
        color={status === 'claimed_known' || status === 'assessed_known' ? theme.feedback.success : undefined}
        variant={variant === 'inspectionTitle' ? 'inspectionReading' : variant} /> : segment.text)}
        {level ? <LevelStars rank={level.rank} collapse={starCollapse} label={`${level.label}. ${level.attribution}`} /> : null}</span>;
}

export function InlineWordControl(props: InlineWordProps) {
    if (props.documentFlow) return <InlineWordElement {...props} color={props.documentFlow.color} knownColor={props.documentFlow.knownColor} />;
    return <ThemedWordControl {...props} />;
}
function ThemedWordControl(props: InlineWordProps) {
    const { theme } = useUnistyles();
    return <InlineWordElement {...props} color={props.variant === 'body' ? theme.colors.text : theme.media.text}
        knownColor={theme.feedback.success} />;
}
