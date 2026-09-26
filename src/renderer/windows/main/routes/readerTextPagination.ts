import type { Token } from '../../../../shared/types';
import type { EpubReadingSpan } from '../../../services/epubService';

export interface ReaderSourcePage {
  kind?: 'text' | 'image';
  name: string;
  title: string;
  text: string;
  previewText?: string;
  readingSpans?: EpubReadingSpan[];
  /** Offsets into `text` at which a new page must start (explicit book page breaks). */
  pageBreakOffsets?: number[];
  src?: string;
  blob?: Blob;
}

export interface ReaderPaginatedPage extends ReaderSourcePage {
  id: string;
  kind: 'text' | 'image';
  index: number;
  textStart?: number;
  textEnd?: number;
  /** Immutable source offsets for each rendered text block; page indexes change during reflow. */
  sourceChunks?: ReaderTextSourceChunk[];
}

export interface ReaderTextSourceChunk {
  sourceIndex: number;
  /** Start of the unsplit paragraph in the imported source text. */
  blockStart: number;
  /** Start of this possibly split chunk in the imported source text. */
  sourceStart: number;
}

/** Match displayed tokens to their text offsets without assuming a language's word boundaries. */
export function locateSourceTokenOffsets(text: string, tokens: readonly Token[]): number[] {
  let cursor = 0;
  return tokens.map((token) => {
    const surface = token.surface ?? token.word;
    const found = surface ? text.indexOf(surface, cursor) : -1;
    const start = found >= 0 ? found : cursor;
    cursor = Math.min(text.length, start + surface.length);
    return start;
  });
}

/** The imported paragraph stays the same when a layout change moves it to a new page. */
export function readerTextBlockEncounterId(passageId: string, chunk: ReaderTextSourceChunk): string {
  return `${passageId}:block:${chunk.sourceIndex}:${chunk.blockStart}`;
}

/** A token's source character position survives changes to page and chunk boundaries. */
export function readerTextTokenEncounterId(passageId: string, chunk: ReaderTextSourceChunk, tokenStart: number): string {
  return `${passageId}:source:${chunk.sourceIndex}:${chunk.sourceStart + tokenStart}`;
}

export const MIN_TEXT_PAGE_CAPACITY = 120;
const MIN_ESTIMATED_TEXT_PAGE_CAPACITY = 160;
const MAX_TEXT_PAGE_CAPACITY_SHRINKS = 8;

export interface TextPageCapacityEpoch {
  capacity: number;
  shrinkIterations: number;
}

export function estimateVerticalCharsPerLine(inlineExtent: number, fontSize: number): number {
  return Math.max(1, Math.floor(inlineExtent / fontSize));
}

export function estimateTextPageCapacityFromMeasurements(measurements: {
  inlineExtent: number;
  blockExtent: number;
  fontSize: number;
  lineHeight: number;
  vertical: boolean;
  averageGlyphWidth: number;
}): number {
  const charsPerLine = measurements.vertical
    ? estimateVerticalCharsPerLine(measurements.inlineExtent, measurements.fontSize)
    : Math.max(1, Math.floor(measurements.inlineExtent / measurements.averageGlyphWidth));
  const linesPerPage = Math.max(1, Math.floor(measurements.blockExtent / measurements.lineHeight));
  return Math.max(MIN_ESTIMATED_TEXT_PAGE_CAPACITY, Math.floor(charsPerLine * linesPerPage * 0.78));
}

export function shrinkTextPageCapacity(capacity: number): number {
  return Math.max(MIN_TEXT_PAGE_CAPACITY, Math.floor(capacity * 0.85));
}

export function resetTextPageCapacityEpoch(estimate: number): TextPageCapacityEpoch {
  return { capacity: estimate, shrinkIterations: 0 };
}

export function auditTextPageCapacity(
  epoch: TextPageCapacityEpoch,
  overflows: boolean,
  overflowRatio = 1,
): TextPageCapacityEpoch {
  if (!overflows || epoch.shrinkIterations >= MAX_TEXT_PAGE_CAPACITY_SHRINKS) return epoch;
  // Shrink proportionally to the measured content/page overflow so the
  // capacity converges in 1-2 passes; each audit pass re-paginates the whole
  // book, so blind x0.85 steps cost up to eight full re-paginations.
  const factor = Math.min(0.95, Math.max(0.5, 1 / Math.max(overflowRatio, 1.05)));
  const capacity = Math.max(MIN_TEXT_PAGE_CAPACITY, Math.floor(epoch.capacity * factor));
  if (capacity >= epoch.capacity) {
    return {
      capacity: shrinkTextPageCapacity(epoch.capacity),
      shrinkIterations: epoch.shrinkIterations + 1,
    };
  }
  return { capacity, shrinkIterations: epoch.shrinkIterations + 1 };
}

export const textPagesFromExtractedText = (
  pages: ReaderSourcePage[],
  fallbackTitle: string,
): ReaderPaginatedPage[] => (
  pages.map((page, index) => ({
    id: `text-page-${index}-${page.name}`,
    kind: 'text',
    name: page.name || `${fallbackTitle}-${index + 1}`,
    title: page.title || fallbackTitle,
    text: page.text,
    previewText: page.previewText ?? page.text.split(/\n{2,}/u).map((part) => part.trim()).find(Boolean) ?? '',
    ...(page.readingSpans ? { readingSpans: page.readingSpans } : {}),
    ...(page.pageBreakOffsets ? { pageBreakOffsets: page.pageBreakOffsets } : {}),
    index,
  }))
);

export function splitParagraphForPage(paragraph: string, capacity: number): string[] {
  if (paragraph.length <= capacity) return [paragraph];
  const chunks: string[] = [];
  let remaining = paragraph.trim();

  while (remaining.length > capacity) {
    const slice = remaining.slice(0, capacity);
    const breakAt = slice.search(/\s+\S*$/u);
    const end = breakAt > Math.floor(capacity * 0.55) ? breakAt + 1 : capacity;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function paginateTextSources(
  sources: ReaderSourcePage[],
  fallbackTitle: string,
  capacity: number,
): ReaderPaginatedPage[] {
  const pages: ReaderPaginatedPage[] = [];
  let globalOffset = 0;

  for (const [sourceIndex, source] of sources.entries()) {
    if (source.kind === 'image') {
      // The image is the same source item even when preceding text repaginates.
      pages.push({ ...source, id: `image-page-${sourceIndex}-${source.name}`, kind: 'image', index: pages.length });
      continue;
    }
    const blocks = source.text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
    let currentChunks: Array<{ text: string; sourceIndex: number; blockStart: number; sourceStart: number }> = [];
    let currentLength = 0;
    let currentStart = globalOffset;
    let sourceOffset = 0;
    let blockSearchCursor = 0;

    const flush = () => {
      if (currentChunks.length === 0) return;
      const text = currentChunks.map((chunk) => chunk.text).join('\n\n');
      const readingSpans = readingSpansForChunks(source.readingSpans, currentChunks);
      const index = pages.length;
      pages.push({
        id: `text-page-${index}-${source.name}`,
        kind: 'text',
        name: source.name || `${fallbackTitle}-${index + 1}`,
        title: source.title || fallbackTitle,
        text,
        previewText: text.split(/\n{2,}/u).map((part) => part.trim()).find(Boolean) ?? source.previewText ?? '',
        index,
        textStart: currentStart,
        textEnd: currentStart + text.length,
        sourceChunks: currentChunks.map(({ sourceIndex: chunkSourceIndex, blockStart, sourceStart }) => ({
          sourceIndex: chunkSourceIndex, blockStart, sourceStart,
        })),
        ...(readingSpans.length > 0 ? { readingSpans } : {}),
      });
      currentChunks = [];
      currentLength = 0;
    };

    for (const block of blocks) {
      const blockStart = source.text.indexOf(block, blockSearchCursor);
      if (blockStart >= 0) blockSearchCursor = blockStart + block.length;
      const blockBreaksPage = blockStart >= 0 && (source.pageBreakOffsets?.includes(blockStart) ?? false);
      const blockChunks = splitParagraphForPage(block, capacity);
      let chunkSearchCursor = 0;
      for (let chunkIndex = 0; chunkIndex < blockChunks.length; chunkIndex += 1) {
        const chunk = blockChunks[chunkIndex];
        const chunkStartInBlock = blockStart >= 0 ? block.indexOf(chunk, chunkSearchCursor) : -1;
        if (chunkStartInBlock >= 0) chunkSearchCursor = chunkStartInBlock + chunk.length;
        const sourceStart = blockStart >= 0 && chunkStartInBlock >= 0 ? blockStart + chunkStartInBlock : -1;
        if (blockBreaksPage && chunkIndex === 0 && currentChunks.length > 0) {
          flush();
          currentStart = globalOffset + sourceOffset;
        }
        const separatorLength = currentChunks.length > 0 ? 2 : 0;
        if (currentChunks.length > 0 && currentLength + separatorLength + chunk.length > capacity) {
          flush();
          currentStart = globalOffset + sourceOffset;
        }
        if (currentChunks.length === 0) currentStart = globalOffset + sourceOffset;
        currentChunks.push({ text: chunk, sourceIndex, blockStart, sourceStart });
        currentLength += separatorLength + chunk.length;
        sourceOffset += chunk.length + 2;
      }
    }

    flush();
    globalOffset += source.text.length + 2;
  }

  return pages.length > 0 ? pages : textPagesFromExtractedText(sources, fallbackTitle);
}

const readingSpansForChunks = (
  spans: EpubReadingSpan[] | undefined,
  chunks: Array<{ text: string; sourceStart: number }>,
): EpubReadingSpan[] => {
  if (!spans?.length) return [];
  const result: EpubReadingSpan[] = [];
  let pageOffset = 0;
  for (const chunk of chunks) {
    if (chunk.sourceStart >= 0) {
      const chunkEnd = chunk.sourceStart + chunk.text.length;
      for (const span of spans) {
        if (span.start >= chunk.sourceStart && span.end <= chunkEnd) {
          result.push({
            start: span.start - chunk.sourceStart + pageOffset,
            end: span.end - chunk.sourceStart + pageOffset,
            reading: span.reading,
          });
        }
      }
    }
    pageOffset += chunk.text.length + 2;
  }
  return result;
};

export function sliceReadingSpansForRange(
  spans: EpubReadingSpan[] | undefined,
  start: number,
  end: number,
): EpubReadingSpan[] | undefined {
  if (!spans?.length) return undefined;
  const sliced = spans.flatMap((span) => (
    span.start >= start && span.end <= end
      ? [{ start: span.start - start, end: span.end - start, reading: span.reading }]
      : []
  ));
  return sliced.length > 0 ? sliced : undefined;
}

// Book-defined readings take precedence over tokenizer/dictionary readings when a span
// aligns with a token: exact surface match, or a strict prefix (ruby over the stem of an
// inflected token) provided no further span continues inside the same token. A prefix span
// only overrides when the token reading is missing or disagrees — a complete tokenizer
// reading that already covers the stem (e.g. 違う→ちがう with book ruby 違→ちが) is kept whole.
export function applyReadingSpansToTokens(
  paragraph: string,
  tokens: Token[],
  spans: EpubReadingSpan[] | undefined,
): Token[] {
  if (!spans?.length || tokens.length === 0) return tokens;
  let adjusted: Token[] | null = null;
  let cursor = 0;
  tokens.forEach((token, index) => {
    const surface = token.surface || token.word;
    if (!surface) return;
    const start = paragraph.indexOf(surface, cursor);
    if (start < 0) return;
    const end = start + surface.length;
    cursor = end;
    const exact = spans.find((span) => span.start === start && span.end === end);
    const prefix = exact === undefined ? prefixSpanForToken(spans, start, end) : undefined;
    const override = exact ?? prefix;
    if (!override || override.reading === token.reading) return;
    if (prefix && token.reading && token.reading.startsWith(override.reading)) return;
    if (!adjusted) adjusted = tokens.slice();
    adjusted[index] = { ...token, reading: override.reading };
  });
  return adjusted ?? tokens;
}

const prefixSpanForToken = (
  spans: EpubReadingSpan[],
  start: number,
  end: number,
): EpubReadingSpan | undefined => {
  const prefixes = spans.filter((span) => span.start === start && span.end < end);
  if (prefixes.length !== 1) return undefined;
  const [prefix] = prefixes;
  return spans.some((span) => span !== prefix && span.start >= prefix.end && span.start < end) ? undefined : prefix;
};
