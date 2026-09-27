import type { ReaderSourcePage, ReaderTextSourceChunk } from './readerTextPagination';

interface ReaderPageLocationView {
  id: string;
  kind: 'text' | 'image';
  sourceChunks?: ReaderTextSourceChunk[];
}

export type ReaderSourceLocation =
  | { kind: 'text'; sourceIndex: number; offset: number }
  | { kind: 'image'; id: string };

export function locationForPage(pages: readonly ReaderPageLocationView[], pageIndex: number): ReaderSourceLocation | null {
  const page = pages[pageIndex];
  if (!page) return null;
  if (page.kind === 'image') return { kind: 'image', id: page.id };
  const first = page.sourceChunks?.find((chunk) => chunk.sourceStart >= 0);
  return first ? { kind: 'text', sourceIndex: first.sourceIndex, offset: first.sourceStart } : null;
}

export function pageForLocation(pages: readonly ReaderPageLocationView[], location: ReaderSourceLocation): number {
  if (location.kind === 'image') return Math.max(0, pages.findIndex((page) => page.id === location.id));
  let best = 0;
  for (const [index, page] of pages.entries()) {
    if (page.kind !== 'text') continue;
    const first = page.sourceChunks?.find((chunk) => chunk.sourceStart >= 0);
    if (!first) continue;
    if (first.sourceIndex > location.sourceIndex || (first.sourceIndex === location.sourceIndex && first.sourceStart > location.offset)) break;
    best = index;
  }
  return best;
}

export function progressForLocation(sources: readonly ReaderSourcePage[], location: ReaderSourceLocation): number {
  const weights = sources.map((source) => source.kind === 'image' ? 1 : Math.max(1, source.text.length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) return 0;
  const sourceIndex = location.kind === 'text' ? location.sourceIndex : sources.findIndex((_source, index) =>
    location.id.startsWith(`image-page-${index}-`));
  if (sourceIndex < 0 || sourceIndex >= sources.length) return 0;
  const preceding = weights.slice(0, sourceIndex).reduce((sum, weight) => sum + weight, 0);
  const offset = location.kind === 'text' ? Math.min(Math.max(location.offset, 0), weights[sourceIndex]) : 0;
  return Math.min(100, Math.max(0, ((preceding + offset) / total) * 100));
}

export function parseSavedReaderLocation(raw: string | null): ReaderSourceLocation | number | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (Number.isInteger(value) && Number(value) >= 0) return Number(value);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (record.kind === 'text' && Number.isInteger(record.sourceIndex) && Number(record.sourceIndex) >= 0
      && Number.isInteger(record.offset) && Number(record.offset) >= 0) {
      return { kind: 'text', sourceIndex: Number(record.sourceIndex), offset: Number(record.offset) };
    }
    if (record.kind === 'image' && typeof record.id === 'string' && record.id) return { kind: 'image', id: record.id };
  } catch { /* Legacy or malformed values have no usable source location. */ }
  return null;
}
