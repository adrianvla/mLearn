import { describe, expect, it } from 'vitest';
import type { Token } from '../../../../shared/types';
import {
  applyReadingSpansToTokens,
  auditTextPageCapacity,
  estimateTextPageCapacityFromMeasurements,
  estimateVerticalCharsPerLine,
  paginateTextSources,
  resetTextPageCapacityEpoch,
  shrinkTextPageCapacity,
  sliceReadingSpansForRange,
  splitParagraphForPage,
  textPagesFromExtractedText,
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
    // Default ratio (1) falls back to a gentle x0.95 shrink.
    expect(auditTextPageCapacity({ capacity: 391, shrinkIterations: 2 }, true)).toEqual({
      capacity: 371,
      shrinkIterations: 3,
    });
    expect(auditTextPageCapacity({ capacity: 391, shrinkIterations: 2 }, false)).toEqual({
      capacity: 391,
      shrinkIterations: 2,
    });
  });

  it('shrinks proportionally to the measured overflow ratio', () => {
    // Content ~1.25x the page -> capacity / 1.25.
    expect(auditTextPageCapacity({ capacity: 460, shrinkIterations: 0 }, true, 1.25)).toEqual({
      capacity: 368,
      shrinkIterations: 1,
    });
    // Extreme overflow clamps at halving.
    expect(auditTextPageCapacity({ capacity: 460, shrinkIterations: 0 }, true, 9)).toEqual({
      capacity: 230,
      shrinkIterations: 1,
    });
    // Marginal overflow never shrinks more than x0.95.
    expect(auditTextPageCapacity({ capacity: 460, shrinkIterations: 0 }, true, 1.001)).toEqual({
      capacity: 437,
      shrinkIterations: 1,
    });
    // Never below the floor.
    expect(auditTextPageCapacity({ capacity: 125, shrinkIterations: 7 }, true, 9).capacity).toBe(120);
    // Shrinking never stalls: a clamped no-op falls back to the x0.85 shrink.
    expect(auditTextPageCapacity({ capacity: 122, shrinkIterations: 7 }, true, 1.001)).toEqual({
      capacity: 120,
      shrinkIterations: 8,
    });
  });

  it('uses an injectable overflow probe to decide whether an audit shrinks', () => {
    const articles = [{ id: 'overflowing' }, { id: 'fits' }];
    const overflows = (article: { id: string }) => article.id === 'overflowing';

    expect(auditTextPageCapacity({ capacity: 460, shrinkIterations: 0 }, articles.some(overflows), 1.25)).toEqual({
      capacity: 368,
      shrinkIterations: 1,
    });
    expect(auditTextPageCapacity({ capacity: 460, shrinkIterations: 0 }, false)).toEqual({
      capacity: 460,
      shrinkIterations: 0,
    });
  });
});

describe('reading span pagination', () => {
  it('remaps spans into page-local offsets across split pages', () => {
    const pages = paginateTextSources([{
      kind: 'text',
      name: 'chapter',
      title: 'title',
      text: 'ab\n\ncd',
      readingSpans: [
        { start: 0, end: 2, reading: 'x' },
        { start: 4, end: 6, reading: 'y' },
      ],
    }], 'fallback', 3);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ text: 'ab', readingSpans: [{ start: 0, end: 2, reading: 'x' }] });
    expect(pages[1]).toMatchObject({ text: 'cd', readingSpans: [{ start: 0, end: 2, reading: 'y' }] });
  });

  it('drops spans whose base text is split across page boundaries', () => {
    const pages = paginateTextSources([{
      kind: 'text',
      name: 'chapter',
      title: 'title',
      text: 'abcdef',
      readingSpans: [{ start: 1, end: 5, reading: 'r' }],
    }], 'fallback', 3);
    expect(pages.map((page) => page.text)).toEqual(['abc', 'def']);
    expect(pages.every((page) => page.readingSpans === undefined)).toBe(true);
  });

  it('carries spans through the unpaginated fallback path', () => {
    const pages = textPagesFromExtractedText([{
      kind: 'text',
      name: 'chapter',
      title: 'title',
      text: 'ab',
      readingSpans: [{ start: 0, end: 2, reading: 'x' }],
    }], 'fallback');
    expect(pages[0].readingSpans).toEqual([{ start: 0, end: 2, reading: 'x' }]);
  });

  it('slices and rebases spans for a paragraph range', () => {
    const spans = [
      { start: 0, end: 2, reading: 'a' },
      { start: 4, end: 6, reading: 'b' },
    ];
    expect(sliceReadingSpansForRange(spans, 2, 8)).toEqual([{ start: 2, end: 4, reading: 'b' }]);
    expect(sliceReadingSpansForRange(spans, 0, 6)).toEqual(spans);
    expect(sliceReadingSpansForRange(undefined, 0, 1)).toBeUndefined();
  });
});

describe('applyReadingSpansToTokens', () => {
  const token = (surface: string, reading?: string): Token => ({
    word: surface,
    actual_word: surface,
    type: '',
    reading,
  });

  it('overrides the token reading on exact surface match without mutating input', () => {
    const tokens = [token('豚', 'とん'), token('に')];
    const result = applyReadingSpansToTokens('豚に', tokens, [{ start: 0, end: 1, reading: 'ぶた' }]);
    expect(result.map((entry) => entry.reading)).toEqual(['ぶた', undefined]);
    expect(tokens[0].reading).toBe('とん');
  });

  it('keeps the complete tokenizer reading when a stem-prefix span already covers it', () => {
    const tokens = [token('与える', 'あたえる')];
    const result = applyReadingSpansToTokens('与える', tokens, [{ start: 0, end: 1, reading: 'あた' }]);
    expect(result).toBe(tokens);
    expect(result[0].reading).toBe('あたえる');
  });

  it('applies a stem-prefix span when the tokenizer reading is missing', () => {
    const tokens = [token('与える')];
    const result = applyReadingSpansToTokens('与える', tokens, [{ start: 0, end: 1, reading: 'あた' }]);
    expect(result[0].reading).toBe('あた');
  });

  it('applies a stem-prefix span when the tokenizer reading disagrees', () => {
    const result = applyReadingSpansToTokens('与える', [token('与える', 'くみえる')], [{ start: 0, end: 1, reading: 'あた' }]);
    expect(result[0].reading).toBe('あた');
  });

  it('keeps the dictionary reading when multiple spans cut into one token', () => {
    const tokens = [token('抑圧', 'よくあつ')];
    const result = applyReadingSpansToTokens('抑圧', tokens, [
      { start: 0, end: 1, reading: 'よく' },
      { start: 1, end: 2, reading: 'あつ' },
    ]);
    expect(result).toBe(tokens);
    expect(result[0].reading).toBe('よくあつ');
  });

  it('ignores spans that cover multiple tokens', () => {
    const tokens = [token('抑'), token('圧')];
    const result = applyReadingSpansToTokens('抑圧', tokens, [{ start: 0, end: 2, reading: 'よくあつ' }]);
    expect(result).toBe(tokens);
  });

  it('returns the same tokens when no spans are present', () => {
    const tokens = [token('ab')];
    expect(applyReadingSpansToTokens('ab', tokens, undefined)).toBe(tokens);
  });
});

describe('hard page breaks', () => {
  it('flushes at a book page break even when capacity alone would keep one page', () => {
    const pages = paginateTextSources([{
      kind: 'text',
      name: 'ch',
      title: 't',
      text: 'aa\n\nbb\n\ncc',
      pageBreakOffsets: [4],
    }], 'fallback', 100);
    expect(pages.map((page) => page.text)).toEqual(['aa', 'bb\n\ncc']);
  });

  it('forces an earlier split than capacity would produce', () => {
    const withoutBreak = paginateTextSources([{
      kind: 'text',
      name: 'ch',
      title: 't',
      text: 'aaa\n\nbbb\n\nccc',
    }], 'fallback', 8);
    const withBreak = paginateTextSources([{
      kind: 'text',
      name: 'ch',
      title: 't',
      text: 'aaa\n\nbbb\n\nccc',
      pageBreakOffsets: [5],
    }], 'fallback', 8);
    expect(withoutBreak.map((page) => page.text)).toEqual(['aaa\n\nbbb', 'ccc']);
    expect(withBreak.map((page) => page.text)).toEqual(['aaa', 'bbb\n\nccc']);
  });

  it('keeps reading spans and offsets on pages split by a hard break', () => {
    const pages = paginateTextSources([{
      kind: 'text',
      name: 'ch',
      title: 't',
      text: 'ab\n\ncd\n\nef',
      readingSpans: [
        { start: 0, end: 2, reading: 'x' },
        { start: 8, end: 10, reading: 'y' },
      ],
      pageBreakOffsets: [4],
    }], 'fallback', 100);
    expect(pages.map((page) => page.text)).toEqual(['ab', 'cd\n\nef']);
    expect(pages[0].readingSpans).toEqual([{ start: 0, end: 2, reading: 'x' }]);
    expect(pages[1].readingSpans).toEqual([{ start: 4, end: 6, reading: 'y' }]);
  });

  it('ignores break offsets absent from the block list', () => {
    const pages = paginateTextSources([{
      kind: 'text',
      name: 'ch',
      title: 't',
      text: 'aa\n\nbb',
      pageBreakOffsets: [99],
    }], 'fallback', 100);
    expect(pages.map((page) => page.text)).toEqual(['aa\n\nbb']);
  });
});
