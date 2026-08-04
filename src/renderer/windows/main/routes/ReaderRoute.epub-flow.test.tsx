// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { epubToContentPages } from '../../../services/epubService';
import { adoptEpubBlobUrls, prepareEpubReaderLoad, revokeEpubBlobUrls } from './ReaderRoute';
import { resolveBookSpreadDirection, resolveReaderVerticalLayout } from './readerPageLayout';

function makeEpub(ppd: 'ltr' | 'rtl', vertical: boolean, declaresCover = true): File {
  const writingMode = vertical ? 'vertical-rl' : 'horizontal-tb';
  const coverProperty = declaresCover ? ' properties="cover-image"' : '';
  const entries = {
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Flow Book</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /><item id="image" href="images/cover%20image.png" media-type="image/png"${coverProperty} /></manifest><spine page-progression-direction="${ppd}"><itemref idref="chapter" /></spine></package>`),
    'OEBPS/chapter.xhtml': strToU8(`<html><head><style>body { writing-mode: ${writingMode}; }</style></head><body><p>Text <ruby>語<rt>ご</rt></ruby></p><img src="images/cover%20image.png" /></body></html>`),
    'OEBPS/images/cover image.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  };
  return new File([zipSync(entries)], 'flow.epub', { type: 'application/epub+zip' });
}

describe('ReaderRoute EPUB flow wiring', () => {
  afterEach(() => {
    revokeEpubBlobUrls();
    vi.restoreAllMocks();
  });

  it('prepares EPUB image pages, tokenizer text, and vertical RTL layout', async () => {
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:flow-image');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
    const content = await epubToContentPages(makeEpub('ltr', false));
    const prepared = await prepareEpubReaderLoad(content, 'Flow Book', 100, async () => null);
    const image = prepared.pages.find((page) => page.kind === 'image');
    const text = prepared.sources.find((source) => source.kind !== 'image');

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ kind: 'image', src: 'blob:flow-image' });
    expect(image?.blob).toBeInstanceOf(Blob);
    expect(text?.text).toContain('語');
    expect(prepared.pages.find((page) => page.kind === 'text')?.readingSpans).toEqual([
      { start: 5, end: 6, reading: 'ご' },
    ]);

    adoptEpubBlobUrls(prepared.newBlobUrls);
    expect(revokeUrl).not.toHaveBeenCalled();
    revokeEpubBlobUrls();
    expect(revokeUrl).toHaveBeenCalledWith('blob:flow-image');

    const verticalContent = await epubToContentPages(makeEpub('rtl', true));
    expect(resolveBookSpreadDirection('left-to-right', 'left-to-right', 'left-to-right', verticalContent.progressionDirection)).toBe('right-to-left');
    expect(resolveReaderVerticalLayout({
      isEpubBook: true,
      declaresVerticalWriting: verticalContent.declaresVerticalWriting,
      progressionDirection: verticalContent.progressionDirection,
      supportsVerticalText: true,
    })).toBe(true);
  });

  it('uses the first EPUB image as the recent thumbnail when no cover is declared', async () => {
    const content = await epubToContentPages(makeEpub('ltr', false, false));
    const prepared = await prepareEpubReaderLoad(content, 'Flow Book', 100, async () => null);
    const firstImage = prepared.sources.find((source) => source.kind === 'image');

    expect(content.coverImage).toBeUndefined();
    expect(prepared.coverBlob).toBe(firstImage?.blob);

    adoptEpubBlobUrls(prepared.newBlobUrls);
  });

  it('revokes adopted EPUB URLs on replacement and route cleanup', async () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first-flow-image')
      .mockReturnValueOnce('blob:replacement-flow-image');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
    const content = await epubToContentPages(makeEpub('ltr', false));
    const first = await prepareEpubReaderLoad(content, 'Flow Book', 100, async () => null);
    const replacement = await prepareEpubReaderLoad(content, 'Flow Book', 100, async () => null);

    adoptEpubBlobUrls(first.newBlobUrls);
    adoptEpubBlobUrls(replacement.newBlobUrls);
    expect(revokeUrl).toHaveBeenCalledWith('blob:first-flow-image');

    revokeEpubBlobUrls();
    expect(revokeUrl).toHaveBeenCalledWith('blob:replacement-flow-image');
  });

  it('splits prepared pages at explicit book page breaks', async () => {
    const entries = {
      'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>'),
      'OEBPS/content.opf': strToU8('<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Break Book</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="chapter" /></spine></package>'),
      'OEBPS/chapter.xhtml': strToU8('<html><body><p>one</p><p style="page-break-before: always">two</p></body></html>'),
    };
    const content = await epubToContentPages(new File([zipSync(entries)], 'break.epub', { type: 'application/epub+zip' }));
    const prepared = await prepareEpubReaderLoad(content, 'Break Book', 100, async () => null);
    expect(prepared.pages.filter((page) => page.kind === 'text').map((page) => page.text)).toEqual(['one', 'two']);
  });

  it('revokes newly created EPUB URLs when saved-page loading rejects before adoption', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:failed-flow-image');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL');
    const content = await epubToContentPages(makeEpub('ltr', false));

    await expect(prepareEpubReaderLoad(content, 'Flow Book', 100, async () => {
      throw new Error('saved page unavailable');
    })).rejects.toThrow('saved page unavailable');

    expect(revokeUrl).toHaveBeenCalledWith('blob:failed-flow-image');
    revokeEpubBlobUrls();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
  });
});
