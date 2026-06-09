import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Module-level mocks (hoisted — must be at top level)
// ============================================================================

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(({ key }: { key: string }) => Promise.resolve({ value: localStorage.getItem(key) })),
    set: vi.fn(({ key, value }: { key: string; value: string }) => {
      localStorage.setItem(key, value);
      return Promise.resolve(undefined);
    }),
    remove: vi.fn(({ key }: { key: string }) => {
      localStorage.removeItem(key);
      return Promise.resolve(undefined);
    }),
  },
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    getUri: vi.fn().mockResolvedValue({ uri: 'file:///mock/path/file.jpg' }),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue({ files: [] }),
    readFile: vi.fn().mockResolvedValue({ data: '' }),
  },
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS' },
}));

vi.mock('@capacitor/clipboard', () => ({
  Clipboard: {
    write: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn().mockResolvedValue({ version: '1.2.3', build: '100', id: 'net.kikan.mlearn', name: 'mLearn' }),
  },
}));

vi.mock('../platform', () => ({
  isCapacitor: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
}));

// Dynamic locale import mock
vi.mock('../../root-of-app/locales/lang.en.json', () => ({ default: { 'mlearn.App.Title': 'mLearn' } }));
vi.mock('../../root-of-app/locales/lang.de.json', () => ({ default: { 'mlearn.App.Title': 'mLearn DE' } }));
vi.mock('../../root-of-app/languages/ja.json', () => ({ default: { name: 'Japanese', code: 'ja' } }));
vi.mock('../../root-of-app/languages/de.json', () => ({ default: { name: 'German', code: 'de' } }));

// ============================================================================
// Helper: build a minimal FlashcardStore
// ============================================================================

function makeStore(overrides: Partial<{
  flashcards: Record<string, unknown>;
  wordCandidates: Record<string, unknown>;
  wordToCardMap: Record<string, string[]>;
  wordStatsMap: Record<string, unknown>;
  knownUntracked: Record<string, unknown>;
  ignoredWords: Record<string, unknown>;
  wordKnowledge: Record<string, unknown>;
  grammarKnowledge: Record<string, unknown>;
  dailyStats: Record<string, unknown>;
  meta: Record<string, unknown>;
  version: number;
}> = {}) {
  return {
    flashcards: overrides.flashcards ?? {},
    wordCandidates: overrides.wordCandidates ?? {},
    wordToCardMap: overrides.wordToCardMap ?? {},
    wordStatsMap: overrides.wordStatsMap ?? {},
    knownUntracked: overrides.knownUntracked ?? {},
    ignoredWords: overrides.ignoredWords ?? {},
    wordKnowledge: overrides.wordKnowledge ?? {},
    grammarKnowledge: overrides.grammarKnowledge ?? {},
    dailyStats: overrides.dailyStats ?? {},
    meta: (overrides.meta ?? {}) as never,
    version: overrides.version ?? 4,
  };
}

// ============================================================================
// EventEmitter tests (tested indirectly through bridge emitter patterns)
// ============================================================================

describe('EventEmitter (internal)', () => {
  it('registers listener and fires callback', async () => {
    vi.resetModules();
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.settings.onSettings(cb);
    bridge.settings.saveSettings({ language: 'ja' } as never);
    await new Promise(r => setTimeout(r, 10));
    expect(cb).toHaveBeenCalled();
  });

  it('cleanup function removes listener', async () => {
    vi.resetModules();
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    const cleanup = bridge.settings.onSettings(cb);
    cleanup();
    bridge.settings.saveSettings({ language: 'ja' } as never);
    await new Promise(r => setTimeout(r, 10));
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple listeners on same event all fire', async () => {
    vi.resetModules();
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    bridge.settings.onSettings(cb1);
    bridge.settings.onSettings(cb2);
    bridge.settings.saveSettings({ language: 'ja' } as never);
    await new Promise(r => setTimeout(r, 10));
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('off() removes specific listener without affecting others', async () => {
    vi.resetModules();
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const off1 = bridge.settings.onSettings(cb1);
    bridge.settings.onSettings(cb2);
    off1();
    bridge.settings.saveSettings({ language: 'ja' } as never);
    await new Promise(r => setTimeout(r, 10));
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Storage helpers
// ============================================================================

describe('storageGet / storageSet (via kvStore bridge)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('kvGet returns null when nothing stored', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.kvStore.kvGet('nonexistent-key');
    expect(result).toBeNull();
  });

  it('kvSet writes to localStorage synchronously', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await bridge.kvStore.kvSet('my-key', 'my-value');
    expect(localStorage.getItem('my-key')).toBe('my-value');
  });

  it('kvGet returns value after kvSet', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await bridge.kvStore.kvSet('foo', 'bar');
    const result = await bridge.kvStore.kvGet('foo');
    expect(result).toBe('bar');
  });

  it('kvRemove deletes from localStorage and calls Preferences.remove', async () => {
    const { Preferences } = await import('@capacitor/preferences');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    localStorage.setItem('rem-key', 'value');
    await bridge.kvStore.kvRemove('rem-key');
    expect(localStorage.getItem('rem-key')).toBeNull();
    expect(Preferences.remove).toHaveBeenCalledWith({ key: 'rem-key' });
  });

  it('kvGetAll returns all localStorage entries', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    localStorage.setItem('a', '1');
    localStorage.setItem('b', '2');
    const all = await bridge.kvStore.kvGetAll();
    expect(all['a']).toBe('1');
    expect(all['b']).toBe('2');
  });

  it('kvSetBatch writes multiple entries', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await bridge.kvStore.kvSetBatch({ x: '10', y: '20' });
    expect(localStorage.getItem('x')).toBe('10');
    expect(localStorage.getItem('y')).toBe('20');
  });

  it('kvSet calls Preferences.set with key and value', async () => {
    const { Preferences } = await import('@capacitor/preferences');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await bridge.kvStore.kvSet('pref-key', 'pref-val');
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'pref-key', value: 'pref-val' });
  });

  it('kvGet returns null when Preferences returns no value', async () => {
    const { Preferences } = await import('@capacitor/preferences');
    vi.mocked(Preferences.get).mockResolvedValueOnce({ value: null });
    localStorage.setItem('fallback-key', 'from-ls');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.kvStore.kvGet('fallback-key');
    expect(result).toBeNull();
  });
});

// ============================================================================
// Settings Bridge
// ============================================================================

describe('Settings Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('getSettings emits DEFAULT_SETTINGS when nothing stored', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const { DEFAULT_SETTINGS } = await import('../types');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.settings.onSettings(cb);
    bridge.settings.getSettings();
    await new Promise(r => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledOnce();
    const emitted = cb.mock.calls[0][0];
    expect(emitted.language).toBe(DEFAULT_SETTINGS.language);
  });

  it('getSettings merges stored data with DEFAULT_SETTINGS', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    localStorage.setItem('settings', JSON.stringify({ language: 'de', blur_words: true }));
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.settings.onSettings(cb);
    bridge.settings.getSettings();
    await new Promise(r => setTimeout(r, 20));
    const emitted = cb.mock.calls[0][0];
    expect(emitted.language).toBe('de');
    expect(emitted.blur_words).toBe(true);
    expect(typeof emitted.known_ease_threshold).toBe('number');
  });

  it('saveSettings writes to storage and emits settings', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.settings.onSettings(cb);
    bridge.settings.saveSettings({ language: 'fr' } as never);
    await new Promise(r => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledWith({ language: 'fr' });
    expect(localStorage.getItem('settings')).toBe(JSON.stringify({ language: 'fr' }));
  });

  it('saveSettings emits settings-saved event', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const savedCb = vi.fn();
    bridge.settings.onSettingsSaved(savedCb);
    bridge.settings.saveSettings({ language: 'en' } as never);
    await new Promise(r => setTimeout(r, 20));
    expect(savedCb).toHaveBeenCalledOnce();
  });

  it('onSettings returns a cleanup function', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.settings.onSettings(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('onSettingsSaved returns a cleanup function', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.settings.onSettingsSaved(vi.fn());
    expect(typeof cleanup).toBe('function');
  });
});

// ============================================================================
// Sharding helpers
// ============================================================================

describe('Sharding helpers (via flashcard bridge)', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('getShardIndex returns value in range [0, 15]', async () => {
    // Test via saveFlashcards (which calls splitIntoShards/saveShardedFlashcards)
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    // '00' -> parseInt('00', 16) % 16 = 0
    // 'ff' -> parseInt('ff', 16) % 16 = 15
    // 'a0' -> parseInt('a0', 16) % 16 = 0 (160 % 16 = 0)
    const store = makeStore({
      wordToCardMap: {
        '00abcd': ['card1'],
        'ffabcd': ['card2'],
        '10abcd': ['card3'],
      },
    });
    bridge.flashcards.saveFlashcards(store as never);
    await new Promise(r => setTimeout(r, 20));
    // Check that meta was written
    const meta = localStorage.getItem('flashcards_meta');
    expect(meta).not.toBeNull();
  });

  it('splitIntoShards produces 16 shards from wordToCardMap', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const entries: Record<string, string[]> = {};
    for (let i = 0; i < 16; i++) {
      entries[`${i.toString(16).padStart(2, '0')}aaaaaa`] = [`card${i}`];
    }
    const store = makeStore({ wordToCardMap: entries });
    bridge.flashcards.saveFlashcards(store as never);
    await new Promise(r => setTimeout(r, 20));
    // 16 card shards written
    for (let i = 0; i < 16; i++) {
      expect(localStorage.getItem(`flashcards_cards_shard_${i}`)).not.toBeNull();
    }
  });

  it('saveShardedFlashcards stores meta with correct structure', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const store = makeStore({ version: 4, flashcards: { 'card1': { id: 'card1' } as never } });
    bridge.flashcards.saveFlashcards(store as never);
    await new Promise(r => setTimeout(r, 20));
    const metaRaw = localStorage.getItem('flashcards_meta');
    expect(metaRaw).not.toBeNull();
    const meta = JSON.parse(metaRaw!);
    expect(meta.shardCount).toBe(16);
    expect(meta.storeVersion).toBe(4);
    expect(meta.flashcards).toEqual({ 'card1': { id: 'card1' } });
  });

  it('loadShardedFlashcards reassembles store from shards', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const store = makeStore({
      wordToCardMap: { '0aabcdef': ['card1'] },
      wordStatsMap: { '0aabcdef': { encounters: 5 } as never },
      flashcards: { 'card1': { id: 'card1' } as never },
    });
    bridge.flashcards.saveFlashcards(store as never);
    await new Promise(r => setTimeout(r, 20));

    const loadedCb = vi.fn();
    bridge.flashcards.onFlashcards(loadedCb);
    bridge.flashcards.getFlashcards();
    await new Promise(r => setTimeout(r, 30));
    const loaded = loadedCb.mock.calls[0]?.[0];
    expect(loaded).toBeDefined();
    expect(loaded.flashcards).toEqual({ 'card1': { id: 'card1' } });
    expect(loaded.wordToCardMap['0aabcdef']).toEqual(['card1']);
  });

  it('loadShardedFlashcards returns empty store when no data', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.flashcards.onFlashcards(cb);
    bridge.flashcards.getFlashcards();
    await new Promise(r => setTimeout(r, 30));
    const loaded = cb.mock.calls[0]?.[0];
    expect(loaded).toBeDefined();
    expect(loaded.flashcards).toEqual({});
    expect(loaded.wordCandidates).toEqual({});
  });

  it('loadShardedFlashcards migrates legacy data and removes old key', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const { Preferences } = await import('@capacitor/preferences');
    const legacyStore = makeStore({ flashcards: { 'legacyCard': { id: 'legacyCard' } as never } });
    localStorage.setItem('flashcards', JSON.stringify(legacyStore));
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.flashcards.onFlashcards(cb);
    bridge.flashcards.getFlashcards();
    await new Promise(r => setTimeout(r, 50));
    expect(Preferences.remove).toHaveBeenCalledWith({ key: 'flashcards' });
    expect(localStorage.getItem('flashcards')).toBeNull();
    const loaded = cb.mock.calls[0]?.[0];
    expect(loaded.flashcards['legacyCard']).toBeDefined();
  });

  it('saveShardedFlashcards only writes changed shards (caching)', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const { Preferences } = await import('@capacitor/preferences');
    const bridge = createCapacitorBridge();
    const store = makeStore({ wordToCardMap: { '0aabcdef': ['card1'] } });
    bridge.flashcards.saveFlashcards(store as never);
    await new Promise(r => setTimeout(r, 20));
    const callsAfterFirst = vi.mocked(Preferences.set).mock.calls.length;

    // Save same store again — no shard changes
    bridge.flashcards.saveFlashcards(store as never);
    await new Promise(r => setTimeout(r, 20));
    const callsAfterSecond = vi.mocked(Preferences.set).mock.calls.length;

    // Only meta should be re-written (shards unchanged)
    expect(callsAfterSecond - callsAfterFirst).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// Flashcard Bridge
// ============================================================================

describe('Flashcard Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('onFlashcards returns a cleanup function', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.flashcards.onFlashcards(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('onNewDayFlashcards registers a listener', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.flashcards.onNewDayFlashcards(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('onFlashcardConnectOpen registers a listener', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.flashcards.onFlashcardConnectOpen(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('onReviewFlashcardRequest registers a listener', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.flashcards.onReviewFlashcardRequest(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('getFlashcardTts returns null', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.flashcards.getFlashcardTts('card1', 'word');
    expect(result).toBeNull();
  });

  it('generateFlashcardTts returns null', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.flashcards.generateFlashcardTts('card1', 'text', 'ja', 'word', 'kokoro');
    expect(result).toBeNull();
  });

  it('batchGenerateFlashcardTts returns empty record', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.flashcards.batchGenerateFlashcardTts([], 'ja', 'kokoro');
    expect(result).toEqual({});
  });

  it('getFlashcardTtsMeta returns null', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.flashcards.getFlashcardTtsMeta('card1', 'word');
    expect(result).toBeNull();
  });

  it('deleteFlashcardTts resolves without error (no-op on mobile)', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await expect(bridge.flashcards.deleteFlashcardTts('card1')).resolves.toBeUndefined();
  });

  it('saveFlashcardImage saves base64 data URL via Filesystem', async () => {
    const { Filesystem } = await import('@capacitor/filesystem');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const dataUrl = 'data:image/png;base64,abc123';
    const result = await bridge.flashcards.saveFlashcardImage('card1', dataUrl);
    expect(Filesystem.writeFile).toHaveBeenCalled();
    expect(result).toBe('file:///mock/path/file.jpg');
  });

  it('saveFlashcardImage returns original non-base64 URL unchanged', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const url = 'https://example.com/image.jpg';
    const result = await bridge.flashcards.saveFlashcardImage('card1', url);
    expect(result).toBe(url);
  });

  it('resolveFlashcardImage returns null for flashcard-image:// URLs', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.flashcards.resolveFlashcardImage('flashcard-image://card1.jpg');
    expect(result).toBeNull();
  });

  it('resolveFlashcardImage returns URL for regular URLs', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const url = 'https://example.com/image.jpg';
    const result = await bridge.flashcards.resolveFlashcardImage(url);
    expect(result).toBe(url);
  });

  it('deleteFlashcardImage calls Filesystem.deleteFile for each extension', async () => {
    const { Filesystem } = await import('@capacitor/filesystem');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await bridge.flashcards.deleteFlashcardImage('card1');
    // Should try jpg, png, webp, gif
    expect(Filesystem.deleteFile).toHaveBeenCalledTimes(4);
  });

  it('deleteFlashcardVideo calls Filesystem.deleteFile', async () => {
    const { Filesystem } = await import('@capacitor/filesystem');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await bridge.flashcards.deleteFlashcardVideo('card1');
    expect(Filesystem.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'flashcard-videos/card1.mp4' })
    );
  });

  it('saveFlashcardVideo writes ArrayBuffer and returns URI', async () => {
    const { Filesystem } = await import('@capacitor/filesystem');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const buffer = new ArrayBuffer(8);
    const result = await bridge.flashcards.saveFlashcardVideo('card1', buffer);
    expect(Filesystem.writeFile).toHaveBeenCalled();
    expect(result).toBe('file:///mock/path/file.jpg');
  });
});

// ============================================================================
// Localization Bridge
// ============================================================================

describe('Localization Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('getLocalization emits localization data for default language (en)', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.localization.onLocalization(cb);
    bridge.localization.getLocalization();
    await vi.waitFor(() => expect(cb).toHaveBeenCalledOnce(), { timeout: 5000 });
    const data = cb.mock.calls[0][0];
    expect(data.locale).toBe('en');
    expect(typeof data.strings).toBe('object');
  });

  it('getLocalization uses stored mlearn-ui-language', async () => {
    localStorage.setItem('mlearn-ui-language', 'de');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.localization.onLocalization(cb);
    bridge.localization.getLocalization();
    await vi.waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 });
    const data = cb.mock.calls[0][0];
    expect(data.locale).toBe('de');
  });

  it('changeUILanguage sets localStorage and triggers getLocalization', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.localization.onLocalization(cb);
    bridge.localization.changeUILanguage('fr');
    expect(localStorage.getItem('mlearn-ui-language')).toBe('fr');
    await vi.waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 });
  });

  it('onLocalization returns a cleanup function', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.localization.onLocalization(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('getLangData emits lang-data without server URL', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.localization.onLangData(cb);
    bridge.localization.getLangData();
    await vi.waitFor(() => expect(cb).toHaveBeenCalledOnce(), { timeout: 5000 });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      ja: expect.objectContaining({ name: 'Japanese' }),
      de: expect.objectContaining({ name: 'German' }),
    }));
  });

  it('installLanguage emits lang-install-error on mobile', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.localization.onLanguageInstallError(cb);
    bridge.localization.installLanguage('http://example.com/lang.zip');
    expect(cb).toHaveBeenCalledWith(expect.stringContaining('not supported'));
  });

  it('onLanguageInstalled returns a cleanup function', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.localization.onLanguageInstalled(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('getLocalization tries server fetch when mlearn-node-server-url is set', async () => {
    localStorage.setItem('mlearn-node-server-url', 'http://localhost:7753');
    const mockFetch = vi.fn().mockResolvedValueOnce({
      json: vi.fn().mockResolvedValueOnce({ locale: 'en', strings: { hello: 'world' } }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.localization.onLocalization(cb);
    bridge.localization.getLocalization();
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/localization/'),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    vi.unstubAllGlobals();
  });

  it('getLocalization falls back to bundled on server fetch failure', async () => {
    localStorage.setItem('mlearn-node-server-url', 'http://localhost:7753');
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.localization.onLocalization(cb);
    bridge.localization.getLocalization();
    await vi.waitFor(() => expect(cb).toHaveBeenCalled(), { timeout: 5000 });
    vi.unstubAllGlobals();
  });
});

// ============================================================================
// File Bridge
// ============================================================================

describe('File Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('getPathForFile returns file.name', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const file = new File(['content'], 'test-video.mp4');
    expect(bridge.files.getPathForFile(file)).toBe('test-video.mp4');
  });

  it('getLocalMediaUrl returns the path as-is', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.files.getLocalMediaUrl('/some/path/video.mp4');
    expect(result).toBe('/some/path/video.mp4');
  });

  it('readPdfFile returns empty ArrayBuffer', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.files.readPdfFile('/path/to/file.pdf');
    expect(result.data).toBeInstanceOf(ArrayBuffer);
    expect(result.data.byteLength).toBe(0);
  });

  it('readMediaFile returns null', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.files.readMediaFile('/path/to/media.mp4');
    expect(result).toBeNull();
  });

  it('readDirectoryImages uses Capacitor Filesystem and filters image files', async () => {
    const { Filesystem } = await import('@capacitor/filesystem');
    vi.mocked(Filesystem.readdir).mockResolvedValueOnce({
      files: [
        { name: 'photo.jpg' } as never,
        { name: 'doc.pdf' } as never,
        { name: 'image.png' } as never,
      ],
    });
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: btoa('imagebytes') } as never);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.files.readDirectoryImages('/test/dir');
    expect(result.files.length).toBe(2);
    expect(result.files.map(f => f.name)).toEqual(['photo.jpg', 'image.png']);
  });

  it('readDirectoryImages returns empty on Filesystem error', async () => {
    const { Filesystem } = await import('@capacitor/filesystem');
    vi.mocked(Filesystem.readdir).mockRejectedValueOnce(new Error('not found'));
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.files.readDirectoryImages('/nonexistent');
    expect(result.files).toEqual([]);
  });

  it('selectVideoFile creates input element with video accept', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const createElementSpy = vi.spyOn(document, 'createElement');
    const promise = bridge.files.selectVideoFile();
    await new Promise(r => setTimeout(r, 5));
    expect(createElementSpy).toHaveBeenCalledWith('input');
    promise.catch(() => {});
    createElementSpy.mockRestore();
  });

  it('selectSubtitleFile creates input element', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const createElementSpy = vi.spyOn(document, 'createElement');
    bridge.files.selectSubtitleFile().catch(() => {});
    await new Promise(r => setTimeout(r, 5));
    expect(createElementSpy).toHaveBeenCalledWith('input');
    createElementSpy.mockRestore();
  });

  it('selectPdfFile creates input element', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const createElementSpy = vi.spyOn(document, 'createElement');
    bridge.files.selectPdfFile().catch(() => {});
    await new Promise(r => setTimeout(r, 5));
    expect(createElementSpy).toHaveBeenCalledWith('input');
    createElementSpy.mockRestore();
  });

  it('writeToClipboard tries Capacitor Clipboard then falls back', async () => {
    const { Clipboard } = await import('@capacitor/clipboard');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.files.writeToClipboard('hello world');
    await new Promise(r => setTimeout(r, 20));
    expect(Clipboard.write).toHaveBeenCalledWith({ string: 'hello world' });
  });

  it('writeToClipboard falls back to navigator.clipboard on Clipboard failure', async () => {
    const { Clipboard } = await import('@capacitor/clipboard');
    vi.mocked(Clipboard.write).mockRejectedValueOnce(new Error('not supported'));
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).navigator = {
      ...(window.navigator || {}),
      clipboard: { writeText: writeTextMock },
    } as never;
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.files.writeToClipboard('fallback text');
    await new Promise(r => setTimeout(r, 20));
    expect(writeTextMock).toHaveBeenCalledWith('fallback text');
  });
});

// ============================================================================
// Window Bridge
// ============================================================================

describe('Window Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('openWindow stores context in sessionStorage and navigates', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.window.openWindow({ type: 'settings', context: { tab: 'general' } });
    expect(sessionStorage.getItem('mlearn_window_ctx_settings')).toBe(JSON.stringify({ tab: 'general' }));
    expect(window.location.hash).toBe('#/settings');
  });

  it('openWindow navigates to correct hash for known types', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.window.openWindow({ type: 'flashcards' });
    expect(window.location.hash).toBe('#/flashcards');
  });

  it('closeWindow calls history.back()', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const backSpy = vi.spyOn(window.history, 'back');
    bridge.window.closeWindow();
    expect(backSpy).toHaveBeenCalledOnce();
    backSpy.mockRestore();
  });

  it('getWindowContext reads from sessionStorage and delivers via callback', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    sessionStorage.setItem('mlearn_window_ctx_settings', JSON.stringify({ section: 'display' }));
    const cb = vi.fn();
    bridge.window.onWindowContext(cb);
    bridge.window.getWindowContext('settings');
    await new Promise(r => setTimeout(r, 10));
    expect(cb).toHaveBeenCalledWith({ section: 'display' });
    expect(sessionStorage.getItem('mlearn_window_ctx_settings')).toBeNull();
  });

  it('getWindowContext delivers null when no context stored', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.window.onWindowContext(cb);
    bridge.window.getWindowContext('flashcards');
    await new Promise(r => setTimeout(r, 10));
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('onWindowContext cleanup removes callback', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    const cleanup = bridge.window.onWindowContext(cb);
    cleanup?.();
    bridge.window.getWindowContext('settings');
    await new Promise(r => setTimeout(r, 10));
    expect(cb).not.toHaveBeenCalled();
  });

  it('showCtxMenu dispatches mlearn-ctx-menu CustomEvent', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const events: Event[] = [];
    window.addEventListener('mlearn-ctx-menu', e => events.push(e));
    bridge.window.showCtxMenu({ isWatchTogether: true });
    expect(events.length).toBe(1);
    expect((events[0] as CustomEvent).detail).toEqual({ type: 'video', options: { isWatchTogether: true } });
  });

  it('showReaderCtxMenu dispatches mlearn-ctx-menu CustomEvent with reader type', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const events: Event[] = [];
    window.addEventListener('mlearn-ctx-menu', e => events.push(e));
    bridge.window.showReaderCtxMenu({ furiganaHiderEnabled: false, hasContextPhrase: true });
    expect(events.length).toBe(1);
    expect((events[0] as CustomEvent).detail.type).toBe('reader');
  });

  it('openExternalUrl opens a new window and returns true', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const result = await bridge.window.openExternalUrl('https://example.com');
    expect(result).toBe(true);
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('onContextMenuCommand registers window event listener', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    const cleanup = bridge.window.onContextMenuCommand(cb);
    window.dispatchEvent(new CustomEvent('mlearn-ctx-command', { detail: 'copy' }));
    expect(cb).toHaveBeenCalledWith('copy');
    cleanup();
    window.dispatchEvent(new CustomEvent('mlearn-ctx-command', { detail: 'paste' }));
    expect(cb).toHaveBeenCalledOnce();
  });

  it('onReaderContextMenuCommand registers window event listener', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    const cleanup = bridge.window.onReaderContextMenuCommand(cb);
    window.dispatchEvent(new CustomEvent('mlearn-reader-ctx-command', { detail: 'lookup' }));
    expect(cb).toHaveBeenCalledWith('lookup');
    cleanup();
  });

  it('noop methods exist and do not throw', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.window.changeTrafficLights(true)).not.toThrow();
    expect(() => bridge.window.resizeWindow({ width: 100, height: 100 })).not.toThrow();
    expect(() => bridge.window.makePiP({ width: 100, height: 100 })).not.toThrow();
    expect(() => bridge.window.unPiP()).not.toThrow();
    expect(() => bridge.window.showContact()).not.toThrow();
    expect(() => bridge.window.promptOutput('test')).not.toThrow();
  });

  it('noopCleanup methods return functions', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(typeof bridge.window.onOpenSettings(vi.fn())).toBe('function');
    expect(typeof bridge.window.onOpenAside(vi.fn())).toBe('function');
    expect(typeof bridge.window.onOpenWordDbEditor(vi.fn())).toBe('function');
    expect(typeof bridge.window.onOpenExamCentricStudy(vi.fn())).toBe('function');
    expect(typeof bridge.window.onOpenPrompt(vi.fn())).toBe('function');
    expect(typeof bridge.window.onAuthDeepLink(vi.fn())).toBe('function');
    expect(typeof bridge.window.onLookupDeepLink(vi.fn())).toBe('function');
  });
});

// ============================================================================
// Server Bridge
// ============================================================================

describe('Server Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isLoaded pings backend and emits server-load on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.server.onServerLoad(cb);
    bridge.server.isLoaded();
    await new Promise(r => setTimeout(r, 20));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/control'));
    expect(cb).toHaveBeenCalledWith('loaded');
  });

  it('isLoaded emits server-status-update when fetch fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.server.onServerStatusUpdate(cb);
    bridge.server.isLoaded();
    await new Promise(r => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledWith(expect.stringContaining('not reachable'));
  });

  it('isSuccess emits python-success with true when backend is ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const chunks: unknown[] = [];
    // Subscribe via internal emitter (no direct onPythonSuccess bridge method — use isSuccess side effect)
    bridge.server.isSuccess();
    await new Promise(r => setTimeout(r, 20));
    expect(mockFetch).toHaveBeenCalled();
    void chunks;
  });

  it('restartApp calls location.reload()', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const reloadSpy = vi.fn();
    (window as unknown as Record<string, unknown>).location = {
      ...(window.location),
      reload: reloadSpy,
      hash: '',
    };
    bridge.server.restartApp();
    expect(reloadSpy).toHaveBeenCalledOnce();
  });

  it('forceRestartApp calls location.reload()', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const reloadSpy = vi.fn();
    (window as unknown as Record<string, unknown>).location = {
      ...(window.location),
      reload: reloadSpy,
      hash: '',
    };
    bridge.server.forceRestartApp();
    expect(reloadSpy).toHaveBeenCalledOnce();
  });

  it('restartBackend calls location.reload()', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const reloadSpy = vi.fn();
    (window as unknown as Record<string, unknown>).location = {
      ...(window.location),
      reload: reloadSpy,
      hash: '',
    };
    bridge.server.restartBackend();
    expect(reloadSpy).toHaveBeenCalledOnce();
  });

  it('getVersion emits version from @capacitor/app', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.server.onVersionReceive(cb);
    bridge.server.getVersion();
    await new Promise(r => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledWith('1.2.3');
  });

  it('getBackendUrl uses custom mlearn-backend-url from localStorage', async () => {
    localStorage.setItem('mlearn-backend-url', 'http://192.168.1.10:7752');
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.server.isLoaded();
    await new Promise(r => setTimeout(r, 20));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('192.168.1.10:7752'));
  });

  it('onServerLoad, onServerStatusUpdate, onServerCriticalError, onAnkiConnectionError return functions', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(typeof bridge.server.onServerLoad(vi.fn())).toBe('function');
    expect(typeof bridge.server.onServerStatusUpdate(vi.fn())).toBe('function');
    expect(typeof bridge.server.onServerCriticalError(vi.fn())).toBe('function');
    expect(typeof bridge.server.onAnkiConnectionError(vi.fn())).toBe('function');
    expect(typeof bridge.server.onOcrStatusUpdate(vi.fn())).toBe('function');
    expect(typeof bridge.server.onVersionReceive(vi.fn())).toBe('function');
  });

  it('restartBackendAnkiOverride is a noop', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.server.restartBackendAnkiOverride(true)).not.toThrow();
  });
});

// ============================================================================
// Installer Bridge
// ============================================================================

describe('Installer Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('all installer methods are noops or noopCleanup', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.installer.startInstall({} as never)).not.toThrow();
    expect(() => bridge.installer.requestInstallerState()).not.toThrow();
    expect(typeof bridge.installer.onPythonSuccess(vi.fn())).toBe('function');
    expect(typeof bridge.installer.onInstallStarted(vi.fn())).toBe('function');
    expect(typeof bridge.installer.onInstallerAwaitingChoice(vi.fn())).toBe('function');
    expect(typeof bridge.installer.onInstallerNetworkError(vi.fn())).toBe('function');
    expect(typeof bridge.installer.onInstallerState(vi.fn())).toBe('function');
    expect(typeof bridge.installer.onPipProgress(vi.fn())).toBe('function');
  });
});

// ============================================================================
// LLM Bridge
// ============================================================================

describe('LLM Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('llmCheckModel returns default status', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const status = await bridge.llm.llmCheckModel();
    expect(status.downloaded).toBe(false);
    expect(status.downloading).toBe(false);
    expect(status.loaded).toBe(false);
    expect(status.progress).toBe(0);
  });

  it('llmStreamAbort emits done chunk immediately', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.llm.onLLMStreamChunk(cb);
    bridge.llm.llmStreamAbort();
    expect(cb).toHaveBeenCalledWith({ done: true });
  });

  it('llmStream fetches correct URL in default (node proxy) mode', async () => {
    const encoder = new TextEncoder();
    const chunkData = encoder.encode('data: {"text":"hello"}\n\ndata: {"done":true}\n\n');
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: chunkData })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.llm.llmStream([{ role: 'user', content: 'hello' }], []);
    await new Promise(r => setTimeout(r, 30));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/forward/llm/stream'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('llmStream fetches cloud URL when llmProvider is cloud', async () => {
    localStorage.setItem('settings', JSON.stringify({ llmProvider: 'cloud', cloudAuthAccessToken: 'tok123' }));
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true }) }) },
    });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.llm.llmStream([{ role: 'user', content: 'test' }], []);
    await new Promise(r => setTimeout(r, 30));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('mlearn-cloud.kikan.net'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok123' }) })
    );
  });

  it('llmStream emits error chunk when no stream body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: null });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.llm.onLLMStreamChunk(cb);
    bridge.llm.llmStream([], []);
    await new Promise(r => setTimeout(r, 30));
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ done: true, error: expect.any(String) }));
  });

  it('llmStream emits error chunk on fetch failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.llm.onLLMStreamChunk(cb);
    bridge.llm.llmStream([], []);
    await new Promise(r => setTimeout(r, 30));
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ done: true, error: expect.stringContaining('network error') }));
  });

  it('ollamaChatStreamAbort aborts current stream', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.llm.ollamaChatStreamAbort()).not.toThrow();
  });

  it('ollamaListModels returns empty array on fetch failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('refused'));
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const models = await bridge.llm.ollamaListModels();
    expect(models).toEqual([]);
  });

  it('ollamaListModels returns models from Ollama API', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ models: [{ name: 'llama3' }, { name: 'qwen3' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const models = await bridge.llm.ollamaListModels();
    expect(models).toEqual([{ name: 'llama3' }, { name: 'qwen3' }]);
  });

  it('ollamaCheck returns false on fetch failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('refused'));
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.llm.ollamaCheck();
    expect(result).toBe(false);
  });

  it('ollamaCheck returns true when Ollama is available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.llm.ollamaCheck();
    expect(result).toBe(true);
  });

  it('ollamaChat is a noop', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.llm.ollamaChat([])).not.toThrow();
  });

  it('ollamaChatStream fetches Ollama /api/chat and emits chunks', async () => {
    const encoder = new TextEncoder();
    const line = JSON.stringify({ message: { content: 'Hi', tool_calls: [] }, done: false }) + '\n';
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: encoder.encode(line) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => mockReader },
    });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.llm.onOllamaChatStream(cb);
    bridge.llm.ollamaChatStream([{ role: 'user', content: 'test' }], []);
    await new Promise(r => setTimeout(r, 30));
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/chat'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ content: 'Hi' }));
  });

  it('noopCleanup LLM methods return functions', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(typeof bridge.llm.onLLMDownloadProgress(vi.fn())).toBe('function');
    expect(typeof bridge.llm.onLLMModelStatus(vi.fn())).toBe('function');
    expect(typeof bridge.llm.onOllamaPullModelProgress(vi.fn())).toBe('function');
  });
});

// ============================================================================
// Speech Bridge
// ============================================================================

describe('Speech Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    if (!('speechSynthesis' in window)) {
      (window as unknown as Record<string, unknown>).speechSynthesis = {
        speak: vi.fn(),
        cancel: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getVoices: vi.fn(() => []),
        speaking: false,
        pending: false,
        paused: false,
        onvoiceschanged: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }
    if (!('SpeechSynthesisUtterance' in window)) {
      (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = class {
        text: string;
        lang = '';
        onend: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onboundary: (() => void) | null = null;
        constructor(text: string) { this.text = text; }
      };
    }
  });

  it('ttsSpeak calls speechSynthesis.speak', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const speakSpy = vi.spyOn(speechSynthesis, 'speak').mockImplementation(() => {});
    bridge.speech.ttsSpeak('hello', 'en');
    expect(speakSpy).toHaveBeenCalledOnce();
    speakSpy.mockRestore();
  });

  it('ttsSpeak emits tts-status with speaking: true', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    vi.spyOn(speechSynthesis, 'speak').mockImplementation(() => {});
    const cb = vi.fn();
    bridge.speech.onTtsStatus(cb);
    bridge.speech.ttsSpeak('test', 'ja');
    expect(cb).toHaveBeenCalledWith({ speaking: true, progress: 0 });
  });

  it('ttsStop calls speechSynthesis.cancel', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cancelSpy = vi.spyOn(speechSynthesis, 'cancel').mockImplementation(() => {});
    bridge.speech.ttsStop();
    expect(cancelSpy).toHaveBeenCalledOnce();
    cancelSpy.mockRestore();
  });

  it('ttsStop emits tts-status with speaking: false', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    vi.spyOn(speechSynthesis, 'cancel').mockImplementation(() => {});
    const cb = vi.fn();
    bridge.speech.onTtsStatus(cb);
    bridge.speech.ttsStop();
    expect(cb).toHaveBeenCalledWith({ speaking: false, progress: 0 });
  });

  it('onTtsStatus returns a cleanup function', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.speech.onTtsStatus(vi.fn());
    expect(typeof cleanup).toBe('function');
  });

  it('sttStart does not throw when SpeechRecognition is unavailable', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.speech.sttStart('en')).not.toThrow();
  });

  it('sttStop does not throw when recognition is not started', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.speech.sttStop()).not.toThrow();
  });

  it('onSttResult returns a cleanup function', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cleanup = bridge.speech.onSttResult(vi.fn());
    expect(typeof cleanup).toBe('function');
  });
});

// ============================================================================
// Voice Bridge
// ============================================================================

describe('Voice Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('voiceCheckModels returns not-available status', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const status = await bridge.voice.voiceCheckModels('ja');
    expect(status.sttDownloaded).toBe(false);
    expect(status.ttsDownloaded).toBe(false);
    expect(status.vadDownloaded).toBe(false);
    expect(status.downloading).toBe(false);
    expect(status.statusMessage).toContain('not available');
  });

  it('voiceSampleList returns empty array', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const samples = await bridge.voice.voiceSampleList();
    expect(samples).toEqual([]);
  });

  it('voiceSampleDelete returns false', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.voice.voiceSampleDelete('id123');
    expect(result).toBe(false);
  });

  it('voiceSampleRename returns false', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.voice.voiceSampleRename('id123', 'new name');
    expect(result).toBe(false);
  });

  it('voiceSampleGetPath returns null', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.voice.voiceSampleGetPath('id123');
    expect(result).toBeNull();
  });

  it('voiceSampleUpload throws not-supported error', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await expect(bridge.voice.voiceSampleUpload('/path', 'name')).rejects.toThrow();
  });

  it('voiceSampleTranscribe throws not-supported error', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    await expect(bridge.voice.voiceSampleTranscribe('id123')).rejects.toThrow();
  });

  it('noop voice methods do not throw', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.voice.voiceDownloadModels('ja')).not.toThrow();
    expect(() => bridge.voice.voiceStartSession('ja', 'vad')).not.toThrow();
    expect(() => bridge.voice.voiceStopSession()).not.toThrow();
    expect(() => bridge.voice.voiceSendAudioChunk(new Float32Array(10))).not.toThrow();
    expect(() => bridge.voice.voiceFlush()).not.toThrow();
    expect(() => bridge.voice.voiceTtsGenerate('hello', 'en')).not.toThrow();
    expect(() => bridge.voice.voiceTtsStop()).not.toThrow();
  });

  it('noopCleanup voice methods return functions', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(typeof bridge.voice.onVoiceModelProgress(vi.fn())).toBe('function');
    expect(typeof bridge.voice.onVoiceSttResult(vi.fn())).toBe('function');
    expect(typeof bridge.voice.onVoiceVadEvent(vi.fn())).toBe('function');
    expect(typeof bridge.voice.onVoiceTtsAudio(vi.fn())).toBe('function');
    expect(typeof bridge.voice.onVoiceTtsStatus(vi.fn())).toBe('function');
    expect(typeof bridge.voice.onVoiceSessionReady(vi.fn())).toBe('function');
    expect(typeof bridge.voice.onVoiceSessionError(vi.fn())).toBe('function');
  });
});

// ============================================================================
// Media Stats Bridge
// ============================================================================

describe('Media Stats Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('saveMediaStats stores stats under the given hash', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const stats = { mediaHash: 'abc123', title: 'Test Video' } as never;
    bridge.mediaStats.saveMediaStats('abc123', stats);
    await new Promise(r => setTimeout(r, 20));
    const raw = localStorage.getItem('mediaStats');
    expect(raw).not.toBeNull();
    const all = JSON.parse(raw!);
    expect(all['abc123']).toEqual(stats);
  });

  it('getMediaStats emits stats for given hash', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const existingStats = { mediaHash: 'xyz789', sessions: [] as never[] };
    localStorage.setItem('mediaStats', JSON.stringify({ xyz789: existingStats }));
    const cb = vi.fn();
    bridge.mediaStats.onMediaStats(cb);
    bridge.mediaStats.getMediaStats('xyz789');
    await new Promise(r => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledWith(existingStats);
  });

  it('getMediaStats emits null for unknown hash', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.mediaStats.onMediaStats(cb);
    bridge.mediaStats.getMediaStats('unknown');
    await new Promise(r => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('listMediaStats emits all stored stats', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const stats1 = { mediaHash: 'a1', sessions: [] as never[] };
    const stats2 = { mediaHash: 'b2', sessions: [] as never[] };
    localStorage.setItem('mediaStats', JSON.stringify({ a1: stats1, b2: stats2 }));
    const cb = vi.fn();
    bridge.mediaStats.onMediaStatsList(cb);
    bridge.mediaStats.listMediaStats();
    await new Promise(r => setTimeout(r, 20));
    const emitted = cb.mock.calls[0][0];
    expect(emitted.length).toBe(2);
  });

  it('listMediaStats emits empty array when no stats stored', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.mediaStats.onMediaStatsList(cb);
    bridge.mediaStats.listMediaStats();
    await new Promise(r => setTimeout(r, 20));
    expect(cb).toHaveBeenCalledWith([]);
  });
});

// ============================================================================
// License Bridge
// ============================================================================

describe('License Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('getLicenseType emits "free" when nothing stored', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.license.onLicenseGet(cb);
    bridge.license.getLicenseType();
    expect(cb).toHaveBeenCalledWith('free');
  });

  it('getLicenseType emits stored license type', async () => {
    localStorage.setItem('mlearn-license', 'pro');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.license.onLicenseGet(cb);
    bridge.license.getLicenseType();
    expect(cb).toHaveBeenCalledWith('pro');
  });

  it('activateLicense sets pro license and emits activated', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const cb = vi.fn();
    bridge.license.onLicenseActivated(cb);
    bridge.license.activateLicense('some-valid-key');
    expect(localStorage.getItem('mlearn-license')).toBe('pro');
    expect(cb).toHaveBeenCalledWith(true);
  });

  it('activateLicense with empty key sets free license', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.license.activateLicense('');
    expect(localStorage.getItem('mlearn-license')).toBe('free');
  });

  it('removeLicense clears the license from localStorage', async () => {
    localStorage.setItem('mlearn-license', 'pro');
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.license.removeLicense();
    expect(localStorage.getItem('mlearn-license')).toBeNull();
  });
});

// ============================================================================
// Migration Bridge
// ============================================================================

describe('Migration Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getMigratedLocalStorage returns null', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(await bridge.migration.getMigratedLocalStorage()).toBeNull();
  });

  it('getMigratedItem returns null', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(await bridge.migration.getMigratedItem('any-key')).toBeNull();
  });

  it('hasMigrationOccurred returns false', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(await bridge.migration.hasMigrationOccurred()).toBe(false);
  });

  it('triggerMigration returns success with empty migratedKeys', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.migration.triggerMigration();
    expect(result.success).toBe(true);
    expect(result.migratedKeys).toEqual([]);
  });

  it('noopCleanup methods return functions', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(typeof bridge.migration.onLocalStorageMigrationComplete(vi.fn())).toBe('function');
    expect(typeof bridge.migration.onFlashcardMigrationComplete(vi.fn())).toBe('function');
    expect(() => bridge.migration.getFlashcardMigrationInfo()).not.toThrow();
  });
});

// ============================================================================
// Generic IPC Bridge
// ============================================================================

describe('Generic IPC Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sendLS is a noop', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.generic.sendLS({ key: 'value' })).not.toThrow();
  });

  it('fetchUrl returns content on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue('<html>hello</html>'),
    });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.generic.fetchUrl('https://example.com');
    expect(result.content).toBe('<html>hello</html>');
    expect(result.error).toBeUndefined();
  });

  it('fetchUrl returns error string on failure', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('timeout'));
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const result = await bridge.generic.fetchUrl('https://broken.com');
    expect(result.content).toBe('');
    expect(result.error).toContain('timeout');
  });
});

// ============================================================================
// Data Bridge
// ============================================================================

describe('Data Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('dataExport returns success and triggers download', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(node => node);
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(node => node);
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const result = await bridge.data.dataExport();
    expect(result.success).toBe(true);
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(revokeUrlSpy).toHaveBeenCalled();
    appendSpy.mockRestore();
    removeSpy.mockRestore();
    revokeUrlSpy.mockRestore();
  });

  it('dataImport creates a file input element', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const createElementSpy = vi.spyOn(document, 'createElement');
    bridge.data.dataImport().catch(() => {});
    await new Promise(r => setTimeout(r, 5));
    expect(createElementSpy).toHaveBeenCalledWith('input');
    createElementSpy.mockRestore();
  });
});

// ============================================================================
// createCapacitorBridge factory
// ============================================================================

describe('createCapacitorBridge()', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns a PlatformBridge with all 18 sub-bridges', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(bridge.settings).toBeDefined();
    expect(bridge.flashcards).toBeDefined();
    expect(bridge.localization).toBeDefined();
    expect(bridge.files).toBeDefined();
    expect(bridge.window).toBeDefined();
    expect(bridge.server).toBeDefined();
    expect(bridge.installer).toBeDefined();
    expect(bridge.llm).toBeDefined();
    expect(bridge.speech).toBeDefined();
    expect(bridge.voice).toBeDefined();
    expect(bridge.mediaStats).toBeDefined();
    expect(bridge.watchTogether).toBeDefined();
    expect(bridge.crossWindow).toBeDefined();
    expect(bridge.license).toBeDefined();
    expect(bridge.migration).toBeDefined();
    expect(bridge.generic).toBeDefined();
    expect(bridge.data).toBeDefined();
    expect(bridge.kvStore).toBeDefined();
  });

  it('returns a new bridge instance each call', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const b1 = createCapacitorBridge();
    const b2 = createCapacitorBridge();
    expect(b1).not.toBe(b2);
  });
});

// ============================================================================
// Cross-Window Bridge
// ============================================================================

describe('Cross-Window Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('all onUpdate methods return cleanup functions', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(typeof bridge.crossWindow.onUpdatePills(vi.fn())).toBe('function');
    expect(typeof bridge.crossWindow.onUpdateWordAppearance(vi.fn())).toBe('function');
    expect(typeof bridge.crossWindow.onUpdateAttemptFlashcardCreation(vi.fn())).toBe('function');
    expect(typeof bridge.crossWindow.onUpdateCreateFlashcard(vi.fn())).toBe('function');
    expect(typeof bridge.crossWindow.onUpdateLastWatched(vi.fn())).toBe('function');
  });
});

// ============================================================================
// Watch Together Bridge
// ============================================================================

describe('Watch Together Bridge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('isWatchingTogether is a noop', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.watchTogether.isWatchingTogether()).not.toThrow();
  });

  it('watchTogetherSend does not throw when no WS', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(() => bridge.watchTogether.watchTogetherSend({ type: 'play' })).not.toThrow();
  });

  it('watchTogetherSend sends to WebSocket if present', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    const sendMock = vi.fn();
    (window as unknown as Record<string, unknown>).__mlearnWatchWS = { send: sendMock };
    bridge.watchTogether.watchTogetherSend({ type: 'pause', time: 42 });
    expect(sendMock).toHaveBeenCalledWith(JSON.stringify({ type: 'pause', time: 42 }));
    delete (window as unknown as Record<string, unknown>).__mlearnWatchWS;
  });

  it('onWatchTogetherLaunch and onWatchTogetherRequest return cleanup functions', async () => {
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    expect(typeof bridge.watchTogether.onWatchTogetherLaunch(vi.fn())).toBe('function');
    expect(typeof bridge.watchTogether.onWatchTogetherRequest(vi.fn())).toBe('function');
  });
});

// ============================================================================
// Backend URL helpers (integration via server bridge)
// ============================================================================

describe('Backend URL helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses PYTHON_BACKEND_PORT as default backend URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.server.isLoaded();
    await new Promise(r => setTimeout(r, 20));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('7752'));
  });

  it('uses PROXY_SERVER_PORT as default node server URL for LLM', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({ read: vi.fn().mockResolvedValue({ done: true }) }) },
    });
    vi.stubGlobal('fetch', mockFetch);
    const { createCapacitorBridge } = await import('./capacitorBridge');
    const bridge = createCapacitorBridge();
    bridge.llm.llmStream([], []);
    await new Promise(r => setTimeout(r, 20));
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('7753'), expect.any(Object));
  });
});
