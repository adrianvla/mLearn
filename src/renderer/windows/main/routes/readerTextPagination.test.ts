import { describe, expect, it } from 'vitest';
import {
  auditTextPageCapacity,
  estimateTextPageCapacityFromMeasurements,
  estimateVerticalCharsPerLine,
  paginateTextSources,
  resetTextPageCapacityEpoch,
  shrinkTextPageCapacity,
  splitParagraphForPage,
} from './readerTextPagination';

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

describe('reader text capacity', () => {
  it('uses a one-em inline advance in vertical text', () => {
    expect(estimateVerticalCharsPerLine(199, 20)).toBe(9);
    expect(estimateTextPageCapacityFromMeasurements({
      inlineExtent: 199,
      blockExtent: 200,
      fontSize: 20,
      lineHeight: 25,
      vertical: true,
      averageGlyphWidth: 10,
    })).toBe(160);
  });

  it('keeps horizontal canvas-derived average glyph widths', () => {
    const canvas = { measureText: () => ({ width: 120 }) };
    const averageGlyphWidth = Math.max(canvas.measureText().width / 20, 16 * 0.45);
    expect(estimateTextPageCapacityFromMeasurements({
      inlineExtent: 600,
      blockExtent: 400,
      fontSize: 16,
      lineHeight: 20,
      vertical: false,
      averageGlyphWidth,
    })).toBe(1294);
  });

  it('shrinks to the minimum capacity without going below it', () => {
    let capacity = 460;
    for (let index = 0; index < 20; index += 1) capacity = shrinkTextPageCapacity(capacity);
    expect(shrinkTextPageCapacity(460)).toBe(391);
    expect(capacity).toBe(120);
  });

  it('resets an epoch to its new estimate and counter', () => {
    expect(resetTextPageCapacityEpoch(391)).toEqual({ capacity: 391, shrinkIterations: 0 });
  });

  it('only shrinks capacity while an epoch is active', () => {
    expect(auditTextPageCapacity({ capacity: 391, shrinkIterations: 2 }, true)).toEqual({
      capacity: 332,
      shrinkIterations: 3,
    });
    expect(auditTextPageCapacity({ capacity: 391, shrinkIterations: 2 }, false)).toEqual({
      capacity: 391,
      shrinkIterations: 2,
    });
  });

  it('uses an injectable overflow probe to decide whether an audit shrinks', () => {
    const articles = [{ id: 'overflowing' }, { id: 'fits' }];
    const overflows = (article: { id: string }) => article.id === 'overflowing';

    expect(auditTextPageCapacity({ capacity: 460, shrinkIterations: 0 }, articles.some(overflows))).toEqual({
      capacity: 391,
      shrinkIterations: 1,
    });
    expect(auditTextPageCapacity({ capacity: 460, shrinkIterations: 0 }, false)).toEqual({
      capacity: 460,
      shrinkIterations: 0,
    });
  });
});
