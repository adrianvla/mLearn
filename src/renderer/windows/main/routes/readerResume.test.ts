import { expect, it } from 'vitest';
import { paginateTextSources, type ReaderSourcePage } from './readerTextPagination';
import { locationForPage, pageForLocation, progressForLocation, parseSavedReaderLocation } from './readerResume';

const sources: ReaderSourcePage[] = [
  { kind: 'text', name: 'one', title: 'One', text: 'First chapter. '.repeat(80) },
  { kind: 'text', name: 'two', title: 'Two', text: 'Second chapter. '.repeat(100) },
];

it('restores a source location across repagination without changing progress', () => {
  const wide = paginateTextSources(sources, 'Book', 250);
  const narrow = paginateTextSources(sources, 'Book', 170);
  const location = locationForPage(wide, 7);
  expect(location?.kind).toBe('text');
  const restoredPage = pageForLocation(narrow, location!);
  expect(restoredPage).not.toBe(7);
  const restoredStart = narrow[restoredPage].sourceChunks?.[0];
  expect(restoredStart?.sourceIndex).toBe((location as { sourceIndex: number }).sourceIndex);
  expect(restoredStart?.sourceStart).toBeLessThanOrEqual((location as { offset: number }).offset);
  const nextStart = narrow[restoredPage + 1]?.sourceChunks?.[0];
  if (nextStart?.sourceIndex === (location as { sourceIndex: number }).sourceIndex) {
    expect(nextStart.sourceStart).toBeGreaterThan((location as { offset: number }).offset);
  }
  const savedProgress = progressForLocation(sources, location!);
  expect(savedProgress).toBeGreaterThan(0);
  expect(savedProgress).toBeLessThan(100);
  expect(progressForLocation(sources, location!)).toBe(savedProgress);
});

it('reads old page indexes while keeping text locators on the same key', () => {
  expect(parseSavedReaderLocation('12')).toBe(12);
  const location = { kind: 'text' as const, sourceIndex: 1, offset: 45 };
  expect(parseSavedReaderLocation(JSON.stringify(location))).toEqual(location);
});
