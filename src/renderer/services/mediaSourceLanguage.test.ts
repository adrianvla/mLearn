import { beforeEach, describe, expect, it, vi } from 'vitest';
const kv = vi.hoisted(() => ({ rows: new Map<string, string>(), get: vi.fn(), set: vi.fn() }));
vi.mock('../../shared/bridges', () => ({ getBridge: () => ({ kvStore: { kvGet: kv.get, kvSet: kv.set } }) }));

beforeEach(() => {
  kv.rows.clear(); kv.get.mockReset(); kv.set.mockReset();
  kv.get.mockImplementation(async (key: string) => kv.rows.get(key) ?? null);
  kv.set.mockImplementation(async (key: string, value: string) => { kv.rows.set(key, value); });
});

describe('source language ownership', () => {
  it('uses authored language independently of a different study preference and persists explicit override across restart', async () => {
    const service = await import('./mediaSourceLanguage');
    const source = { kind: 'book' as const, resourceId: '/one.epub' };
    const selected = await service.loadMediaSourceLanguage(source, { authoredLanguages: ['ja'], fallbackLanguage: 'ru' });
    expect(selected).toMatchObject({ language: 'ja', basis: 'authored' });
    await service.saveMediaSourceLanguage(source, { language: 'future', variantId: 'opaque-variant' });
    vi.resetModules();
    const restarted = await import('./mediaSourceLanguage');
    expect(await restarted.loadMediaSourceLanguage(source, { authoredLanguages: ['ja'], fallbackLanguage: 'de' }))
      .toMatchObject({ language: 'future', variantId: 'opaque-variant', basis: 'override' });
  });
  it('pins an honest fallback for unlabelled or mixed media without script/title guessing', async () => {
    const service = await import('./mediaSourceLanguage');
    const source = { kind: 'video' as const, resourceId: '/same-title.mp4' };
    expect(await service.loadMediaSourceLanguage(source, { authoredLanguages: ['a', 'b'], fallbackLanguage: 'ru' }))
      .toMatchObject({ language: 'ru', basis: 'fallback', authoredLanguages: ['a', 'b'] });
    expect(await service.loadMediaSourceLanguage(source, { fallbackLanguage: 'ja' })).toMatchObject({ language: 'ru', basis: 'fallback' });
  });
  it('separates sources by resource and media kind and survives recent-history pruning', async () => {
    const service = await import('./mediaSourceLanguage');
    const a = { kind: 'book' as const, resourceId: '/same' };
    const b = { kind: 'video' as const, resourceId: '/same' };
    const c = { kind: 'book' as const, resourceId: '/other' };
    await service.saveMediaSourceLanguage(a, { language: 'first' });
    expect(service.mediaSourceLanguageKey(a)).not.toBe(service.mediaSourceLanguageKey(b));
    expect(service.mediaSourceLanguageKey(a)).not.toBe(service.mediaSourceLanguageKey(c));
    kv.rows.set('mlearn_recent_items', '[]');
    expect(await service.loadMediaSourceLanguage(a, { fallbackLanguage: 'other' })).toMatchObject({ language: 'first', basis: 'override' });
  });
  it('preserves unknown structured source-owned metadata while updating a preference', async () => {
    const service = await import('./mediaSourceLanguage');
    const source = { kind: 'book' as const, resourceId: '/future.epub' };
    const key = service.mediaSourceLanguageKey(source);
    kv.rows.set(key, JSON.stringify({ 'future::annotation': { values: [1, { role: 'unheard-of' }] } }));
    await service.saveMediaSourceLanguage(source, { language: 'future' });
    expect(JSON.parse(kv.rows.get(key)!)).toMatchObject({ 'future::annotation': { values: [1, { role: 'unheard-of' }] } });
  });
  it('does not acknowledge a failed preference write or hide malformed persisted input', async () => {
    const service = await import('./mediaSourceLanguage');
    const source = { kind: 'video' as const, resourceId: '/one' };
    kv.set.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(service.saveMediaSourceLanguage(source, { language: 'future' })).rejects.toThrow('disk unavailable');
    kv.rows.set(service.mediaSourceLanguageKey(source), '{broken');
    await expect(service.loadMediaSourceLanguage(source, { fallbackLanguage: 'future' })).rejects.toThrow();
  });
});

it('retains an authored source context when a resume caller has no metadata yet', async () => {
  const service = await import('./mediaSourceLanguage');
  const source = { kind: 'video' as const, resourceId: '/authored-source' };
  expect(await service.loadMediaSourceLanguage(source, { authoredLanguages: ['future'], fallbackLanguage: 'other' })).toMatchObject({ language: 'future', basis: 'authored' });
  expect(await service.loadMediaSourceLanguage(source, { fallbackLanguage: 'other' })).toMatchObject({ language: 'future', basis: 'authored' });
});

it('reads established media preferences for Messenger without inventing or writing a fallback', async () => {
  const service = await import('./mediaSourceLanguage');
  const source = { kind: 'book' as const, resourceId: '/offered.epub' };
  expect(await service.getEstablishedMediaSourceLanguage(source)).toBeUndefined();
  expect(kv.set).not.toHaveBeenCalled();
  await service.saveMediaSourceLanguage(source, { language: 'future', variantId: 'future:variant' });
  kv.set.mockClear();
  expect(await service.getEstablishedMediaSourceLanguage(source)).toEqual({ language: 'future', variantId: 'future:variant' });
  expect(kv.set).not.toHaveBeenCalled();
});
