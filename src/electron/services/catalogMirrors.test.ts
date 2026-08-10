import { describe, expect, it, vi } from 'vitest';
import { getMirrorCandidateUrl, probeMirrorCatalog } from './catalogMirrors';

describe('getMirrorCandidateUrl', () => {
  it('replaces the host with the indexed mirror host and preserves the path', () => {
    expect(getMirrorCandidateUrl('https://mlearn.kikan.net/language-catalog.json', 'cdn.kikan.net', 0)).toBe(
      'https://mirror0.cdn.kikan.net/language-catalog.json',
    );
    expect(getMirrorCandidateUrl('https://pages.example.com/v1/cat.json?x=1', 'example.org', 3)).toBe(
      'https://mirror3.example.org/v1/cat.json?x=1',
    );
  });

  it('forces https and returns undefined for an unparseable configured URL', () => {
    expect(getMirrorCandidateUrl('http://mlearn.kikan.net/a.json', 'cdn.kikan.net', 1)).toBe(
      'https://mirror1.cdn.kikan.net/a.json',
    );
    expect(getMirrorCandidateUrl('not a url', 'cdn.kikan.net', 0)).toBeUndefined();
  });
});

describe('probeMirrorCatalog', () => {
  it('keeps probing after a success and returns the last successful catalog', async () => {
    const fetchCatalog = vi.fn(async (url: string) => {
      if (url.includes('mirror2')) throw new Error('NXDOMAIN');
      return { url };
    });
    const result = await probeMirrorCatalog('https://mlearn.kikan.net/language-catalog.json', 'cdn.kikan.net', fetchCatalog);
    expect(fetchCatalog.mock.calls.map((c) => c[0])).toEqual([
      'https://mirror0.cdn.kikan.net/language-catalog.json',
      'https://mirror1.cdn.kikan.net/language-catalog.json',
      'https://mirror2.cdn.kikan.net/language-catalog.json',
    ]);
    expect(result).toEqual({ url: 'https://mirror1.cdn.kikan.net/language-catalog.json' });
  });

  it('stops at the first failure and returns undefined when no mirror responds', async () => {
    const fetchCatalog = vi.fn(async () => {
      throw new Error('unreachable');
    });
    const result = await probeMirrorCatalog('https://mlearn.kikan.net/language-catalog.json', 'cdn.kikan.net', fetchCatalog);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it('does not probe when the mirror domain is empty or missing', async () => {
    const fetchCatalog = vi.fn(async () => ({}));
    expect(await probeMirrorCatalog('https://mlearn.kikan.net/a.json', '', fetchCatalog)).toBeUndefined();
    expect(await probeMirrorCatalog('https://mlearn.kikan.net/a.json', '   ', fetchCatalog)).toBeUndefined();
    expect(await probeMirrorCatalog('https://mlearn.kikan.net/a.json', undefined, fetchCatalog)).toBeUndefined();
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it('returns undefined for an unparseable configured URL', async () => {
    const fetchCatalog = vi.fn(async () => ({}));
    expect(await probeMirrorCatalog('not a url', 'cdn.kikan.net', fetchCatalog)).toBeUndefined();
    expect(fetchCatalog).not.toHaveBeenCalled();
  });
});
