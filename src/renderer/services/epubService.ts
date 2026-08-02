import { unzipSync, strFromU8 } from 'fflate';

export type EpubProgressionDirection = 'ltr' | 'rtl';

export interface EpubImageRef {
  zipPath: string;
  mediaType: string;
  data: Uint8Array;
}

export interface EpubTextItem {
  kind: 'text';
  name: string;
  title: string;
  text: string;
  previewText: string;
  source: string;
  index: number;
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
}

function chapterContentAndImageRefs(html: string): { content: EpubChapterContent; imageRefs: string[] } {
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  const body = doc.querySelector('body') ?? doc.documentElement;
  const imageRefs = [
    ...Array.from(body.querySelectorAll('img[src]')).map((image) => image.getAttribute('src')),
    ...Array.from(body.querySelectorAll('image')).map((image) => image.getAttribute('xlink:href') ?? image.getAttribute('href')),
  ].filter((ref): ref is string => Boolean(ref));
  const title = queryText(doc, ['h1', 'h2', 'title']);
  body.querySelectorAll('script, style, nav').forEach((node) => {
    node.remove();
  });
  const text = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre'))
    .map((node) => cleanText(node.textContent ?? ''))
    .filter(Boolean)
    .join('\n\n')
    || cleanText(body.textContent ?? '');
  const previewText = Array.from(body.querySelectorAll('p,li,blockquote'))
    .map((node) => cleanText(node.textContent ?? ''))
    .find(Boolean)
    ?? text.split(/\n{2,}/u).find(Boolean)
    ?? '';
  return { content: { title, text, previewText }, imageRefs };
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
