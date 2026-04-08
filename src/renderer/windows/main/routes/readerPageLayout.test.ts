import { describe, expect, it } from 'vitest';
import { getVisiblePageIndices } from './readerPageLayout';

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