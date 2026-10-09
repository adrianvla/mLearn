// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { epubToContentPages } from '../../../services/epubService';
import { adoptEpubBlobUrls, prepareEpubReaderLoad, revokeEpubBlobUrls, loadSavedReaderLocation } from './ReaderRoute';
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
  it('does not share a title-keyed resume anchor between different source resources', async () => {
    const { getBridge } = await import('../../../../shared/bridges');
    const records = new Map<string, string>([['reader:last-page:Same title', JSON.stringify({ kind: 'text', sourceIndex: 4, offset: 99 })],
      ['mlearn_recent_items', JSON.stringify([{ type: 'book', name: 'Same title', path: '/first.epub' }, { type: 'book', name: 'Same title', path: '/second.epub' }])]]);
    const read = vi.spyOn(getBridge().kvStore, 'kvGet').mockImplementation(async key => records.get(key) ?? null);
    expect(await loadSavedReaderLocation('/first.epub', 'Same title')).toBeNull();
    expect(await loadSavedReaderLocation('/second.epub', 'Same title')).toBeNull();
    expect(read).not.toHaveBeenCalledWith('reader:last-page:Same title');
  });

  it('reuses only an unambiguous legacy file association and reads independently stored source locations', async () => {
    const { getBridge } = await import('../../../../shared/bridges');
    const { hashWordSync } = await import('../../../services/srsAlgorithm');
    const first = { kind: 'text', sourceIndex: 4, offset: 99 };
    const second = { kind: 'text', sourceIndex: 8, offset: 21 };
    const records = new Map<string, string>([['reader:last-page:Same title', JSON.stringify(first)],
      ['mlearn_recent_items', JSON.stringify([{ type: 'book', name: 'Same title', path: '/first.epub' }])]]);
    vi.spyOn(getBridge().kvStore, 'kvGet').mockImplementation(async key => records.get(key) ?? null);
    expect(await loadSavedReaderLocation('/first.epub', 'Same title')).toEqual(first);
    expect(await loadSavedReaderLocation('/second.epub', 'Same title')).toBeNull();
    records.set(`reader:source-location:${hashWordSync('/second.epub')}`, JSON.stringify(second));
    expect(await loadSavedReaderLocation('/second.epub', 'Same title')).toEqual(second);
    expect(await loadSavedReaderLocation('/first.epub', 'Same title')).toEqual(first);
  });

  it('gives an explicit source Return priority over the later saved reading position', async () => {
    const content = await epubToContentPages(makeEpub('ltr', false));
    const location = { kind: 'text' as const, sourceIndex: 0, offset: 5 };
    const saved = vi.fn(async () => ({ kind: 'text' as const, sourceIndex: 0, offset: 0 }));
    const prepared = await prepareEpubReaderLoad(content, 'Flow Book', 100, saved, location);
    expect(prepared.startLocation).toEqual(location);
    expect(saved).not.toHaveBeenCalled();
  });
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

  it('restores the same source locator when the EPUB is prepared at a new capacity', async () => {
    const content = await epubToContentPages(makeEpub('ltr', false));
    const first = await prepareEpubReaderLoad(content, 'Flow Book', 100, async () => null);
    expect(first.resumed).toBe(false);
    const location = first.startLocation;
    expect(location).not.toBeNull();
    const second = await prepareEpubReaderLoad(content, 'Flow Book', 160, async () => location);
    expect(second.resumed).toBe(true);
    expect(second.startLocation).toEqual(location);
    expect(second.pages[second.startPage].kind).toBe(first.pages[first.startPage].kind);
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
