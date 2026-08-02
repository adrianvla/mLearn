export interface ReaderSourcePage {
  kind?: 'text' | 'image';
  name: string;
  title: string;
  text: string;
  previewText?: string;
  src?: string;
  blob?: Blob;
}

export interface ReaderPaginatedPage extends ReaderSourcePage {
  id: string;
  kind: 'text' | 'image';
  index: number;
  textStart?: number;
  textEnd?: number;
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

export function auditTextPageCapacity(epoch: TextPageCapacityEpoch, overflows: boolean): TextPageCapacityEpoch {
  if (!overflows || epoch.shrinkIterations >= MAX_TEXT_PAGE_CAPACITY_SHRINKS) return epoch;
  return {
    capacity: shrinkTextPageCapacity(epoch.capacity),
    shrinkIterations: epoch.shrinkIterations + 1,
  };
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

  for (const source of sources) {
    if (source.kind === 'image') {
      pages.push({ ...source, id: `image-page-${pages.length}-${source.name}`, kind: 'image', index: pages.length });
      continue;
    }
    const blocks = source.text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
    let currentBlocks: string[] = [];
    let currentLength = 0;
    let currentStart = globalOffset;
    let sourceOffset = 0;

    const flush = () => {
      if (currentBlocks.length === 0) return;
      const text = currentBlocks.join('\n\n');
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
      });
      currentBlocks = [];
      currentLength = 0;
    };

    for (const block of blocks) {
      const blockChunks = splitParagraphForPage(block, capacity);
      for (const chunk of blockChunks) {
        const separatorLength = currentBlocks.length > 0 ? 2 : 0;
        if (currentBlocks.length > 0 && currentLength + separatorLength + chunk.length > capacity) {
          flush();
          currentStart = globalOffset + sourceOffset;
        }
        if (currentBlocks.length === 0) currentStart = globalOffset + sourceOffset;
        currentBlocks.push(chunk);
        currentLength += separatorLength + chunk.length;
        sourceOffset += chunk.length + 2;
      }
    }

    flush();
    globalOffset += source.text.length + 2;
  }

  return pages.length > 0 ? pages : textPagesFromExtractedText(sources, fallbackTitle);
}
