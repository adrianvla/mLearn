// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { epubToContentPages, isEpubFile } from './epubService';

function makeFile(entries: Record<string, string | Uint8Array>, name = 'book.epub'): File {
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, content]) => [path, typeof content === 'string' ? strToU8(content) : content]),
    ),
  );
  return new File([zipped], name, { type: 'application/epub+zip' });
}

interface EpubFixture {
  ppd?: 'ltr' | 'rtl';
  chapters: Array<{ href: string; html: string }>;
  images?: Array<{ zipPath: string; bytes: Uint8Array; mediaType?: string; manifestHref?: string }>;
  coverEpub3Href?: string;
  coverEpub2Id?: string;
}

function makeEpub({ ppd, chapters, images = [], coverEpub3Href, coverEpub2Id }: EpubFixture): File {
  const chapterItems = chapters.map((chapter, index) =>
    `<item id="chapter-${index}" href="${chapter.href}" media-type="application/xhtml+xml" />`,
  );
  const imageItems = images.flatMap((image, index) => {
    if (!image.mediaType) return [];
    const href = image.manifestHref ?? image.zipPath.replace(/^OEBPS\//u, '');
    const properties = href === coverEpub3Href ? ' properties="cover-image"' : '';
    return [`<item id="image-${index}" href="${href}" media-type="${image.mediaType}"${properties} />`];
  });
  const coverMeta = coverEpub2Id ? `<meta name="cover" content="${coverEpub2Id}" />` : '';
  const entries: Record<string, string | Uint8Array> = {
    'META-INF/container.xml': `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>`,
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Test Book</dc:title>${coverMeta}</metadata><manifest>${chapterItems.join('')}${imageItems.join('')}</manifest><spine${ppd ? ` page-progression-direction="${ppd}"` : ''}>${chapters.map((_, index) => `<itemref idref="chapter-${index}" />`).join('')}</spine></package>`,
  };
  for (const chapter of chapters) entries[`OEBPS/${chapter.href}`] = chapter.html;
  for (const image of images) entries[image.zipPath] = image.bytes;
  return makeFile(entries);
}

describe('epubService', () => {
  it('detects EPUB files', () => {
    expect(isEpubFile(new File([], 'novel.epub'))).toBe(true);
    expect(isEpubFile(new File([], 'novel.pdf', { type: 'application/pdf' }))).toBe(false);
  });

  it('ppd maps rtl, ltr, and an absent attribute to progression directions', async () => {
    const chapter = { href: 'chapters/one.xhtml', html: '<html><body><p>Text</p></body></html>' };
    await expect(epubToContentPages(makeEpub({ ppd: 'rtl', chapters: [chapter] }))).resolves.toMatchObject({ progressionDirection: 'rtl' });
    await expect(epubToContentPages(makeEpub({ ppd: 'ltr', chapters: [chapter] }))).resolves.toMatchObject({ progressionDirection: 'ltr' });
    await expect(epubToContentPages(makeEpub({ chapters: [chapter] }))).resolves.toMatchObject({ progressionDirection: 'ltr' });
  });

  it('vertical scan detects writing-mode, -epub-writing-mode, and tb-rl variants', async () => {
    const vertical = await epubToContentPages(makeEpub({
      chapters: [
        { href: 'a.xhtml', html: '<html><head><style>html { writing-mode: vertical-rl; }</style></head><body><p>A</p></body></html>' },
        { href: 'b.xhtml', html: '<html><head><style>p { -epub-writing-mode: vertical-lr; }</style></head><body><p>B</p></body></html>' },
        { href: 'c.xhtml', html: '<html><head><style>p { writing-mode: tb-rl; }</style></head><body><p>C</p></body></html>' },
      ],
    }));
    const horizontal = await epubToContentPages(makeEpub({ chapters: [{ href: 'a.xhtml', html: '<html><body><p>A</p></body></html>' }] }));
    expect(vertical.declaresVerticalWriting).toBe(true);
    expect(horizontal.declaresVerticalWriting).toBe(false);
  });

  it('image-only chapter returns zipped image bytes at its spine position', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const content = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><img src="img/p1.png" /></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/p1.png', bytes, mediaType: 'image/png' }],
    }));
    expect(content.items).toEqual([expect.objectContaining({ kind: 'image', data: bytes, mediaType: 'image/png', index: 0 })]);
  });

  it('img+text emits text before its image', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><p>Hello</p><img src="img/p2.png" /></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/p2.png', bytes: new Uint8Array([2]), mediaType: 'image/png' }],
    }));
    expect(content.items.map((item) => item.kind)).toEqual(['text', 'image']);
    expect(content.items[0]).toMatchObject({ text: 'Hello', index: 0 });
    expect(content.items[1]).toMatchObject({ index: 1 });
  });

  it('encoded image src strips fragments before resolving the decoded filename', async () => {
    const bytes = new Uint8Array([3]);
    const content = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><img src="img/%E8%B1%9A.png#x" /></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/豚.png', bytes, mediaType: 'image/png' }],
    }));
    expect(content.items[0]).toMatchObject({ kind: 'image', zipPath: 'OEBPS/img/豚.png', data: bytes });
  });

  it('svg image references use the manifest media type', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html xmlns:xlink="http://www.w3.org/1999/xlink"><body><svg><image xlink:href="img/p3.svg" /></svg></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/p3.svg', bytes: new Uint8Array([4]), mediaType: 'image/svg+xml' }],
    }));
    expect(content.items[0]).toMatchObject({ kind: 'image', mediaType: 'image/svg+xml' });
  });

  it('dedupe keeps the first image occurrence across chapters', async () => {
    const bytes = new Uint8Array([5]);
    const content = await epubToContentPages(makeEpub({
      chapters: [
        { href: 'one.xhtml', html: '<html><body><img src="img/p4.png" /></body></html>' },
        { href: 'two.xhtml', html: '<html><body><img src="img/p4.png" /></body></html>' },
      ],
      images: [{ zipPath: 'OEBPS/img/p4.png', bytes, mediaType: 'image/png' }],
    }));
    expect(content.items).toEqual([expect.objectContaining({ kind: 'image', data: bytes, index: 0 })]);
  });

  it('skip-external ignores data and https image sources', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><p>Text</p><img src="data:image/png;base64,AA==" /><img src="https://example.com/x.png" /></body></html>' }],
    }));
    expect(content.items.map((item) => item.kind)).toEqual(['text']);
  });

  it('cover prepends EPUB3 and EPUB2 images without duplicating a spine cover', async () => {
    const epub3 = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><p>Chapter</p></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/cover.png', bytes: new Uint8Array([6]), mediaType: 'image/png' }],
      coverEpub3Href: 'img/cover.png',
    }));
    const epub2 = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><p>Chapter</p></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/cover.png', bytes: new Uint8Array([7]), mediaType: 'image/png' }],
      coverEpub2Id: 'image-0',
    }));
    const inSpine = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><img src="img/cover.png" /></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/cover.png', bytes: new Uint8Array([8]), mediaType: 'image/png' }],
      coverEpub3Href: 'img/cover.png',
    }));
    expect(epub3.items[0]).toMatchObject({ kind: 'image', zipPath: 'OEBPS/img/cover.png', index: 0 });
    expect(epub3.coverImage).toMatchObject({ zipPath: 'OEBPS/img/cover.png' });
    expect(epub2.items[0]).toMatchObject({ kind: 'image', zipPath: 'OEBPS/img/cover.png', index: 0 });
    expect(inSpine.items).toHaveLength(1);
  });

  it('resolves percent-encoded EPUB3 and EPUB2 cover manifest hrefs', async () => {
    const epub3 = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><p>Chapter</p></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/cover image.png', manifestHref: 'img/cover%20image.png', bytes: new Uint8Array([12]), mediaType: 'image/png' }],
      coverEpub3Href: 'img/cover%20image.png',
    }));
    const epub2 = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><p>Chapter</p></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/cover image.png', manifestHref: 'img/cover%20image.png', bytes: new Uint8Array([13]), mediaType: 'image/png' }],
      coverEpub2Id: 'image-0',
    }));

    expect(epub3.coverImage).toMatchObject({ zipPath: 'OEBPS/img/cover image.png', data: new Uint8Array([12]) });
    expect(epub2.coverImage).toMatchObject({ zipPath: 'OEBPS/img/cover image.png', data: new Uint8Array([13]) });
  });

  it('ruby markup keeps base text and records book-defined readings as spans', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{
        href: 'chapter.xhtml',
        html: '<html><body><p><ruby>豚<rp>(</rp><rt>ぶた</rt><rp>)</rp></ruby>に<ruby>人権<rt>じんけん</rt></ruby>を<ruby><rb>与</rb><rt>あた</rt></ruby>えぬ、<ruby><rb>東</rb><rb>京</rb><rtc><rt>とう</rt><rt>きょう</rt></rtc></ruby></p></body></html>',
      }],
    }));
    const [item] = content.items;
    expect(item).toMatchObject({ text: '豚に人権を与えぬ、東京', previewText: '豚に人権を与えぬ、東京' });
    expect(item.kind === 'text' ? item.readingSpans : undefined).toEqual([
      { start: 0, end: 1, reading: 'ぶた' },
      { start: 2, end: 4, reading: 'じんけん' },
      { start: 5, end: 6, reading: 'あた' },
      { start: 9, end: 10, reading: 'とう' },
      { start: 10, end: 11, reading: 'きょう' },
    ]);
  });

  it('remaps reading spans through whitespace collapsing', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{
        href: 'chapter.xhtml',
        html: '<html><body><p>foo\n   <ruby><rb>bar</rb><rt>baz</rt></ruby>  qux</p></body></html>',
      }],
    }));
    const [item] = content.items;
    expect(item).toMatchObject({ text: 'foo bar qux' });
    expect(item.kind === 'text' ? item.readingSpans : undefined).toEqual([
      { start: 4, end: 7, reading: 'baz' },
    ]);
  });

  it('offsets reading spans across joined blocks and keeps rt out of chapter titles', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{
        href: 'chapter.xhtml',
        html: '<html><body><h1><ruby>題<rt>だい</rt></ruby></h1><p>one</p><p><ruby>two<rt>r</rt></ruby></p></body></html>',
      }],
    }));
    const [item] = content.items;
    expect(item).toMatchObject({ title: '題', text: '題\n\none\n\ntwo' });
    expect(item.kind === 'text' ? item.readingSpans : undefined).toEqual([
      { start: 0, end: 1, reading: 'だい' },
      { start: 8, end: 11, reading: 'r' },
    ]);
  });

  it('keeps ruby base text without readings when rt is missing or counts mismatch', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{
        href: 'chapter.xhtml',
        html: '<html><body><p><ruby>base</ruby> x <ruby><rb>A</rb><rb>B</rb><rt>AB</rt></ruby></p></body></html>',
      }],
    }));
    const [item] = content.items;
    expect(item).toMatchObject({ text: 'base x AB' });
    expect(item.kind === 'text' ? item.readingSpans : undefined).toEqual([
      { start: 7, end: 9, reading: 'AB' },
    ]);
  });

  it('empty-skip omits whitespace-only imageless chapters', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [
        { href: 'empty.xhtml', html: '<html><body>  \n  </body></html>' },
        { href: 'text.xhtml', html: '<html><body><p>Keep</p></body></html>' },
      ],
    }));
    expect(content.items).toEqual([expect.objectContaining({ kind: 'text', text: 'Keep' })]);
  });

  it('fixed-layout all-image books load without throwing', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [
        { href: 'one.xhtml', html: '<html><body><img src="img/one.png" /></body></html>' },
        { href: 'two.xhtml', html: '<html><body><img src="img/two.png" /></body></html>' },
      ],
      images: [
        { zipPath: 'OEBPS/img/one.png', bytes: new Uint8Array([9]), mediaType: 'image/png' },
        { zipPath: 'OEBPS/img/two.png', bytes: new Uint8Array([10]), mediaType: 'image/png' },
      ],
    }));
    expect(content.items).toHaveLength(2);
    expect(content.items.every((item) => item.kind === 'image')).toBe(true);
  });

  it('new API preserves spine-order text extraction and EPUB detection regression coverage', async () => {
    const file = makeEpub({
      chapters: [
        { href: 'chapters/one.xhtml', html: '<html><body><p>First</p></body></html>' },
        { href: 'chapters/two.xhtml', html: '<html><body><p>Second</p></body></html>' },
      ],
    });
    const content = await epubToContentPages(file);
    expect(content.items.filter((item) => item.kind === 'text').map((item) => item.text)).toEqual(['First', 'Second']);
    expect(isEpubFile(file)).toBe(true);
  });

  it('mime-fallback uses the extension for unmanifested webp images', async () => {
    const content = await epubToContentPages(makeEpub({
      chapters: [{ href: 'chapter.xhtml', html: '<html><body><img src="img/p.webp" /></body></html>' }],
      images: [{ zipPath: 'OEBPS/img/p.webp', bytes: new Uint8Array([11]) }],
    }));
    expect(content.items[0]).toMatchObject({ kind: 'image', mediaType: 'image/webp' });
  });
});
