import type { ReadingSpan } from '@mlearn/contracts';

export type ReadingSegment = {
    readonly text: string;
    readonly reading?: ReadingSpan;
};

/**
 * Package offsets are UTF-8 bytes into this exact source string, not UTF-16
 * positions or cue-global offsets. Keep uncovered source, including newlines.
 */
export function readingSegments(text: string, readings: readonly ReadingSpan[]): readonly ReadingSegment[] {
    const positions = new Map<number, number>([[0, 0]]);
    let bytes = 0;
    let units = 0;
    for (const character of text) {
        const point = character.codePointAt(0);
        if (point === undefined) continue;
        bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
        units += character.length;
        positions.set(bytes, units);
    }
    const segments: ReadingSegment[] = [];
    let cursor = 0;
    for (const reading of readings) {
        const start = positions.get(reading.start);
        const end = positions.get(reading.end);
        // Upstream owns admission. A caller passing a substring instead of the
        // original token must still never cause source loss or broken surrogates.
        if (start === undefined || end === undefined || start < cursor || end <= start) continue;
        if (cursor < start) segments.push({ text: text.slice(cursor, start) });
        segments.push({ text: text.slice(start, end), reading });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor) });
    return segments;
}
