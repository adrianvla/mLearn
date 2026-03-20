// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Settings, FlashcardStore, Flashcard, WordCandidate } from '@shared/types';
import type { SyncCallbacks, SyncStatus } from './syncService';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    known_ease_threshold: 2.5,
    blur_words: false,
    blur_known_subtitles: false,
    blur_amount: 0,
    colour_known: '#888',
    do_colour_known: false,
    do_colour_codes: false,
    colour_codes: {},
    theme: 'dark',
    language: 'ja',
    hover_known_get_from_dictionary: false,
    show_pos: false,
    furigana: false,
    showPitchAccent: false,
    use_anki: false,
    flashcardSkipAnkiChoice: false,
    anki_field_expression: '',
    anki_field_reading: '',
    anki_field_meaning: '',
    anki_model_name: '',
    ankiConnectUrl: '',
    ankiTemplateExpression: '',
    ankiTemplateReading: '',
    ankiTemplateMeaning: '',
    enable_flashcard_creation: true,
    automaticFlashcardCreation: false,
    flashcard_deck: null,
    flashcards_add_picture: false,
    maxNewCardsPerDay: 20,
    proportionOfExamCards: 0,
    preparedExam: 0,
    createUnseenCards: false,
    flashcardLLMExamples: false,
    newDayHour: 4,
    lastModified: 1000,
    ...overrides,
  } as Settings;
}

function makeFlashcard(overrides: { id?: string; lastUpdated?: number; contentFront?: string } = {}): Flashcard {
  return {
    id: overrides.id ?? 'card-1',
    content: {
      type: 'word',
      front: overrides.contentFront ?? 'word',
      back: 'meaning',
    },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    createdAt: 1000,
    lastReviewed: 1000,
    lastUpdated: overrides.lastUpdated ?? 1000,
  } as Flashcard;
}

function makeCandidate(overrides: Partial<WordCandidate> = {}): WordCandidate {
  return { count: 1, lastSeen: 1000, word: 'word', ...overrides };
}

function makeStore(overrides: Partial<FlashcardStore> = {}): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    wordStatsMap: {},
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {},
    grammarKnowledge: {},
    meta: {
      newCardsToday: 0,
      reviewsToday: 0,
      newCardsDate: '2024-01-01',
      maxNewCardsPerDay: 20,
      maxNewCardsPerDayLearning: -1,
      maxReviewsPerDay: -1,
      learningSteps: [1, 10],
      relearnSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      newIntervalModifier: 100,
      reviewIntervalModifier: 100,
      maxInterval: 36500,
    },
    dailyStats: {},
    version: 4,
    ...overrides,
  };
}

let mockServer: {
  ping: ReturnType<typeof vi.fn>;
  getSettings: ReturnType<typeof vi.fn>;
  saveSettings: ReturnType<typeof vi.fn>;
  getFlashcards: ReturnType<typeof vi.fn>;
  saveFlashcards: ReturnType<typeof vi.fn>;
};

async function loadModule() {
  const mod = await import('./syncService');
  return mod;
}

async function flushInitialSync() {
  await vi.runOnlyPendingTimersAsync();
}

describe('syncService', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();

    mockServer = {
      ping: vi.fn().mockResolvedValue(true),
      getSettings: vi.fn().mockResolvedValue(null),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      getFlashcards: vi.fn().mockResolvedValue(null),
      saveFlashcards: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('@shared/backends/nodeServerAdapter', () => ({
      getNodeServer: () => mockServer,
    }));
  });

  afterEach(async () => {
    const mod = await loadModule();
    mod.stopSync();
    vi.useRealTimers();
  });

  describe('getSyncStatus', () => {
    it('returns offline before any sync started', async () => {
      const { getSyncStatus } = await loadModule();
      expect(getSyncStatus()).toBe('offline');
    });
  });

  describe('startSync', () => {
    it('calls onStatusChange with syncing then synced on successful ping', async () => {
      const { startSync } = await loadModule();
      const statusChanges: SyncStatus[] = [];
      const cbs: SyncCallbacks = {
        onStatusChange: (s) => statusChanges.push(s),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(statusChanges).toContain('syncing');
      expect(statusChanges[statusChanges.length - 1]).toBe('synced');
    });

    it('sets up a 60-second polling interval that triggers syncAll', async () => {
      const { startSync } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      const pingsAfterStart = mockServer.ping.mock.calls.length;

      vi.advanceTimersByTime(60_000);
      await flushInitialSync();

      expect(mockServer.ping.mock.calls.length).toBeGreaterThan(pingsAfterStart);
    });

    it('clears previous polling interval when called twice', async () => {
      const { startSync } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();
      startSync(cbs);
      await flushInitialSync();
      await vi.advanceTimersByTimeAsync(0);

      const pingsBeforeClear = mockServer.ping.mock.calls.length;
      mockServer.ping.mockClear();
      vi.advanceTimersByTime(60_000);
      await flushInitialSync();

      const pingsAfterAdvance = mockServer.ping.mock.calls.length;
      expect(pingsBeforeClear).toBe(4);
      expect(pingsAfterAdvance).toBe(2);
    });
  });

  describe('stopSync', () => {
    it('sets status to offline', async () => {
      const { startSync, stopSync, getSyncStatus } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();
      stopSync();

      expect(getSyncStatus()).toBe('offline');
    });

    it('stops the polling interval after stopSync', async () => {
      const { startSync, stopSync } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();
      const pingCountAfterStart = mockServer.ping.mock.calls.length;

      stopSync();
      vi.advanceTimersByTime(60_000);
      await flushInitialSync();

      expect(mockServer.ping.mock.calls.length).toBe(pingCountAfterStart);
    });

    it('is safe to call when not started', async () => {
      const { stopSync } = await loadModule();
      expect(() => stopSync()).not.toThrow();
    });
  });

  describe('syncAll (full cycle)', () => {
    it('pulls settings and flashcards when ping succeeds', async () => {
      const remoteSettings = makeSettings({ lastModified: 9999 });
      const remoteStore = makeStore({ flashcards: { c1: makeFlashcard({ id: 'c1', lastUpdated: 9999 }) } });
      mockServer.getSettings.mockResolvedValue(remoteSettings);
      mockServer.getFlashcards.mockResolvedValue(remoteStore);

      const { startSync } = await loadModule();
      const onSettingsReceived = vi.fn();
      const onFlashcardsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived,
        onFlashcardsReceived,
        getLocalSettings: () => makeSettings({ lastModified: 1 }),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(mockServer.getSettings).toHaveBeenCalled();
      expect(mockServer.getFlashcards).toHaveBeenCalled();
      expect(onSettingsReceived).toHaveBeenCalledWith(remoteSettings);
      expect(onFlashcardsReceived).toHaveBeenCalled();
    });

    it('sets status to offline when ping returns false', async () => {
      mockServer.ping.mockResolvedValue(false);

      const { startSync, getSyncStatus } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(getSyncStatus()).toBe('offline');
      expect(mockServer.getSettings).not.toHaveBeenCalled();
    });

    it('sets status to error when an exception is thrown during sync', async () => {
      mockServer.ping.mockRejectedValue(new Error('network error'));

      const { startSync, getSyncStatus } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(getSyncStatus()).toBe('error');
    });
  });

  describe('mergeSettings (via syncAll behavior)', () => {
    it('adopts remote settings when remote.lastModified > local.lastModified', async () => {
      const remoteSettings = makeSettings({ lastModified: 5000, language: 'de' });
      mockServer.getSettings.mockResolvedValue(remoteSettings);

      const { startSync } = await loadModule();
      const onSettingsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived,
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings({ lastModified: 1000 }),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onSettingsReceived).toHaveBeenCalledWith(remoteSettings);
    });

    it('does not call onSettingsReceived when local.lastModified >= remote.lastModified', async () => {
      const remoteSettings = makeSettings({ lastModified: 100 });
      mockServer.getSettings.mockResolvedValue(remoteSettings);

      const { startSync } = await loadModule();
      const onSettingsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived,
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings({ lastModified: 9999 }),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onSettingsReceived).not.toHaveBeenCalled();
    });

    it('does not call onSettingsReceived when remote returns null', async () => {
      mockServer.getSettings.mockResolvedValue(null);

      const { startSync } = await loadModule();
      const onSettingsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived,
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onSettingsReceived).not.toHaveBeenCalled();
    });
  });

  describe('mergeFlashcardStores (via pullFlashcards)', () => {
    it('takes remote card when remote.lastUpdated > local.lastUpdated', async () => {
      const localCard = makeFlashcard({ id: 'c1', lastUpdated: 100, contentFront: 'old' });
      const remoteCard = makeFlashcard({ id: 'c1', lastUpdated: 999, contentFront: 'new' });

      mockServer.getFlashcards.mockResolvedValue(makeStore({ flashcards: { c1: remoteCard } }));

      const { startSync } = await loadModule();
      const onFlashcardsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived,
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore({ flashcards: { c1: localCard } }),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onFlashcardsReceived).toHaveBeenCalled();
      const merged: FlashcardStore = onFlashcardsReceived.mock.calls[0][0];
      expect(merged.flashcards['c1'].content.front).toBe('new');
    });

    it('keeps local card when local.lastUpdated >= remote and no other changes exist', async () => {
      const card = makeFlashcard({ id: 'c1', lastUpdated: 999 });
      mockServer.getFlashcards.mockResolvedValue(
        makeStore({ flashcards: { c1: makeFlashcard({ id: 'c1', lastUpdated: 100 }) } })
      );

      const { startSync } = await loadModule();
      const onFlashcardsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived,
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore({ flashcards: { c1: card } }),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onFlashcardsReceived).not.toHaveBeenCalled();
    });

    it('adds remote-only card to merged result', async () => {
      const remoteCard = makeFlashcard({ id: 'c2', lastUpdated: 500 });
      mockServer.getFlashcards.mockResolvedValue(makeStore({ flashcards: { c2: remoteCard } }));

      const { startSync } = await loadModule();
      const onFlashcardsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived,
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore({ flashcards: {} }),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onFlashcardsReceived).toHaveBeenCalled();
      const merged: FlashcardStore = onFlashcardsReceived.mock.calls[0][0];
      expect(merged.flashcards['c2']).toBeDefined();
    });

    it('returns null (no callback) when both stores are identical', async () => {
      const card = makeFlashcard({ id: 'c1', lastUpdated: 500 });
      mockServer.getFlashcards.mockResolvedValue(makeStore({ flashcards: { c1: card } }));

      const { startSync } = await loadModule();
      const onFlashcardsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived,
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore({ flashcards: { c1: card } }),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onFlashcardsReceived).not.toHaveBeenCalled();
    });

    it('takes remote wordCandidate when remote.lastSeen > local.lastSeen', async () => {
      const localCandidate = makeCandidate({ word: 'test', lastSeen: 100 });
      const remoteCandidate = makeCandidate({ word: 'test', lastSeen: 9999 });

      mockServer.getFlashcards.mockResolvedValue(
        makeStore({ wordCandidates: { 'test-hash': remoteCandidate } })
      );

      const { startSync } = await loadModule();
      const onFlashcardsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived,
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore({ wordCandidates: { 'test-hash': localCandidate } }),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onFlashcardsReceived).toHaveBeenCalled();
      const merged: FlashcardStore = onFlashcardsReceived.mock.calls[0][0];
      expect(merged.wordCandidates['test-hash'].lastSeen).toBe(9999);
    });

    it('adds remote-only wordCandidate to merged result', async () => {
      const remoteCandidate = makeCandidate({ word: 'newword', lastSeen: 500 });
      mockServer.getFlashcards.mockResolvedValue(
        makeStore({ wordCandidates: { 'new-hash': remoteCandidate } })
      );

      const { startSync } = await loadModule();
      const onFlashcardsReceived = vi.fn();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived,
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore({ wordCandidates: {} }),
      };

      startSync(cbs);
      await flushInitialSync();

      expect(onFlashcardsReceived).toHaveBeenCalled();
      const merged: FlashcardStore = onFlashcardsReceived.mock.calls[0][0];
      expect(merged.wordCandidates['new-hash']).toBeDefined();
    });
  });

  describe('queueSettingsPush', () => {
    it('immediately calls saveSettings when not offline', async () => {
      const { startSync, queueSettingsPush } = await loadModule();
      const localSettings = makeSettings();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => localSettings,
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      mockServer.saveSettings.mockClear();
      queueSettingsPush({ language: 'de' });
      await flushInitialSync();

      expect(mockServer.saveSettings).toHaveBeenCalledWith(localSettings);
    });

    it('does not call saveSettings immediately when status is offline', async () => {
      const { queueSettingsPush, getSyncStatus } = await loadModule();

      expect(getSyncStatus()).toBe('offline');
      queueSettingsPush({ language: 'de' });
      await flushInitialSync();

      expect(mockServer.saveSettings).not.toHaveBeenCalled();
    });

    it('flushes pending settings on next poll when previously offline', async () => {
      const { startSync, queueSettingsPush } = await loadModule();
      const localSettings = makeSettings();

      mockServer.ping.mockResolvedValueOnce(false).mockResolvedValue(true);

      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => localSettings,
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      queueSettingsPush({ language: 'fr' });

      vi.advanceTimersByTime(60_000);
      await flushInitialSync();

      expect(mockServer.saveSettings).toHaveBeenCalledWith(localSettings);
    });
  });

  describe('queueFlashcardsPush', () => {
    it('immediately calls saveFlashcards when not offline', async () => {
      const { startSync, queueFlashcardsPush } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      const storeToQueue = makeStore({ flashcards: { c1: makeFlashcard() } });
      mockServer.saveFlashcards.mockClear();
      queueFlashcardsPush(storeToQueue);
      await flushInitialSync();

      expect(mockServer.saveFlashcards).toHaveBeenCalledWith(storeToQueue);
    });

    it('does not call saveFlashcards immediately when status is offline', async () => {
      const { queueFlashcardsPush, getSyncStatus } = await loadModule();

      expect(getSyncStatus()).toBe('offline');
      queueFlashcardsPush(makeStore());
      await flushInitialSync();

      expect(mockServer.saveFlashcards).not.toHaveBeenCalled();
    });

    it('flushes pending flashcards on next poll cycle', async () => {
      const { startSync, queueFlashcardsPush } = await loadModule();
      const localStore = makeStore();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => localStore,
      };

      startSync(cbs);
      await flushInitialSync();

      queueFlashcardsPush(makeStore({ flashcards: { c1: makeFlashcard() } }));

      vi.advanceTimersByTime(60_000);
      await flushInitialSync();

      expect(mockServer.saveFlashcards).toHaveBeenCalled();
    });

    it('flushes pending flashcards on next poll when previously offline', async () => {
      const { startSync, queueFlashcardsPush } = await loadModule();
      const localStore = makeStore();

      mockServer.ping.mockResolvedValueOnce(false).mockResolvedValue(true);

      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => localStore,
      };

      startSync(cbs);
      await flushInitialSync();

      queueFlashcardsPush(makeStore({ flashcards: { c1: makeFlashcard() } }));

      vi.advanceTimersByTime(60_000);
      await flushInitialSync();

      expect(mockServer.saveFlashcards).toHaveBeenCalledWith(localStore);
    });
  });

  describe('triggerSync', () => {
    it('calls syncAll: pings and pulls data', async () => {
      const { startSync, triggerSync } = await loadModule();
      const cbs: SyncCallbacks = {
        onStatusChange: vi.fn(),
        onSettingsReceived: vi.fn(),
        onFlashcardsReceived: vi.fn(),
        getLocalSettings: () => makeSettings(),
        getLocalFlashcards: () => makeStore(),
      };

      startSync(cbs);
      await flushInitialSync();

      const pingsBefore = mockServer.ping.mock.calls.length;
      triggerSync();
      await flushInitialSync();

      expect(mockServer.ping.mock.calls.length).toBeGreaterThan(pingsBefore);
    });

    it('does not throw when called without startSync', async () => {
      const { triggerSync } = await loadModule();
      expect(() => triggerSync()).not.toThrow();
      await flushInitialSync();
    });
  });
});
