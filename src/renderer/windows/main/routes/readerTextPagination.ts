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
