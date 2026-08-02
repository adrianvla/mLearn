import { describe, expect, it } from 'vitest';
import { paginateTextSources, splitParagraphForPage } from './readerTextPagination';

describe('reader text pagination characterization', () => {
  it('keeps a short paragraph verbatim', () => {
    // characterization: pins current behavior, not correctness
    expect(splitParagraphForPage('  unchanged  ', 20)).toEqual(['  unchanged  ']);
  });

  it('uses a trailing whitespace boundary after the 55 percent threshold', () => {
    expect(splitParagraphForPage('aaaaaa bbbbbbbbb', 10)).toEqual(['aaaaaa', 'bbbbbbbbb']);
  });

  it('hard-cuts a paragraph without a qualifying boundary', () => {
    expect(splitParagraphForPage('あいうえおかきくけこさし', 10)).toEqual(['あいうえおかきくけこ', 'さし']);
  });

  it('trims long chunks and the final remainder', () => {
    expect(splitParagraphForPage('  abcdefghij  klm  ', 10)).toEqual(['abcdefghij', 'klm']);
  });

  it('preserves page shape, previews, block joining, and offsets', () => {
    const pages = paginateTextSources([
      { name: 'one.xhtml', title: '', text: '\n\nOne\n\nTwo\n\n', previewText: 'unused' },
      { name: 'two.xhtml', title: 'Two title', text: 'Three', previewText: 'unused' },
    ], 'Book', 7);

    expect(pages).toEqual([
      {
        id: 'text-page-0-one.xhtml', kind: 'text', name: 'one.xhtml', title: 'Book',
        text: 'One', previewText: 'One', index: 0, textStart: 0, textEnd: 3,
      },
      {
        id: 'text-page-1-one.xhtml', kind: 'text', name: 'one.xhtml', title: 'Book',
        text: 'Two', previewText: 'Two', index: 1, textStart: 5, textEnd: 8,
      },
      {
        id: 'text-page-2-two.xhtml', kind: 'text', name: 'two.xhtml', title: 'Two title',
        text: 'Three', previewText: 'Three', index: 2, textStart: 14, textEnd: 19,
      },
    ]);
  });

  it('delegates empty sources to the current extracted-text fallback', () => {
    expect(paginateTextSources([
      { name: 'empty.xhtml', title: '', text: ' \n\n ', previewText: 'fallback preview' },
    ], 'Book', 10)).toEqual([
      {
        id: 'text-page-0-empty.xhtml', kind: 'text', name: 'empty.xhtml', title: 'Book',
        text: ' \n\n ', previewText: 'fallback preview', index: 0,
      },
    ]);
  });

  it('passes image sources through without recreating their blob or URL', () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    const source = { kind: 'image' as const, name: 'image.png', title: 'Book', text: '', previewText: '', src: 'blob:test', blob };

    const [first] = paginateTextSources([source], 'Book', 10);
    const [second] = paginateTextSources([source], 'Book', 3);

    expect(first).toMatchObject({ kind: 'image', src: 'blob:test', blob });
    expect(second).toMatchObject({ kind: 'image', src: 'blob:test', blob });
    expect(first.blob).toBe(blob);
    expect(second.blob).toBe(blob);
  });
});
