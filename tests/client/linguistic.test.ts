import test from 'node:test';
import assert from 'node:assert/strict';
import { readingSegments } from '../../apps/client/src/features/linguistic/readingSegments';

test('reading spans map original UTF-8 bytes without splitting non-BMP source or newlines', () => {
  const source = '日本😀\n語';
  const first = { start: 0, end: 6, text: 'にほん', attribution: 'Authored fixture' };
  const last = { start: 11, end: 14, text: 'ご', attribution: 'Authored fixture' };
  const segments = readingSegments(source, [first, last]);
  assert.deepEqual(segments, [
    { text: '日本', reading: first },
    { text: '😀\n' },
    { text: '語', reading: last },
  ]);
  assert.equal(segments.map(segment => segment.text).join(''), source);
});

test('absent or inapplicable readings never discard original source', () => {
  const source = '𠮷野家\n';
  assert.deepEqual(readingSegments(source, []), [{ text: source }]);
  assert.deepEqual(readingSegments(source, [
    { start: 1, end: 4, text: 'wrong boundary', attribution: 'Authored fixture' },
  ]), [{ text: source }]);
});
