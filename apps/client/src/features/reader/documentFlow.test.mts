import test from 'node:test';
import assert from 'node:assert/strict';
import type { AnalyzedToken, DocumentAnalyzedBlock, DocumentBlock, DocumentRecord } from '@mlearn/contracts';
import { byteLength, byteSlice, documentAnchor, documentSegments } from './documentFlow';

const token = (text: string, start: number): AnalyzedToken => ({
    text, start, end: start + byteLength(text), targets: ['target'],
});
const block = (text: string): DocumentBlock => ({
    resource: 'book/chapter.xhtml', id: 'second-bridge', kind: 'p', text, readings: [],
    image: null, page: null, writingMode: 'vertical-lr',
});
const analysis = (source: DocumentBlock, text: string, start: number, tokens: AnalyzedToken[]): DocumentAnalyzedBlock => ({
    resource: source.resource, blockId: source.id, text, start, tokens,
});
test('authored ruby crosses token boundaries without altering source or assigning partial readings', () => {
    // Given an astral prefix, two analyzed occurrences and one authored reading.
    const source = { ...block('🌱 東京へ。\n'), readings: [{ start: 5, end: 11, text: 'とうきょう' }] };
    const analyzed = analysis(source, source.text, 0, [token('🌱 ', 0), token('東', 5), token('京へ', 8), token('。\n', 14)]);
    // When the source is partitioned for CSS ruby.
    const segments = documentSegments(source, [analyzed]);
    // Then a single authored ruby retains both exact occurrence intersections.
    assert.equal(segments.map(item => item.text).join(''), source.text);
    assert.deepEqual(segments.find(item => item.reading)?.phrases.map(item => [item.text, item.token?.start]), [['東', 5], ['京', 8]]);
    assert.equal(segments.filter(item => item.reading).length, 1);
    assert.equal(segments.at(-1)?.text, 'へ。\n');
});
test('bounded analysis leaves every unanalyzed byte visible but non-actionable', () => {
    // Given one analyzed chunk in a much longer original source block.
    const source = block(`before\n${'語'.repeat(2000)}\nafter`);
    const analyzed = analysis(source, '語', 7, [token('語', 7)]);
    // When this bounded projection is displayed.
    const segments = documentSegments(source, [analyzed]);
    const phrases = segments.flatMap(segment => segment.phrases);
    // Then analysis does not truncate the source or activate its remainder.
    assert.equal(phrases.map(item => item.text).join(''), source.text);
    assert.equal(phrases.filter(item => item.token).length, 1);
    assert.equal(phrases.at(-1)?.end, byteLength(source.text));
});
test('document capture binds the analyzed context to exact block-global UTF8 identity', () => {
    // Given a chunk beginning after an astral source prefix.
    const source: DocumentRecord = {
        id: 'source', title: 'Book', documentPath: '/owned/book.epub', contentRevision: 'content',
        parserRevision: 'parser', format: 'epub', packageId: 'package', packageVersion: '1',
        position: null, appearance: { writingMode: 'auto', font: 'source', fontSize: 24, lineHeight: 1.6, letterSpacing: 0 },
        progression: 'rtl', totalBlocks: 8, totalPages: 0, fidelity: [],
    };
    const context = analysis(block(''), '🌱 東京へ。', 512, [token('東京', 517)]);
    // When capturing the analyzed occurrence.
    const anchor = documentAnchor(source, context, context.tokens[0]);
    // Then local selection and original context start never become UTF16/page identity.
    assert.deepEqual(anchor.locator, { kind: 'document', parserRevision: 'parser', resource: 'book/chapter.xhtml',
        blockId: 'second-bridge', contextStart: 512, selectionStart: 5, selectionEnd: 11 });
    if (anchor.locator.kind !== 'document') assert.fail('Expected document locator');
    assert.equal(byteSlice(anchor.text, anchor.locator.selectionStart, anchor.locator.selectionEnd), '東京');
});
