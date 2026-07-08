import { unzipSync, strFromU8 } from 'fflate';

export interface EpubTextPage {
  name: string;
  title: string;
  text: string;
  previewText: string;
  source: string;
  index: number;
}

const EPUB_PAGE_CHAR_TARGET = 460;

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

function htmlContent(html: string): { title: string; text: string; previewText: string } {
  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  const body = doc.querySelector('body') ?? doc.documentElement;
  const title = queryText(doc, ['h1', 'h2', 'title']);
  body.querySelectorAll('script, style, nav').forEach((node) => node.remove());
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
  return { title, text, previewText };
}

function splitTextIntoPages(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  const pages: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if (paragraph.length > EPUB_PAGE_CHAR_TARGET) {
      if (current) {
        pages.push(current);
        current = '';
      }
      for (let start = 0; start < paragraph.length; start += EPUB_PAGE_CHAR_TARGET) {
        pages.push(paragraph.slice(start, start + EPUB_PAGE_CHAR_TARGET).trim());
      }
      continue;
    }

    if (current && current.length + paragraph.length + 2 > EPUB_PAGE_CHAR_TARGET) {
      pages.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current) pages.push(current);
  return pages.length > 0 ? pages : [text.trim()].filter(Boolean);
}

export async function epubToTextPages(file: File): Promise<EpubTextPage[]> {
  const sourceName = stripExtension(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(bytes);
  const container = readZipText(files, 'META-INF/container.xml');
  const containerDoc = new DOMParser().parseFromString(container, 'application/xml');
  const rootfilePath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfilePath) throw new Error('EPUB package document not found');

  const opfText = readZipText(files, rootfilePath);
  const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml');
  const opfBase = dirname(rootfilePath);
  const bookTitle = queryText(opfDoc, ['metadata > title', 'dc:title', 'title']) || sourceName;
  const manifest = new Map<string, { href: string; mediaType: string; title: string }>();

  opfDoc.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (!id || !href) return;
    manifest.set(id, {
      href: resolveZipPath(opfBase, href),
      mediaType: item.getAttribute('media-type') ?? '',
      title: item.getAttribute('title') ?? '',
    });
  });

  const pages: EpubTextPage[] = [];
  opfDoc.querySelectorAll('spine > itemref').forEach((itemRef) => {
    const idref = itemRef.getAttribute('idref');
    const item = idref ? manifest.get(idref) : undefined;
    if (!item || !/x?html/u.test(item.mediaType)) return;
    const content = htmlContent(readZipText(files, item.href));
    const chapterTitle = content.title || item.title || bookTitle || displayTitleFromPath(item.href);
    for (const pageText of splitTextIntoPages(content.text)) {
      const previewText = pageText.split(/\n{2,}/u).map((part) => part.trim()).find(Boolean) ?? content.previewText;
      pages.push({
        name: `${item.href}#${pages.length + 1}`,
        title: chapterTitle,
        text: pageText,
        previewText,
        source: sourceName,
        index: pages.length,
      });
    }
  });

  return pages;
}
