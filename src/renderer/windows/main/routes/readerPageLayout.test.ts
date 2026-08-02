import { describe, expect, it } from 'vitest';
import {
  getSpreadPageSideClass,
  getVisiblePageIndices,
  resolveBookSpreadDirection,
  resolveReaderVerticalLayout,
} from './readerPageLayout';

describe('getVisiblePageIndices', () => {
  it('returns only the current page in single-page mode', () => {
    expect(getVisiblePageIndices(6, 2, 'single', true)).toEqual([2]);
  });

  it('returns only the cover page when the first page is displayed alone', () => {
    expect(getVisiblePageIndices(6, 0, 'double', true)).toEqual([0]);
  });

  it('returns both spread pages after the single cover page', () => {
    expect(getVisiblePageIndices(6, 1, 'double', true)).toEqual([1, 2]);
  });

  it('returns only the last page when no trailing spread page exists', () => {
    expect(getVisiblePageIndices(5, 4, 'double', false)).toEqual([4]);
  });
});

describe('getSpreadPageSideClass', () => {
  it('keeps the first spread page visually on the right for right-to-left spreads', () => {
    expect(getSpreadPageSideClass(0, 2, 'right-to-left')).toBe('page-right');
    expect(getSpreadPageSideClass(1, 2, 'right-to-left')).toBe('page-left');
  });

  it('places the first spread page visually on the left for left-to-right spreads', () => {
    expect(getSpreadPageSideClass(0, 2, 'left-to-right')).toBe('page-left');
    expect(getSpreadPageSideClass(1, 2, 'left-to-right')).toBe('page-right');
  });

  it('does not assign side classes outside a two-page spread', () => {
    expect(getSpreadPageSideClass(0, 1, 'right-to-left')).toBe('');
    expect(getSpreadPageSideClass(2, 2, 'right-to-left')).toBe('');
  });
});

describe('resolveBookSpreadDirection', () => {
  it('prefers an explicit user setting over every other source', () => {
    expect(resolveBookSpreadDirection('right-to-left', 'left-to-right', 'left-to-right', 'ltr')).toBe('right-to-left');
  });

  it('prefers book progression over the language default when the setting is the app default', () => {
    expect(resolveBookSpreadDirection('left-to-right', 'left-to-right', 'left-to-right', 'rtl')).toBe('right-to-left');
  });

  it('uses the language default when neither user nor book chooses a direction', () => {
    expect(resolveBookSpreadDirection(undefined, 'left-to-right', 'right-to-left', null)).toBe('right-to-left');
  });

  it('uses the app default as the final fallback', () => {
    expect(resolveBookSpreadDirection(undefined, 'left-to-right', undefined, null)).toBe('left-to-right');
  });
});

describe('resolveReaderVerticalLayout', () => {
  for (const isEpubBook of [false, true]) {
    for (const supportsVerticalText of [false, true]) {
      for (const declaresVerticalWriting of [false, true]) {
        for (const progressionDirection of [null, 'rtl'] as const) {
          const expected = isEpubBook && supportsVerticalText && (declaresVerticalWriting || progressionDirection === 'rtl');
          it(`returns ${expected} for epub=${isEpubBook}, support=${supportsVerticalText}, declaration=${declaresVerticalWriting}, direction=${progressionDirection}`, () => {
            expect(resolveReaderVerticalLayout({
              isEpubBook,
              supportsVerticalText,
              declaresVerticalWriting,
              progressionDirection,
            })).toBe(expected);
          });
        }
      }
    }
  }
});
