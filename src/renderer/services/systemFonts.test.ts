import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMMON_SYSTEM_FONTS, listInstalledSystemFonts } from './systemFonts';

type QueryLocalFontsStub = () => Promise<Array<{ family: string; fullName: string; postscriptName: string }>>;

const originalQueryLocalFonts = (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;

const sortedCommon = () => (
  [...COMMON_SYSTEM_FONTS].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
);

beforeEach(() => {
  delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
});

afterEach(() => {
  if (originalQueryLocalFonts === undefined) {
    delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
  } else {
    (window as unknown as { queryLocalFonts: unknown }).queryLocalFonts = originalQueryLocalFonts;
  }
});

describe('listInstalledSystemFonts', () => {
  it('uses queryLocalFonts when available, sorting and deduping case-insensitively', async () => {
    (window as unknown as { queryLocalFonts: QueryLocalFontsStub }).queryLocalFonts = async () => [
      { family: 'Foo', fullName: 'Foo', postscriptName: 'Foo' },
      { family: 'foo', fullName: 'Foo', postscriptName: 'Foo' },
      { family: 'Bar', fullName: 'Bar', postscriptName: 'Bar' },
    ];
    const fonts = await listInstalledSystemFonts();
    expect(fonts).toEqual([{ family: 'Bar' }, { family: 'Foo' }]);
  });

  it('falls back to the curated list when queryLocalFonts is unavailable', async () => {
    const fonts = await listInstalledSystemFonts();
    expect(fonts.map((font) => font.family)).toEqual(sortedCommon());
    expect(fonts.length).toBeLessThanOrEqual(200);
  });

  it('falls back to the curated list when queryLocalFonts throws', async () => {
    (window as unknown as { queryLocalFonts: QueryLocalFontsStub }).queryLocalFonts = async () => {
      throw new Error('not allowed');
    };
    const fonts = await listInstalledSystemFonts();
    expect(fonts.map((font) => font.family)).toEqual(sortedCommon());
  });
});
