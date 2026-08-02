import { getContentFontFamily } from '../../../../shared/languageFeatures';
import { readingAnnotationMoreContrastEnabled } from '../../../../shared/readingAnnotationSettings';
import type { ReaderTextFontStyle, Settings } from '../../../../shared/types';

export type ReaderPageMode = 'double' | 'single';
export type ReaderSpreadDirection = 'left-to-right' | 'right-to-left';
export type BookProgressionDirection = 'ltr' | 'rtl' | null;

export function resolveReaderTextFontFamily(
  style: ReaderTextFontStyle,
  langData: Parameters<typeof getContentFontFamily>[0],
  fontId: string | undefined,
  customFamily?: string,
): string {
  switch (style) {
    case 'language':
      return getContentFontFamily(langData, fontId);
    case 'sans':
      return 'var(--font-family-sans)';
    case 'serif':
      return 'Georgia, "Times New Roman", "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Noto Serif CJK JP", "Noto Serif CJK SC", "Songti SC", "SimSun", serif';
    case 'mono':
      return 'var(--font-family-mono), "Noto Sans Mono CJK JP", "Noto Sans Mono CJK SC", monospace';
    case 'custom':
      return customFamily ? `"${customFamily}", var(--font-family-content)` : 'var(--font-family-content)';
  }
}

export function resolveReaderAnnotationColor(
  settings: Pick<Settings, 'readingAnnotationMoreContrast'>,
): string {
  return readingAnnotationMoreContrastEnabled(settings) ? 'var(--reader-text-color)' : 'var(--text-secondary)';
}

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
