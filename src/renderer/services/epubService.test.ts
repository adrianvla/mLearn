// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { epubToTextPages, isEpubFile } from './epubService';

function makeFile(entries: Record<string, string>, name = 'book.epub'): File {
  const zipped = zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, text]) => [path, strToU8(text)]),
    ),
  );
  return new File([zipped], name, { type: 'application/epub+zip' });
}

describe('epubService', () => {
  it('detects EPUB files', () => {
    expect(isEpubFile(new File([], 'novel.epub'))).toBe(true);
    expect(isEpubFile(new File([], 'novel.pdf', { type: 'application/pdf' }))).toBe(false);
  });

  it('extracts text pages in spine order', async () => {
    const file = makeFile({
      'META-INF/container.xml': `<?xml version="1.0"?>
        <container>
          <rootfiles>
            <rootfile full-path="OEBPS/content.opf" />
          </rootfiles>
        </container>`,
      'OEBPS/content.opf': `<?xml version="1.0"?>
        <package>
          <manifest>
            <item id="chapter-1" href="chapters/one.xhtml" media-type="application/xhtml+xml" />
            <item id="chapter-2" href="chapters/two.xhtml" media-type="application/xhtml+xml" />
          </manifest>
          <spine>
            <itemref idref="chapter-1" />
            <itemref idref="chapter-2" />
          </spine>
        </package>`,
      'OEBPS/chapters/one.xhtml': '<html><body><h1>One</h1><p>Hello reader.</p></body></html>',
      'OEBPS/chapters/two.xhtml': '<html><body><p>Second chapter.</p><script>ignored()</script></body></html>',
    });

    const pages = await epubToTextPages(file);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({
      name: 'OEBPS/chapters/one.xhtml#1',
      title: 'chapter-1',
      text: 'One\n\nHello reader.',
      index: 0,
    });
    expect(pages[1].text).toBe('Second chapter.');
  });
});
