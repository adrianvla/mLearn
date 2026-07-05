import { describe, expect, it } from 'vitest';
import { getSpreadPageSideClass, getVisiblePageIndices } from './readerPageLayout';

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
