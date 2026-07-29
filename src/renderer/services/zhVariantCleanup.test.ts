// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import type { ConversationSession, DictionaryEntry, LanguageDataMap, Token, TranslationResponse } from '../../shared/types';

const bridge = vi.hoisted(() => ({
  kvStore: {
    kvGet: vi.fn<(key: string) => Promise<string | null>>(),
    kvSet: vi.fn<(key: string, value: string) => Promise<void>>(),
    kvRemove: vi.fn<(key: string) => Promise<void>>(),
  },
  files: {
    removeLegacyLanguageData: vi.fn<(paths: string[]) => Promise<void>>(),
  },
}));

vi.mock('@shared/bridges', () => ({ getBridge: () => bridge }));

const languageData: LanguageDataMap = {
  zh: { name: 'Mandarin Chinese', legacyCodes: ['zh-Hans', 'zh-Hant'] },
};

function session(id: string, updatedAt: number): ConversationSession {
  return { id, title: id, agentId: null, messages: [], llmHistory: [], createdAt: updatedAt, updatedAt, messageCount: 0 };
}

async function loadCleanup() {
  vi.resetModules();
  return import('./zhVariantCleanup');
}

describe('runZhVariantCleanup', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', indexedDB);
    bridge.kvStore.kvGet.mockReset();
    bridge.kvStore.kvSet.mockReset().mockResolvedValue(undefined);
    bridge.kvStore.kvRemove.mockReset().mockResolvedValue(undefined);
    bridge.files.removeLegacyLanguageData.mockReset().mockResolvedValue(undefined);
  });

  it('cleans legacy language data without a flashcard migration', async () => {
    bridge.kvStore.kvGet.mockResolvedValue(null);
    const { runZhVariantCleanup } = await loadCleanup();

    await expect(runZhVariantCleanup(languageData)).resolves.toBe(true);

    expect(bridge.files.removeLegacyLanguageData).toHaveBeenCalledWith([
      'languages/zh-Hans.json',
      'languages/zh-Hans.freq.json',
      'languages/zh-Hant.json',
      'languages/zh-Hant.freq.json',
      'dictionaries/zh-Hans',
      'dictionaries/zh-Hant',
    ]);
  });

  it('merges legacy sessions chronologically and deletes their keys', async () => {
    bridge.kvStore.kvGet.mockImplementation(async (key) => ({
      'zh-variant-merge-v1-done': null,
      'conversation-sessions-zh': JSON.stringify([session('canonical', 25)]),
      'conversation-sessions-zh-Hans': JSON.stringify([session('late', 30)]),
      'conversation-sessions-zh-Hant': JSON.stringify([session('early', 10), session('middle', 20)]),
    }[key] ?? null));
    const { runZhVariantCleanup } = await loadCleanup();

    await expect(runZhVariantCleanup(languageData)).resolves.toBe(true);

    expect(bridge.kvStore.kvSet).toHaveBeenCalledWith(
      'conversation-sessions-zh',
      JSON.stringify([session('early', 10), session('middle', 20), session('canonical', 25), session('late', 30)]),
    );
    expect(bridge.kvStore.kvRemove).toHaveBeenCalledWith('conversation-sessions-zh-Hans');
    expect(bridge.kvStore.kvRemove).toHaveBeenCalledWith('conversation-sessions-zh-Hant');
  });

  it('is a no-op on its second run after setting the marker', async () => {
    const values = new Map<string, string>();
    bridge.kvStore.kvGet.mockImplementation(async (key) => values.get(key) ?? null);
    bridge.kvStore.kvSet.mockImplementation(async (key, value) => { values.set(key, value); });
    const { runZhVariantCleanup } = await loadCleanup();

    await expect(runZhVariantCleanup(languageData)).resolves.toBe(true);
    vi.clearAllMocks();
    await expect(runZhVariantCleanup(languageData)).resolves.toBe(false);

    expect(bridge.kvStore.kvSet).not.toHaveBeenCalled();
    expect(bridge.kvStore.kvRemove).not.toHaveBeenCalled();
    expect(bridge.files.removeLegacyLanguageData).not.toHaveBeenCalled();
  });

  it('does not duplicate sessions when retrying after partial cleanup', async () => {
    const values = new Map<string, string>([
      ['conversation-sessions-zh-Hans', JSON.stringify([session('preserved', 10)])],
    ]);
    let failLegacyRemoval = true;
    bridge.kvStore.kvGet.mockImplementation(async (key) => values.get(key) ?? null);
    bridge.kvStore.kvSet.mockImplementation(async (key, value) => { values.set(key, value); });
    bridge.kvStore.kvRemove.mockImplementation(async (key) => {
      if (key === 'conversation-sessions-zh-Hans' && failLegacyRemoval) {
        failLegacyRemoval = false;
        throw new Error('simulated removal failure');
      }
      values.delete(key);
    });
    const { runZhVariantCleanup } = await loadCleanup();

    await expect(runZhVariantCleanup(languageData)).rejects.toThrow('simulated removal failure');
    await expect(runZhVariantCleanup(languageData)).resolves.toBe(true);

    expect(values.get('conversation-sessions-zh')).toBe(JSON.stringify([session('preserved', 10)]));
  });

  it('preserves source data when a session payload is malformed', async () => {
    bridge.kvStore.kvGet.mockImplementation(async (key) => (
      key === 'conversation-sessions-zh-Hant' ? '{invalid-json' : null
    ));
    const { runZhVariantCleanup } = await loadCleanup();

    await expect(runZhVariantCleanup(languageData)).rejects.toThrow('conversation-sessions-zh-Hant');

    expect(bridge.kvStore.kvSet).not.toHaveBeenCalled();
    expect(bridge.kvStore.kvRemove).not.toHaveBeenCalled();
    expect(bridge.files.removeLegacyLanguageData).not.toHaveBeenCalled();
  });

  it('serializes overlapping cleanup attempts', async () => {
    let resolveMarker!: (value: string | null) => void;
    bridge.kvStore.kvGet.mockImplementation((key) => (
      key === 'zh-variant-merge-v1-done'
        ? new Promise((resolve) => { resolveMarker = resolve; })
        : Promise.resolve(null)
    ));
    const { runZhVariantCleanup } = await loadCleanup();

    const first = runZhVariantCleanup(languageData);
    const second = runZhVariantCleanup(languageData);
    resolveMarker(null);
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    expect(bridge.files.removeLegacyLanguageData).toHaveBeenCalledTimes(1);
  });

  it('invalidates only caches scoped to legacy language codes', async () => {
    const cache = await import('./offlineCache');
    const translation = { data: [{ definitions: 'test', reading: 'test' }] } as TranslationResponse;
    const tokens = [{ word: 'test', actual_word: 'test', type: 'NOUN' }] as Token[];
    const dictionary = [{ word: 'hans' }] as DictionaryEntry[];
    await cache.setCachedTranslationByLanguageDB('hans', translation, 'zh-Hans', 'en');
    await cache.setCachedTranslationByLanguageDB('japanese', translation, 'ja', 'en');
    await cache.setCachedDictionaryByLanguageDB('hans', 'hans', dictionary, 'zh-Hans', 'en');
    await cache.setCachedDictionaryByLanguageDB('japanese', 'japanese', dictionary, 'ja', 'en');
    await cache.setCachedTokensByLanguageDB('hant', tokens, 'zh-Hant');
    await cache.setCachedTokensByLanguageDB('japanese', tokens, 'ja');
    bridge.kvStore.kvGet.mockImplementation(async (key) => key === 'zh-variant-merge-v1-done' ? null : null);
    const { runZhVariantCleanup } = await loadCleanup();

    await runZhVariantCleanup(languageData);

    expect(await cache.getCachedTranslationByLanguageDB('hans', 'zh-Hans', 'en')).toBeNull();
    expect(await cache.getCachedTranslationByLanguageDB('japanese', 'ja', 'en')).toEqual(translation);
    expect(await cache.getCachedDictionaryByLanguageDB('hans', 'hans', 'zh-Hans', 'en')).toBeNull();
    expect(await cache.getCachedDictionaryByLanguageDB('japanese', 'japanese', 'ja', 'en')).toEqual(dictionary);
    expect(await cache.getCachedTokensByLanguageDB('hant', 'zh-Hant')).toBeNull();
    expect(await cache.getCachedTokensByLanguageDB('japanese', 'ja')).toEqual(tokens);
  });

  it('refuses cleanup until canonical language metadata is available', async () => {
    bridge.kvStore.kvGet.mockResolvedValue(null);
    const { runZhVariantCleanup } = await loadCleanup();

    await expect(runZhVariantCleanup({})).resolves.toBe(false);

    expect(bridge.kvStore.kvGet).not.toHaveBeenCalled();
    expect(bridge.kvStore.kvSet).not.toHaveBeenCalled();
    expect(bridge.kvStore.kvRemove).not.toHaveBeenCalled();
    expect(bridge.files.removeLegacyLanguageData).not.toHaveBeenCalled();
  });
});
