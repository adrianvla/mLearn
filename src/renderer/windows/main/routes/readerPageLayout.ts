export type ReaderPageMode = 'double' | 'single';

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