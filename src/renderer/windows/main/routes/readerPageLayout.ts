export type ReaderPageMode = 'double' | 'single';
export type ReaderSpreadDirection = 'left-to-right' | 'right-to-left';
export type BookProgressionDirection = 'ltr' | 'rtl' | null;

export function resolveBookSpreadDirection(
  configured: ReaderSpreadDirection | undefined,
  appDefault: ReaderSpreadDirection,
  languageDefault: ReaderSpreadDirection | undefined,
  bookDirection: BookProgressionDirection,
): ReaderSpreadDirection {
  if (configured !== undefined && configured !== appDefault) return configured;
  if (bookDirection) return bookDirection === 'rtl' ? 'right-to-left' : 'left-to-right';
  return languageDefault ?? appDefault;
}

export function resolveReaderVerticalLayout(opts: {
  isEpubBook: boolean;
  declaresVerticalWriting: boolean;
  progressionDirection: BookProgressionDirection;
  supportsVerticalText: boolean;
}): boolean {
  return opts.isEpubBook
    && opts.supportsVerticalText
    && (opts.declaresVerticalWriting || opts.progressionDirection === 'rtl');
}

export function getVisiblePageIndices(
  totalPages: number,
  currentPage: number,
  pageMode: ReaderPageMode,
  firstPageSingle: boolean,
): number[] {
  if (totalPages <= 0) {
    return [];
  }

  const clampedPage = Math.max(0, Math.min(currentPage, totalPages - 1));

  if (pageMode === 'single') {
    return [clampedPage];
  }

  if (firstPageSingle && clampedPage === 0) {
    return [0];
  }

  const visiblePageIndices = [clampedPage];

  if (clampedPage + 1 < totalPages) {
    visiblePageIndices.push(clampedPage + 1);
  }

  return visiblePageIndices;
}

export function getSpreadPageSideClass(
  pagePosition: number,
  spreadPageCount: number,
  spreadDirection: ReaderSpreadDirection,
): '' | 'page-left' | 'page-right' {
  if (spreadPageCount !== 2) return '';
  if (pagePosition === 0) {
    return spreadDirection === 'right-to-left' ? 'page-right' : 'page-left';
  }
  if (pagePosition === 1) {
    return spreadDirection === 'right-to-left' ? 'page-left' : 'page-right';
  }
  return '';
}
