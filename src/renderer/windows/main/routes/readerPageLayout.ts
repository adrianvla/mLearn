export type ReaderPageMode = 'double' | 'single';
export type ReaderSpreadDirection = 'left-to-right' | 'right-to-left';

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
