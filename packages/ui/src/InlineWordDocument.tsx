import type { PropsWithChildren } from 'react';
import type { CSSProperties } from 'react';
import type { DocumentAppearance, DocumentFlow, LinguisticPresentation } from '@mlearn/contracts';
import type { InlineDocumentFlow, InlineWordProps } from './InlineWord.types';
import { DocumentWordContent, InlineWordElement } from './InlineWordElement.web';
import { readingSegments } from './readingSegments';

export function DocumentWord({ text, presentation, display, status, sourceStart, highlighted, hiddenText = false, onActivate }: {
    readonly text: string;
    readonly presentation?: LinguisticPresentation | null;
    readonly display: InlineDocumentFlow;
    readonly status: string;
    readonly sourceStart: number;
    readonly highlighted: boolean;
    readonly hiddenText?: boolean;
    readonly onActivate: InlineWordProps['onActivate'];
}) {
    const readings = presentation?.readings.map(reading => `${reading.text}. ${reading.attribution}`).join('; ');
    const content = <DocumentWordContent segments={readingSegments(text, presentation?.readings ?? [])}
        documentFlow={display} sourceStart={sourceStart} highlighted={highlighted} hiddenText={hiddenText} />;
    return <InlineWordElement text={text} status={status} onActivate={onActivate} documentFlow={display}
        color={display.color} knownColor={display.knownColor}
        accessibilityLabel={`${text}: ${status.replaceAll('_', ' ')}${readings ? `. ${readings}` : ''}`}>
        {content}
    </InlineWordElement>;
}

export function DocumentFigure({ uri, alt, error, caption, muted, onLoad, onError, onThumbnail }: {
    readonly uri: string | null;
    readonly alt: string;
    readonly error: string;
    readonly caption: { readonly fontSize: number; readonly lineHeight: number; readonly fontWeight: CSSProperties['fontWeight']; readonly _web: { readonly fontFamily: string } };
    readonly muted: string;
    readonly onLoad: () => void;
    readonly onError: () => void;
    readonly onThumbnail: (uri: string) => void;
}) {
    return <figure style={{ margin: 0, writingMode: 'horizontal-tb', color: muted,
        fontFamily: caption._web.fontFamily, fontSize: caption.fontSize,
        lineHeight: `${caption.lineHeight}px`, fontWeight: caption.fontWeight }}>
        {uri ? <img src={uri} alt={alt} crossOrigin="anonymous"
            onLoad={event => {
                onLoad();
                const image = event.currentTarget;
                if (!image.naturalWidth || !image.naturalHeight) return;
                const scale = Math.min(1, 128 / image.naturalWidth, 160 / image.naturalHeight);
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const context = canvas.getContext('2d');
                if (!context) return;
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                onThumbnail(canvas.toDataURL('image/png'));
            }} onError={onError}
            style={{ display: 'block', maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', margin: '0 auto' }} />
            : <figcaption role={error ? 'alert' : 'status'}>{error || 'Loading image…'}</figcaption>}
        {alt ? <figcaption>{alt} · Image description, not analyzed text</figcaption> : null}
    </figure>;
}

/** CSS owns authored document flow. Yoga's horizontal ruby stacks cannot stand
 * in for vertical text, punctuation rotation or cross-occurrence source ruby.
 * All values are accepted presentation data supplied by the containing app.
 */
export function InlineDocumentBlock({ children, appearance, flow, display, kind, page }: PropsWithChildren<{
    readonly appearance: DocumentAppearance;
    readonly flow: DocumentFlow;
    readonly display: InlineDocumentFlow & { readonly fontFamily: string; readonly textScale: number;
        readonly caption: Parameters<typeof DocumentFigure>[0]['caption']; readonly muted: string };
    readonly kind: string;
    readonly page: number | null;
}>) {
    const heading = /^h[1-6]$/.test(kind) ? Number(kind.slice(1)) : null;
    return <section role={heading ? 'heading' : kind === 'li' ? 'listitem' : undefined}
        aria-level={heading ?? undefined}
        style={{
            writingMode: flow, textOrientation: 'mixed', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            fontFamily: appearance.font === 'serif' ? 'serif' : appearance.font === 'sans' ? 'sans-serif' : display.fontFamily,
            fontSize: appearance.fontSize * display.textScale,
            lineHeight: appearance.lineHeight, letterSpacing: appearance.letterSpacing,
            fontWeight: heading ? 600 : 400, color: display.color,
            margin: 0, padding: 0, maxWidth: '100%',
            height: flow === 'horizontal-tb' ? undefined : '100%',
        }}>{page !== null ? <header aria-label={`Original PDF page ${page + 1}`}
            style={{ writingMode: 'horizontal-tb', marginBlockEnd: 12, color: display.muted,
                fontFamily: display.caption._web.fontFamily, fontSize: display.caption.fontSize,
                lineHeight: `${display.caption.lineHeight}px`, fontWeight: display.caption.fontWeight }}>
            Page {page + 1}
        </header> : null}{children}</section>;
}
