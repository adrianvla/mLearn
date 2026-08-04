import { unzipSync, strFromU8 } from 'fflate';

export type EpubProgressionDirection = 'ltr' | 'rtl';

export interface EpubImageRef {
  zipPath: string;
  mediaType: string;
  data: Uint8Array;
}

export interface EpubReadingSpan {
  /** Start offset (inclusive) into the item's plain text, in UTF-16 code units. */
  start: number;
  /** End offset (exclusive) into the item's plain text. */
  end: number;
  /** Book-defined reading annotation for the covered base text. */
  reading: string;
}

export interface EpubTextItem {
  kind: 'text';
  name: string;
  title: string;
  text: string;
  previewText: string;
  source: string;
  index: number;
  readingSpans?: EpubReadingSpan[];
  /** Offsets into `text` where a new page must start (explicit book page breaks). */
  pageBreakOffsets?: number[];
}

export interface EpubImageItem extends EpubImageRef {
  kind: 'image';
  name: string;
  title: string;
  index: number;
}

export type EpubContentItem = EpubTextItem | EpubImageItem;

export interface EpubContent {
  items: EpubContentItem[];
  progressionDirection: EpubProgressionDirection;
  declaresVerticalWriting: boolean;
  coverImage?: EpubImageRef;
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

export function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.epub') || file.type === 'application/epub+zip';
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx + 1) : '';
}

function resolveZipPath(base: string, href: string): string {
  if (!base) return href.replace(/^\/+/u, '');
  const parts = `${base}${href}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function normalizedZipHref(href: string): string | undefined {
  try {
    return decodeURIComponent(href.split('#', 1)[0] ?? '');
  } catch {
    return undefined;
  }
}

function readZipText(files: Record<string, Uint8Array>, path: string): string {
  const entry = files[path];
  if (!entry) throw new Error(`Missing EPUB entry: ${path}`);
  return strFromU8(entry);
}

function cleanText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function queryText(doc: Document, selectors: string[]): string {
  for (const selector of selectors) {
    if (selector.includes(':')) {
      const text = doc.getElementsByTagName(selector)[0]?.textContent;
      if (text) return cleanText(text);
      continue;
    }
    const text = doc.querySelector(selector)?.textContent;
    if (text) return cleanText(text);
  }
  return '';
}

function displayTitleFromPath(path: string): string {
  const fileName = path.split('/').pop() ?? path;
  return stripExtension(fileName)
    .replace(/[_-]+/gu, ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

interface EpubManifestItem {
  href: string;
  mediaType: string;
  title: string;
  properties: string;
}

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
};

function imageMediaType(path: string, manifestItem: EpubManifestItem | undefined): string | undefined {
  if (manifestItem?.mediaType.startsWith('image/')) return manifestItem.mediaType;
  const extension = path.split('.').pop()?.toLowerCase();
  return extension ? IMAGE_MEDIA_TYPES[extension] : undefined;
}

interface EpubChapterContent {
  title: string;
  text: string;
  previewText: string;
  readingSpans?: EpubReadingSpan[];
  pageBreakOffsets?: number[];
}

interface RawExtraction {
  text: string;
  spans: EpubReadingSpan[];
}

function childElements(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName);
}

// textContent would flatten rt/rp/rtc readings inline after each word, so ruby base
// text is walked explicitly and book-defined readings are recorded as offset spans.
function extractRubyAnnotation(ruby: Element, raw: RawExtraction): void {
  const bases = childElements(ruby, 'rb');
  const directReadings = childElements(ruby, 'rt');
  const readings = directReadings.length > 0
    ? directReadings
    : childElements(ruby, 'rtc').flatMap((rtc) => childElements(rtc, 'rt'));
  const pushSpan = (base: string, reading: string) => {
    const start = raw.text.length;
    raw.text += base;
    if (reading && base.trim()) raw.spans.push({ start, end: raw.text.length, reading });
  };
  if (bases.length > 0 && bases.length === readings.length) {
    bases.forEach((base, index) => {
      pushSpan(base.textContent ?? '', cleanText(readings[index].textContent ?? ''));
    });
    return;
  }
  const fallbackBase = bases.length > 0
    ? bases.map((base) => base.textContent ?? '').join('')
    : Array.from(ruby.childNodes).reduce((text, node) => text + (node.nodeType === 3 ? node.nodeValue ?? '' : ''), '');
  pushSpan(fallbackBase, readings.map((reading) => cleanText(reading.textContent ?? '')).filter(Boolean).join(''));
}

function walkExtractableText(node: Node, raw: RawExtraction): void {
  if (node.nodeType === 3) {
    raw.text += node.nodeValue ?? '';
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  switch (element.localName) {
    case 'script':
    case 'style':
    case 'nav':
    case 'rt':
    case 'rp':
    case 'rtc':
      return;
    case 'ruby':
      extractRubyAnnotation(element, raw);
      return;
    default:
      for (const child of Array.from(element.childNodes)) walkExtractableText(child, raw);
  }
}

const BREAK_BEFORE_RE = /(?:page-break-before|break-before)\s*:\s*(?:always|left|right|page)\b/i;
const BREAK_AFTER_RE = /(?:page-break-after|break-after)\s*:\s*(?:always|left|right|page)\b/i;

function pageBreakTargetedClasses(doc: Document): { before: Set<string>; after: Set<string> } {
  const before = new Set<string>();
  const after = new Set<string>();
  for (const styleEl of Array.from(doc.querySelectorAll('style'))) {
    for (const chunk of (styleEl.textContent ?? '').split('}')) {
      const openBrace = chunk.lastIndexOf('{');
      if (openBrace < 0) continue;
      const selectorPart = chunk.slice(0, openBrace);
      const declPart = chunk.slice(openBrace + 1);
      const isBefore = BREAK_BEFORE_RE.test(declPart);
      const isAfter = BREAK_AFTER_RE.test(declPart);
      if (!isBefore && !isAfter) continue;
      const target = isBefore ? before : after;
      for (const match of selectorPart.matchAll(/\.([A-Za-z_][\w-]*)/gu)) target.add(match[1]);
    }
  }
  return { before, after };
}

function breakSignalForElement(
  el: Element,
  beforeClasses: ReadonlySet<string>,
  afterClasses: ReadonlySet<string>,
): 'before' | 'after' | null {
  const style = el.getAttribute('style') ?? '';
  if (BREAK_BEFORE_RE.test(style)) return 'before';
  if (BREAK_AFTER_RE.test(style)) return 'after';
  const className = el.getAttribute('class') ?? '';
  if (/[-_]after\b/i.test(className)) return 'after';
  if (/[-_]before\b/i.test(className)) return 'before';
  if (/(?:^|[\s-])(?:page[-_]?break|new[-_]?page)(?=$|[\s-])/i.test(className)) return 'before';
  const classes = className.split(/\s+/u).filter(Boolean);
  if (classes.some((c) => afterClasses.has(c))) return 'after';
  if (classes.some((c) => beforeClasses.has(c))) return 'before';
  return null;
}

function nearestBreakElement(
  el: Element,
  beforeClasses: ReadonlySet<string>,
  afterClasses: ReadonlySet<string>,
): { element: Element; direction: 'before' | 'after' } | null {
  let node: Element | null = el;
  while (node && node.localName !== 'body') {
    const direction = breakSignalForElement(node, beforeClasses, afterClasses);
    if (direction) return { element: node, direction };
    node = node.parentElement;
  }
  return null;
}

function walkCleanedText(root: Element): RawExtraction {
  const raw: RawExtraction = { text: '', spans: [] };
  walkExtractableText(root, raw);
  const source = raw.text;
  const rawToClean = new Int32Array(source.length).fill(-1);
  let text = '';
  let pendingWhitespace = -1;
  // U+3000 (ideographic space) is a meaningful glyph in CJK text, not collapsible whitespace.
  for (let i = 0; i < source.length; i += 1) {
    if (/[^\S\u3000]/u.test(source[i])) {
      if (pendingWhitespace < 0) pendingWhitespace = i;
      continue;
    }
    if (pendingWhitespace >= 0) {
      if (text.length > 0) {
        rawToClean[pendingWhitespace] = text.length;
        text += ' ';
      }
      pendingWhitespace = -1;
    }
    rawToClean[i] = text.length;
    text += source[i];
  }
  const spans = raw.spans.flatMap((span) => {
    let start = span.start;
    let end = span.end;
    while (start < end && /\s/u.test(source[start])) start += 1;
    while (end > start && /\s/u.test(source[end - 1])) end -= 1;
    if (start >= end) return [];
    const cleanStart = rawToClean[start];
    const cleanEnd = rawToClean[end - 1] + 1;
    return cleanStart >= 0 && cleanEnd > cleanStart ? [{ start: cleanStart, end: cleanEnd, reading: span.reading }] : [];
  });
  return { text, spans };
}

function chapterContentAndImageRefs(html: string): { content: EpubChapterContent; imageRefs: string[] } {
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  const body = doc.querySelector('body') ?? doc.documentElement;
  const imageRefs = [
    ...Array.from(body.querySelectorAll('img[src]')).map((image) => image.getAttribute('src')),
    ...Array.from(body.querySelectorAll('image')).map((image) => image.getAttribute('xlink:href') ?? image.getAttribute('href')),
  ].filter((ref): ref is string => Boolean(ref));
  const { before: breakBeforeClasses, after: breakAfterClasses } = pageBreakTargetedClasses(doc);
  const breakMarkers = Array.from(body.querySelectorAll('*')).filter((el) => (
    !(el.textContent ?? '').trim() && nearestBreakElement(el, breakBeforeClasses, breakAfterClasses) !== null
  ));
  const blocks = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre'))
    .map((element) => ({
      element,
      ...walkCleanedText(element),
      breakSignal: nearestBreakElement(element, breakBeforeClasses, breakAfterClasses),
    }));
  const heading = ['h1', 'h2']
    .map((tag) => blocks.find((block) => block.element.localName === tag && block.text))
    .find((block) => block !== undefined);
  const title = heading?.text ?? queryText(doc, ['title']);
  let text = '';
  const spans: EpubReadingSpan[] = [];
  const pageBreakOffsets: number[] = [];
  const seenBeforeAncestors = new Set<Element>();
  let prevAfterElement: Element | null = null;
  let markerIndex = 0;
  for (const block of blocks) {
    if (!block.text) continue;
    const consumedMarkersBefore = markerIndex;
    while (
      markerIndex < breakMarkers.length
      && (breakMarkers[markerIndex].compareDocumentPosition(block.element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    ) {
      markerIndex += 1;
    }
    let startsPage = consumedMarkersBefore < markerIndex;
    if (block.breakSignal?.direction === 'before') {
      if (!seenBeforeAncestors.has(block.breakSignal.element)) {
        seenBeforeAncestors.add(block.breakSignal.element);
        startsPage = true;
      }
    } else if (prevAfterElement !== null && !prevAfterElement.contains(block.element)) {
      startsPage = true;
    }
    if (block.breakSignal?.direction === 'after') prevAfterElement = block.breakSignal.element;
    else prevAfterElement = null;
    if (text.length > 0) text += '\n\n';
    const offset = text.length;
    text += block.text;
    if (startsPage && offset > 0) pageBreakOffsets.push(offset);
    for (const span of block.spans) {
      spans.push({ start: span.start + offset, end: span.end + offset, reading: span.reading });
    }
  }
  if (!text) {
    const fallback = walkCleanedText(body);
    text = fallback.text;
    spans.push(...fallback.spans);
  }
  const previewText = blocks.find((block) => ['p', 'li', 'blockquote'].includes(block.element.localName) && block.text)?.text
    ?? text.split(/\n{2,}/u).find(Boolean)
    ?? '';
  return {
    content: {
      title,
      text,
      previewText,
      readingSpans: spans.length > 0 ? spans : undefined,
      pageBreakOffsets: pageBreakOffsets.length > 0 ? pageBreakOffsets : undefined,
    },
    imageRefs,
  };
}

function epubImageRef(
  files: Record<string, Uint8Array>,
  manifestByPath: Map<string, EpubManifestItem>,
  zipPath: string,
): EpubImageRef | undefined {
  const data = files[zipPath];
  const mediaType = imageMediaType(zipPath, manifestByPath.get(zipPath));
  return data && mediaType ? { zipPath, mediaType, data } : undefined;
}

export async function epubToContentPages(file: File): Promise<EpubContent> {
  const sourceName = stripExtension(file.name);
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const containerDoc = new DOMParser().parseFromString(readZipText(files, 'META-INF/container.xml'), 'application/xml');
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfilePath) throw new Error('EPUB package document not found');

  const opfDoc = new DOMParser().parseFromString(readZipText(files, rootfilePath), 'application/xml');
  const opfBase = dirname(rootfilePath);
  const bookTitle = queryText(opfDoc, ['metadata > title', 'dc:title', 'title']) || sourceName;
  const manifest = new Map<string, EpubManifestItem>();
  const manifestByPath = new Map<string, EpubManifestItem>();
  for (const element of Array.from(opfDoc.querySelectorAll('manifest > item'))) {
    const id = element.getAttribute('id');
    const href = element.getAttribute('href');
    if (!id || !href) continue;
    const normalizedHref = normalizedZipHref(href);
    if (!normalizedHref) continue;
    const item = {
      href: resolveZipPath(opfBase, normalizedHref),
      mediaType: element.getAttribute('media-type') ?? '',
      title: element.getAttribute('title') ?? '',
      properties: element.getAttribute('properties') ?? '',
    };
    manifest.set(id, item);
    manifestByPath.set(item.href, item);
  }

  const spine = opfDoc.querySelector('spine');
  const progressionDirection: EpubProgressionDirection = spine?.getAttribute('page-progression-direction') === 'rtl' ? 'rtl' : 'ltr';
  let declaresVerticalWriting = false;
  // ponytail: scans chapter XHTML only — linked-CSS declarations are missed; ppd=rtl union in the route catches those books.
  const items: EpubContentItem[] = [];
  const emittedImages = new Set<string>();
  for (const itemRef of Array.from(opfDoc.querySelectorAll('spine > itemref'))) {
    const item = manifest.get(itemRef.getAttribute('idref') ?? '');
    if (!item || !/x?html/u.test(item.mediaType)) continue;
    const rawXhtml = readZipText(files, item.href);
    if (/(-epub-)?writing-mode\s*:\s*(vertical-rl|vertical-lr|tb-rl|tb-lr)/u.test(rawXhtml)) declaresVerticalWriting = true;
    const { content, imageRefs } = chapterContentAndImageRefs(rawXhtml);
    const chapterTitle = content.title || item.title || bookTitle || displayTitleFromPath(item.href);
    if (content.text) {
      items.push({
        kind: 'text',
        name: item.href,
        title: chapterTitle,
        text: content.text,
        previewText: content.previewText || content.text.split(/\n{2,}/u).map((part) => part.trim()).find(Boolean) || '',
        source: sourceName,
        index: 0,
        ...(content.readingSpans ? { readingSpans: content.readingSpans } : {}),
        ...(content.pageBreakOffsets ? { pageBreakOffsets: content.pageBreakOffsets } : {}),
      });
    }
    for (const ref of imageRefs) {
      const decodedRef = normalizedZipHref(ref);
      if (!decodedRef || /^(?:data:|https?:\/\/)/iu.test(decodedRef)) continue;
      const image = epubImageRef(files, manifestByPath, resolveZipPath(dirname(item.href), decodedRef));
      if (!image || emittedImages.has(image.zipPath)) continue;
      emittedImages.add(image.zipPath);
      items.push({ kind: 'image', ...image, name: image.zipPath, title: chapterTitle, index: 0 });
    }
  }

  const epub3Cover = Array.from(manifest.values()).find((item) => item.properties.split(/\s+/u).includes('cover-image'));
  const epub2CoverId = opfDoc.querySelector('metadata > meta[name="cover"]')?.getAttribute('content');
  const coverImage = epubImageRef(files, manifestByPath, (epub3Cover ?? (epub2CoverId ? manifest.get(epub2CoverId) : undefined))?.href ?? '');
  if (coverImage && !emittedImages.has(coverImage.zipPath)) {
    items.unshift({ kind: 'image', ...coverImage, name: coverImage.zipPath, title: bookTitle, index: 0 });
  }
  if (items.length === 0) throw new Error('No readable content found in EPUB file');
  items.forEach((item, index) => {
    item.index = index;
  });
  return { items, progressionDirection, declaresVerticalWriting, ...(coverImage ? { coverImage } : {}) };
}
