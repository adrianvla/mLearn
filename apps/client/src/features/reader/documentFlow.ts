import type { AnalyzedToken, DocumentAnalyzedBlock, DocumentBlock, DocumentPosition, DocumentRecord, SourceAnchor, SourceReading } from '@mlearn/contracts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const byteLength = (text: string) => encoder.encode(text).length;
export const byteSlice = (text: string, start: number, end?: number) => decoder.decode(encoder.encode(text).subarray(start, end));
export const blockKey = (resource: string, blockId: string) => JSON.stringify([resource, blockId]);
export const positionKey = (position: DocumentPosition | null) => position ? JSON.stringify(position) : '';
export function blockPosition(source: DocumentRecord, block: DocumentBlock, offset = 0): DocumentPosition {
    return { parserRevision: source.parserRevision, resource: block.resource, blockId: block.id, offset };
}

export type DocumentPhrase = {
    readonly start: number;
    readonly end: number;
    readonly text: string;
    readonly token?: AnalyzedToken;
};
export type DocumentSegment = {
    readonly text: string;
    readonly reading?: SourceReading;
    readonly phrases: readonly DocumentPhrase[];
};

/** Partition at authored reading boundaries without assigning a reading to a token.
 * A reading crossing tokens is one ruby with several source occurrences inside.
 * Unanalyzed text remains intact and cannot acquire an activation.
 */
export function documentSegments(block: DocumentBlock, analyses: readonly DocumentAnalyzedBlock[]): readonly DocumentSegment[] {
    const bytes = encoder.encode(block.text);
    const tokens = analyses.filter(item => item.resource === block.resource && item.blockId === block.id)
        .flatMap(item => item.tokens).sort((a, b) => a.start - b.start);
    const ranges: { start: number; end: number; reading?: SourceReading }[] = [];
    let cursor = 0;
    for (const reading of block.readings) {
        if (cursor < reading.start) ranges.push({ start: cursor, end: reading.start });
        ranges.push({ start: reading.start, end: reading.end, reading });
        cursor = reading.end;
    }
    if (cursor < bytes.length) ranges.push({ start: cursor, end: bytes.length });
    return ranges.map(range => {
        const phrases: DocumentPhrase[] = [];
        let at = range.start;
        for (const token of tokens) {
            if (token.end <= at || token.start >= range.end) continue;
            if (at < token.start) {
                phrases.push({ start: at, end: token.start, text: decoder.decode(bytes.subarray(at, token.start)) });
                at = token.start;
            }
            const end = Math.min(token.end, range.end);
            phrases.push({ start: at, end, text: decoder.decode(bytes.subarray(at, end)), token });
            at = end;
        }
        if (at < range.end) phrases.push({ start: at, end: range.end, text: decoder.decode(bytes.subarray(at, range.end)) });
        return { text: decoder.decode(bytes.subarray(range.start, range.end)), reading: range.reading, phrases };
    });
}

/** Capture carries the bounded analyzed context, with offsets relative to it. */
export function documentAnchor(source: DocumentRecord, block: DocumentAnalyzedBlock, token: AnalyzedToken): SourceAnchor {
    return {
        sourceId: source.id, contentRevision: source.contentRevision, packageId: source.packageId,
        packageVersion: source.packageVersion, text: block.text,
        locator: { kind: 'document', parserRevision: source.parserRevision, resource: block.resource,
            blockId: block.blockId, contextStart: block.start,
            selectionStart: token.start - block.start, selectionEnd: token.end - block.start },
    };
}
