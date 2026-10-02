import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import path from 'path';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import type { FlashcardStore, Flashcard } from '../../shared/types';
import type { StorePatch } from '../../shared/utils/storePatch';
import type { FlashcardRatingCommand } from '../../shared/flashcardRating';
import { IPC_CHANNELS } from '../../shared/constants';

const mockIpcListeners = new Map<string, Function[]>();
const mockIpcHandlers = new Map<string, Function>();
const ratingCommit = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: ratingCommit } }] },
  ipcMain: {
    on: vi.fn((channel: string, handler: Function) => {
      const existing = mockIpcListeners.get(channel) || [];
      existing.push(handler);
      mockIpcListeners.set(channel, existing);
    }),
    handle: vi.fn((channel: string, handler: Function) => {
      mockIpcHandlers.set(channel, handler);
    }),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => '/tmp/test'),
    on: vi.fn(),
    quit: vi.fn(),
    isPackaged: false,
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
  net: { fetch: vi.fn() },
}));

let tempDir: TempDir;

vi.mock('../utils/platform', () => ({
  getUserDataPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getAppPath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
  getResourcePath: vi.fn(() => tempDir?.tmpDir || '/tmp/test'),
}));

vi.mock('./flashcardImageStorage', () => ({
  extractBase64Images: vi.fn(() => false),
}));

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
    suggestedFlashcards: {},
    meta: {
      perLanguage: {
        ja: {
          newCardsToday: 0,
          reviewsToday: 0,
          newCardsDate: new Date().toISOString().split('T')[0],
        },
      },
      newCardsToday: 0,
      reviewsToday: 0,
      newCardsDate: new Date().toISOString().split('T')[0],
      maxNewCardsPerDay: 10,
      maxNewCardsPerDayLearning: 20,
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
    version: 2,
    ...overrides,
  };
}

function makeFlashcard(id: string, overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    content: { type: 'word', front: 'hello', back: 'world' },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 0,
    lastReviewed: 0,
    lastUpdated: 0,
    ...overrides,
  };
}

function writeFlashcardsFile(dir: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, 'flashcards.json'), JSON.stringify(data, null, 2));
}

function writeLanguageMetadata(dir: string, language: string, data: unknown): void {
  const languagesDir = path.join(dir, 'language-data', 'languages');
  fs.mkdirSync(languagesDir, { recursive: true });
  fs.writeFileSync(path.join(languagesDir, `${language}.json`), JSON.stringify(data, null, 2));
}

describe('flashcardStorage', () => {
  let loadFlashcards: () => Promise<FlashcardStore>;
  let saveFlashcards: (store: FlashcardStore) => Promise<number>;
  let getFlashcardEaseMap: () => Promise<Record<string, number>>;
  let setupFlashcardIPC: () => void;
  let invalidateFlashcardsCache: () => void;
  let saveFlashcardPatch: (patch: StorePatch) => Promise<number>;

  beforeEach(async () => {
    tempDir = createTempDir('mlearn-fc-test-');
    mockIpcListeners.clear();
    mockIpcHandlers.clear();
    vi.resetModules();

    const mod = await import('./flashcardStorage');
    loadFlashcards = mod.loadFlashcards;
    saveFlashcards = mod.saveFlashcards;
    getFlashcardEaseMap = mod.getFlashcardEaseMap;
    setupFlashcardIPC = mod.setupFlashcardIPC;
    invalidateFlashcardsCache = mod.invalidateFlashcardsCache;
    saveFlashcardPatch = mod.saveFlashcardPatch;
  });

  afterEach(() => {
    tempDir.cleanup();
  });

  const ratingCommand = (card: Flashcard, reviews: number, count: number): FlashcardRatingCommand => ({
    attemptId: `attempt-${card.id}-${reviews}`,
    patch: { baseRev: 1, entries: [
      { path: ['flashcards', card.id], before: card, after: { ...card, state: 'review', reviews, lastUpdated: Date.now() } },
      { path: ['meta', 'perLanguage', 'ja', 'reviewsToday'], before: count - 1, after: count },
    ] },
    events: { 'ja:rating-key': [{ t: Date.now(), kind: 'review', source: 'srs', rating: 'good',
      schedulerCardId: card.id, attemptId: `attempt-${card.id}-${reviews}` }] },
    counterDeltas: [
      { path: ['flashcards', card.id, 'reviews'], delta: reviews - card.reviews },
      { path: ['meta', 'perLanguage', 'ja', 'reviewsToday'], delta: 1 },
    ],
  });

  it('admits an ordered same-card queue against each preceding captured response and retains both original Undos', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('queued-chain');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card } }));
    const first = { ...ratingCommand(card, 1, 1), guardCardIds: [card.id] };
    const nextCard = first.patch.entries[0].after as Flashcard;
    const second = { ...ratingCommand(nextCard, 2, 2), guardCardIds: [card.id] };
    const undo = (command: FlashcardRatingCommand) => ({ attemptId: command.attemptId, surface: 'future-review',
      word: 'cue', language: 'xx', attemptIds: [command.attemptId], restore: { original: command.patch.entries[0].before } });
    const promises = [storage.enqueueFlashcardRating({ ...first, undo: undo(first) }),
      storage.enqueueFlashcardRating({ ...second, undo: undo(second) })];
    await storage.flushFlashcardRatings();
    await Promise.all(promises);
    const saved = await loadFlashcards();
    expect(saved.flashcards[card.id].reviews).toBe(2);
    expect(saved.meta.perLanguage.ja.reviewsToday).toBe(2);
    const journal = await import('./knowledgeEvents');
    expect(journal.pendingRatingCommands()).toEqual([]);
    const db = new DatabaseSync(path.join(tempDir.tmpDir, 'knowledge-history.sqlite3'));
    expect(db.prepare('select count(*) as count from rating_undo').get()).toEqual({ count: 2 });
    db.close();
  });

  it('refuses a queued stale card before reservation without overwriting a later authored answer', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('queued-stale');
    const edited = { ...card, content: { ...card.content, back: 'later authored answer' } };
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: edited } }));
    const command = { ...ratingCommand(card, 1, 1), guardCardIds: [card.id] };
    const pending = storage.enqueueFlashcardRating(command);
    const refused = expect(pending).rejects.toThrow(/changed before admission/);
    await expect(storage.flushFlashcardRatings()).rejects.toThrow(/changed before admission/);
    await refused;
    expect((await loadFlashcards()).flashcards[card.id]).toEqual(edited);
    const journal = await import('./knowledgeEvents');
    expect(journal.pendingRatingCommands()).toEqual([]);
    expect(journal.getKnowledgeEvents(['ja:rating-key'])).toEqual({});
    // The refused command never owns a retry slot or blocks a normal edit.
    const later = structuredClone(await loadFlashcards());
    later.flashcards[card.id].content.back = 'another authored edit';
    await expect(saveFlashcards(later)).resolves.toBeTypeOf('number');
  });

  it('releases a new queued response during pending Undo so the owning recovery can complete', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('queued-during-undo');
    const pendingRetraction = { attemptId: 'existing-undo', surface: 'future', word: 'cue', language: 'xx',
      attemptIds: ['existing-undo'], restore: {} };
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card }, pendingRetraction }));
    const refused = storage.enqueueFlashcardRating({ ...ratingCommand(card, 1, 1), guardCardIds: [card.id] });
    const refusal = expect(refused).rejects.toThrow(/pending Undo/);
    await expect(storage.flushFlashcardRatings()).rejects.toThrow(/pending Undo/);
    await refusal;
    const completing = structuredClone(await loadFlashcards());
    delete completing.pendingRetraction;
    completing.retractionCompleted = pendingRetraction.attemptId;
    await expect(saveFlashcards(completing)).resolves.toBeTypeOf('number');
    expect((await loadFlashcards()).pendingRetraction).toBeUndefined();
    await expect(storage.flushFlashcardRatings()).resolves.toBeUndefined();
  });

  it('protects a decided review rollback from resets and deletion while permitting authored edits', async () => {
    const card = makeFlashcard('protected-undo');
    const pendingRetraction = { attemptId: 'owned-response', surface: 'flashcard-review', word: card.content.front,
      language: 'ja', attemptIds: ['owned-response'], restore: { cardId: card.id, type: 'answer',
        restoreCard: structuredClone(card), expectedCard: structuredClone(card), today: 'day', restorePerLanguage: null, restoreDailyStats: null } };
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card }, pendingRetraction }));
    const authored = structuredClone(await loadFlashcards());
    authored.flashcards[card.id].content.back = 'later authored answer';
    await saveFlashcards(authored);
    const changed = structuredClone(await loadFlashcards());
    changed.flashcards[card.id].reviews += 1;
    await expect(saveFlashcards(changed, [], true)).rejects.toThrow(/changed/);
    const deleted = structuredClone(await loadFlashcards());
    delete deleted.flashcards[card.id];
    await expect(saveFlashcards(deleted, [card.id])).rejects.toThrow(/changed/);
    const preserved = await loadFlashcards();
    expect(preserved.flashcards[card.id].content.back).toBe('later authored answer');
    expect(preserved.pendingRetraction).toEqual(pendingRetraction);
    const completed = structuredClone(await loadFlashcards());
    delete completed.pendingRetraction;
    completed.retractionCompleted = pendingRetraction.attemptId;
    await saveFlashcards(completed);
    expect((await loadFlashcards()).pendingRetraction).toBeUndefined();
  });

  it('refuses a new review while a decided Undo still owns the journal and scheduler recovery', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('undo-in-flight');
    const pendingRetraction = { attemptId: 'prior', surface: 'future-surface', word: 'cue', language: 'xx',
      attemptIds: ['prior'], restore: { future: 'opaque' } };
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card }, pendingRetraction }));
    await expect(storage.commitFlashcardRating(ratingCommand(card, 1, 1))).rejects.toThrow(/Undo/);
    const loaded = await storage.loadFlashcards();
    expect(loaded.flashcards[card.id].reviews).toBe(card.reviews);
    expect(loaded.pendingRetraction).toEqual(pendingRetraction);
  });

  it('recovers a durably admitted rating after restart, then acknowledges retries without repeating counters', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('crash-recovery');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card } }));
    const command = ratingCommand(card, 1, 1);
    const writes = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    await expect(storage.commitFlashcardRating(command)).rejects.toThrow('disk full');
    // Restart the ownership boundary with real persisted SQLite and file data.
    vi.resetModules();
    const restarted = await import('./flashcardStorage');
    const recovered = await restarted.loadFlashcards();
    expect(recovered.flashcards[card.id].reviews).toBe(1);
    expect(recovered.meta.perLanguage.ja.reviewsToday).toBe(1);
    const revision = recovered.rev;
    const acknowledgement = await restarted.commitFlashcardRating(command);
    expect(acknowledgement.rev).toBe(revision);
    expect((await restarted.loadFlashcards()).flashcards[card.id].reviews).toBe(1);
    const journal = await import('./knowledgeEvents');
    expect(journal.getKnowledgeEvents(['ja:rating-key'])['ja:rating-key']).toHaveLength(1);
    writes.mockRestore();
  });

  it('does not replay counters when the library committed before the receipt acknowledgement failed', async () => {
    const storage = await import('./flashcardStorage');
    const journal = await import('./knowledgeEvents');
    const card = makeFlashcard('after-rename');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card } }));
    const command = ratingCommand(card, 1, 1);
    vi.spyOn(journal, 'completeRatingCommands').mockImplementationOnce(() => { throw new Error('receipt interrupted'); });
    await expect(storage.commitFlashcardRating(command)).rejects.toThrow('receipt interrupted');
    expect(JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf8')).flashcards[card.id].reviews).toBe(1);
    vi.resetModules();
    const restarted = await import('./flashcardStorage');
    const restored = await restarted.loadFlashcards();
    expect(restored.flashcards[card.id].reviews).toBe(1);
    expect(restored.meta.perLanguage.ja.reviewsToday).toBe(1);
    await restarted.commitFlashcardRating(command);
    expect((await restarted.loadFlashcards()).flashcards[card.id].reviews).toBe(1);
  });

  it('refuses a changed captured card before durable admission or journal append', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('changed-prompt');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: { ...card, content: { ...card.content, front: 'edited prompt' } } } }));
    await expect(storage.commitFlashcardRating({ ...ratingCommand(card, 1, 1), guardCardIds: [card.id] })).rejects.toThrow(/changed before admission/);
    const journal = await import('./knowledgeEvents');
    expect(journal.pendingRatingCommands()).toEqual([]);
    expect(journal.getKnowledgeEvents(['ja:rating-key'])).toEqual({});
    expect((await loadFlashcards()).flashcards[card.id].content.front).toBe('edited prompt');
  });

  it('composes independent-window counters and returns the actual authority when an old receipt is retried', async () => {
    const storage = await import('./flashcardStorage');
    const first = makeFlashcard('immediate-first');
    const second = makeFlashcard('immediate-second');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [first.id]: first, [second.id]: second } }));
    const firstCommand = { ...ratingCommand(first, 1, 1), guardCardIds: [first.id] };
    await storage.commitFlashcardRating(firstCommand);
    await storage.commitFlashcardRating({ ...ratingCommand(second, 1, 1), guardCardIds: [second.id] });
    const retry = await storage.commitFlashcardRating(firstCommand);
    expect((await loadFlashcards()).meta.perLanguage.ja.reviewsToday).toBe(2);
    expect(retry.patch.entries.find(entry => entry.path.join('.') === 'meta.perLanguage.ja.reviewsToday')?.after).toBe(2);
    expect((await loadFlashcards()).flashcards[first.id].reviews).toBe(1);
  });

  it.each(['warm', 'cold'])('keeps the main-owned receipt through unrelated %s snapshots', async temperature => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('frontier');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card } }));
    await storage.commitFlashcardRating(ratingCommand(card, 1, 1));
    const authority = structuredClone(await loadFlashcards());
    const sequence = authority.meta.ratingCommitSequence;
    const ledgerId = authority.meta.ratingCommitLedgerId;
    delete authority.meta.ratingCommitSequence;
    delete authority.meta.ratingCommitLedgerId;
    if (temperature === 'cold') invalidateFlashcardsCache();
    await saveFlashcards(authority);
    const saved = await loadFlashcards();
    expect(saved.meta.ratingCommitSequence).toBe(sequence);
    expect(saved.meta.ratingCommitLedgerId).toBe(ledgerId);
  });

  it('does not use an imported frontier as proof that this authority committed a new response', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('foreign-ledger');
    const imported = makeStore({ version: 3, flashcards: { [card.id]: card } });
    imported.meta.ratingCommitSequence = 100000;
    imported.meta.ratingCommitLedgerId = 'different-authority';
    writeFlashcardsFile(tempDir.tmpDir, imported);
    await storage.commitFlashcardRating(ratingCommand(card, 1, 1));
    const saved = await loadFlashcards();
    expect(saved.flashcards[card.id].reviews).toBe(1);
    expect(saved.meta.ratingCommitLedgerId).not.toBe('different-authority');
    expect(saved.meta.ratingCommitSequence).toBe(1);
  });

  it('settles an admitted response before an unrelated removal, so restart cannot resurrect the card', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('remove-after-failure');
    const before = makeStore({ version: 3, flashcards: { [card.id]: card } });
    await saveFlashcards(before);
    const peer = structuredClone(before);
    delete peer.flashcards[card.id];
    const command = { ...ratingCommand(card, 1, 1), guardCardIds: [card.id] };
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    await expect(storage.commitFlashcardRating(command)).rejects.toThrow('disk full');
    await expect(saveFlashcards(peer)).rejects.toThrow(/revision/);
    const settled = structuredClone(await loadFlashcards());
    expect(settled.flashcards[card.id].reviews).toBe(1);
    delete settled.flashcards[card.id];
    await saveFlashcards(settled);
    vi.resetModules();
    const restarted = await import('./flashcardStorage');
    expect((await restarted.loadFlashcards()).flashcards[card.id]).toBeUndefined();
    const journal = await import('./knowledgeEvents');
    expect(journal.pendingRatingCommands()).toEqual([]);
  });

  it('settles an admitted media reference before deciding whether that media is unused', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('media-after-failure');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card } }));
    const command = ratingCommand(card, 1, 1);
    const entry = command.patch.entries[0];
    entry.after = { ...entry.after as Flashcard, content: { ...card.content, back: 'flashcard-image://retained.png' } };
    vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    await expect(storage.commitFlashcardRating(command)).rejects.toThrow('disk full');
    const release = vi.fn();
    await expect(storage.releaseUnusedFlashcardMedia('image', 'retained', release)).resolves.toBe(false);
    expect(release).not.toHaveBeenCalled();
    expect((await loadFlashcards()).flashcards[card.id].reviews).toBe(1);
  });

  it('persists rapid ratings as one latest-state write and one committed patch', async () => {
    const storage = await import('./flashcardStorage');
    const first = makeFlashcard('batch-first');
    const second = makeFlashcard('batch-second');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [first.id]: first, [second.id]: second } }));
    const writes = vi.spyOn(fs.promises, 'writeFile');
    ratingCommit.mockClear();
    // Two windows can submit against the same counter baseline.
    const promises = [storage.enqueueFlashcardRating(ratingCommand(first, 1, 1)), storage.enqueueFlashcardRating(ratingCommand(second, 1, 1))];
    expect(writes).not.toHaveBeenCalled();
    await storage.flushFlashcardRatings();
    expect(await Promise.all(promises)).toEqual([2, 2]);
    expect(writes).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf8')) as FlashcardStore;
    expect(persisted.meta.perLanguage.ja.reviewsToday).toBe(2);
    expect(persisted.flashcards[first.id].reviews).toBe(1);
    expect(persisted.flashcards[second.id].reviews).toBe(1);
    expect(ratingCommit.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.FLASHCARD_RATINGS_COMMITTED)).toHaveLength(1);
    const journal = await import('./knowledgeEvents');
    expect(journal.getKnowledgeEvents(['ja:rating-key'])['ja:rating-key']).toHaveLength(2);
    writes.mockRestore();
  });

  it('retries a failed batch without duplicating durable journal evidence', async () => {
    const storage = await import('./flashcardStorage');
    const card = makeFlashcard('retry-batch');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card } }));
    const writes = vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const command = ratingCommand(card, 1, 1);
    const failed = storage.enqueueFlashcardRating(command);
    const rejected = expect(failed).rejects.toThrow('disk full');
    await expect(storage.flushFlashcardRatings()).rejects.toThrow('disk full');
    await rejected;
    const recovered = await loadFlashcards();
    expect(recovered.flashcards[card.id].reviews).toBe(1);
    const retry = storage.enqueueFlashcardRating(command);
    await storage.flushFlashcardRatings();
    expect(await retry).toBe(recovered.rev);
    const journal = await import('./knowledgeEvents');
    expect(journal.getKnowledgeEvents(['ja:rating-key'])['ja:rating-key']).toHaveLength(1);
    writes.mockRestore();
  });

  it('flushes accepted ratings before quitting even when the review renderer has gone away', async () => {
    const storage = await import('./flashcardStorage');
    const electron = await import('electron');
    const card = makeFlashcard('quit-batch');
    await saveFlashcards(makeStore({ version: 3, flashcards: { [card.id]: card } }));
    setupFlashcardIPC();
    const command = storage.enqueueFlashcardRating(ratingCommand(card, 1, 1));
    const quitHandler = vi.mocked(electron.app.on).mock.calls.filter(([event]) => event === 'before-quit').at(-1)![1];
    const event = { preventDefault: vi.fn() };
    quitHandler(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(await command).toBe(2);
    await vi.waitFor(() => expect(electron.app.quit).toHaveBeenCalled());
    expect((await loadFlashcards()).flashcards[card.id].reviews).toBe(1);
  });

  describe('loadFlashcards', () => {
    it('returns default empty store when flashcards.json does not exist', async () => {
      const store = await loadFlashcards();

      expect(store.version).toBe(3);
      expect(store.flashcards).toEqual({});
      expect(store.wordToCardMap).toEqual({});
    });

    it('loads a valid v5 store from disk', async () => {
      const card = makeFlashcard('card-1', { content: { type: 'word', front: 'test', back: 'exam' } });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1']).toBeDefined();
      expect(store.flashcards['card-1'].content.front).toBe('test');
    });

    it('strips stored top-level pitch accent content when a card has no language', async () => {
      const card = makeFlashcard('card-1', {
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          pitchAccent: 2,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      const content = store.flashcards['card-1'].content as Flashcard['content'] & { pitchAccent?: number };
      expect(content.prosody).toBeUndefined();
      expect(content.pitchAccent).toBeUndefined();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.prosody).toBeUndefined();
      expect(saved.flashcards['card-1'].content.pitchAccent).toBeUndefined();
    });

    it('migrates explicit-language legacy pitch accent only when language metadata uses Japanese pitch rendering', async () => {
      writeLanguageMetadata(tempDir.tmpDir, 'jp-test', {
        name: 'Japanese test',
        prosody: { type: 'japanese-pitch-accent' },
      });
      const card = makeFlashcard('card-1', {
        language: 'jp-test',
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          pitchAccent: 2,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1'].content.prosody).toEqual({
        type: 'japanese-pitch-accent',
        position: 2,
        raw: {
          type: 'japanese-pitch-accent',
          position: 2,
        },
      });
    });

    it('migrates legacy positional prosody to the language-declared prosody type', async () => {
      writeLanguageMetadata(tempDir.tmpDir, 'stress-test', {
        name: 'Stress test',
        prosody: { type: 'stress-position' },
      });
      const card = makeFlashcard('card-1', {
        language: 'stress-test',
        content: {
          type: 'word',
          front: 'example',
          back: 'example',
          pitchAccent: 1,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1'].content.prosody).toEqual({
        type: 'stress-position',
        position: 1,
        raw: { type: 'stress-position', position: 1 },
      });
    });

    it('strips explicit-language legacy pitch accent when language metadata is missing', async () => {
      const card = makeFlashcard('card-1', {
        language: 'missing-lang',
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          pitchAccent: 2,
        } as Flashcard['content'] & { pitchAccent: number },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      const content = store.flashcards['card-1'].content as Flashcard['content'] & { pitchAccent?: number };
      expect(content.pitchAccent).toBeUndefined();
      expect(content.prosody).toBeUndefined();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.pitchAccent).toBeUndefined();
      expect(saved.flashcards['card-1'].content.prosody).toBeUndefined();
    });

    it('strips legacy pitch accent fields from non-Japanese-prosody cards without inventing Japanese prosody', async () => {
      writeLanguageMetadata(tempDir.tmpDir, 'de', {
        name: 'German',
        prosody: { type: 'none' },
      });
      const card = makeFlashcard('card-1', {
        language: 'de',
        content: {
          type: 'word',
          front: 'rot',
          back: 'red',
          pitchAccent: 2,
          prosody: {
            type: 'none',
            pitchAccentPosition: 2,
          },
        } as Flashcard['content'] & {
          pitchAccent: number;
          prosody: Flashcard['content']['prosody'] & { pitchAccentPosition: number };
        },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      const content = store.flashcards['card-1'].content as Flashcard['content'] & { pitchAccent?: number };
      expect(content.prosody).toEqual({ type: 'none' });
      expect(content.pitchAccent).toBeUndefined();
      expect(
        (content.prosody as Flashcard['content']['prosody'] & { pitchAccentPosition?: number })?.pitchAccentPosition
      ).toBeUndefined();
    });

    it('migrates stale prosody pitch accent position into the generic position field', async () => {
      const card = makeFlashcard('card-1', {
        content: {
          type: 'word',
          front: '赤い',
          back: 'red',
          reading: 'あかい',
          prosody: {
            type: 'japanese-pitch-accent',
            pitchAccentPosition: 2,
          },
        } as Flashcard['content'] & {
          prosody: Flashcard['content']['prosody'] & { pitchAccentPosition: number };
        },
      });
      const data = makeStore({ flashcards: { 'card-1': card }, version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      const store = await loadFlashcards();

      expect(store.flashcards['card-1'].content.prosody?.position).toBe(2);
      expect(
        (store.flashcards['card-1'].content.prosody as Flashcard['content']['prosody'] & { pitchAccentPosition?: number })
          ?.pitchAccentPosition
      ).toBeUndefined();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.prosody.position).toBe(2);
      expect(saved.flashcards['card-1'].content.prosody.pitchAccentPosition).toBeUndefined();
    });

    it.each(['{ invalid json <<<', '"just a string"', '[1,2,3]', '{"version":3,"flashcards":[]}'])('refuses an unreadable library without replacing it: %s', async (contents) => {
      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      fs.writeFileSync(filePath, contents);
      await expect(loadFlashcards()).rejects.toThrow();
      await expect(saveFlashcards(makeStore({ version: 3 }))).rejects.toThrow();
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(contents);

      // A repaired file is read again; a failed load never installs an empty cache.
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3, rev: 9 }));
      expect((await loadFlashcards()).rev).toBeGreaterThanOrEqual(9);
    });

    it('refuses a cold save over corrupt JSON even before the first load', async () => {
      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      fs.writeFileSync(filePath, '{ broken');
      await expect(saveFlashcards(makeStore({ version: 3 }))).rejects.toThrow();
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{ broken');
    });

    it('keeps access failures distinct from a genuinely missing library', async () => {
      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3, rev: 7 }));
      const original = fs.readFileSync(filePath, 'utf-8');
      vi.spyOn(fs.promises, 'access').mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
      await expect(loadFlashcards()).rejects.toThrow('permission denied');
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(original);
      expect((await loadFlashcards()).rev).toBeGreaterThanOrEqual(7);
    });

    it('reports an IPC load failure and delivers the repaired library on retry', async () => {
      setupFlashcardIPC();
      const receive = mockIpcListeners.get(IPC_CHANNELS.GET_FLASHCARDS)!.at(-1)!;
      const reply = vi.fn();
      fs.writeFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), '{ broken');
      await receive({ reply });
      expect(reply).toHaveBeenCalledWith('flashcards-load-error', expect.any(String));
      expect(reply).not.toHaveBeenCalledWith(IPC_CHANNELS.FLASHCARDS_LOADED, expect.anything());
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3, rev: 8 }));
      await receive({ reply });
      expect(reply).toHaveBeenLastCalledWith(IPC_CHANNELS.FLASHCARDS_LOADED, expect.objectContaining({ rev: expect.any(Number) }));
    });

    it('calls extractBase64Images after loading', async () => {
      const { extractBase64Images } = await import('./flashcardImageStorage');
      const data = makeStore({ version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      await loadFlashcards();

      expect(extractBase64Images).toHaveBeenCalled();
    });

    it('saves store after loading if extractBase64Images returns true', async () => {
      const { extractBase64Images } = await import('./flashcardImageStorage');
      vi.mocked(extractBase64Images).mockReturnValueOnce(true);
      const data = makeStore({ version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, data);

      await loadFlashcards();

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.version).toBe(3);
    });

    it('loads store with missing optional fields and fills in defaults', async () => {
      const partial = { flashcards: {}, version: 2 };
      writeFlashcardsFile(tempDir.tmpDir, partial);

      const store = await loadFlashcards();

      expect(store.wordCandidates).toEqual({});
      expect(store.wordToCardMap).toEqual({});
      expect(store.meta).toBeDefined();
      expect(store.meta.maxNewCardsPerDay).toBe(10);
    });
  });

  it.each([false, true])('retires carried manual-action owners on Resume with warm=%s authority', async warm => {
    const card = makeFlashcard('action-owner', { buried: true,
      scheduleActionOwners: { buried: 'original-bury', 'future-action': 'opaque-owner' } });
    const original = makeStore({ version: 3, rev: 7, flashcards: { [card.id]: card } });
    writeFlashcardsFile(tempDir.tmpDir, original);
    const incoming = structuredClone(warm ? await loadFlashcards() : original);
    incoming.flashcards[card.id].buried = false;
    incoming.flashcards[card.id].content.futureFeature = { contextual: ['arbitrary'] };
    await saveFlashcards(incoming);
    const saved = await loadFlashcards();
    expect(saved.flashcards[card.id].scheduleActionOwners).toEqual({ 'future-action': 'opaque-owner' });
    expect(saved.flashcards[card.id].content.futureFeature).toEqual({ contextual: ['arbitrary'] });
    const replacement = structuredClone(saved);
    replacement.flashcards[card.id].buried = true;
    await saveFlashcards(replacement);
    expect((await loadFlashcards()).flashcards[card.id].scheduleActionOwners?.buried).not.toBe('original-bury');
  });

  it.each([false, true])('preserves the manual-action owner through a legacy content-only save with warm=%s authority', async warm => {
    const card = makeFlashcard('legacy-action-owner', { suspended: true, scheduleActionOwners: { suspended: 'owned-suspend' } });
    const original = makeStore({ version: 3, rev: 7, flashcards: { [card.id]: card } });
    writeFlashcardsFile(tempDir.tmpDir, original);
    const incoming = structuredClone(warm ? await loadFlashcards() : original);
    delete incoming.flashcards[card.id].scheduleActionOwners;
    incoming.flashcards[card.id].content.back = 'legacy authored edit';
    await saveFlashcards(incoming);
    const saved = await loadFlashcards();
    expect(saved.flashcards[card.id].scheduleActionOwners?.suspended).toBe('owned-suspend');
    expect(saved.flashcards[card.id].content.back).toBe('legacy authored edit');
  });

  it.each([false, true])('refuses a retired exclusion owner carried by a legacy caller with cold=%s second write', async cold => {
    const { setFlashcardExclusion, captureFlashcardActionUndo, flashcardActionUndoIsApplicable } = await import('../../shared/flashcardActionUndo');
    const card = makeFlashcard('legacy-retired-owner');
    const excluded = setFlashcardExclusion(card, 'buried', true);
    const proof = captureFlashcardActionUndo(card, excluded, 'buried');
    writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3, rev: 7, flashcards: { [card.id]: excluded } }));
    const legacyCaller = structuredClone(await loadFlashcards());
    legacyCaller.flashcards[card.id].buried = false;
    const resumedRev = await saveFlashcards(structuredClone(legacyCaller));
    // Main normalized only its IPC-equivalent copy. Caller receives rev, retaining its old owner.
    legacyCaller.rev = resumedRev;
    legacyCaller.flashcards[card.id].buried = true;
    if (cold) invalidateFlashcardsCache();
    await saveFlashcards(structuredClone(legacyCaller));
    const actual = await loadFlashcards();
    expect(actual.flashcards[card.id].buried).toBe(true);
    expect(actual.flashcards[card.id].scheduleActionOwners?.buried).not.toBe(proof.expectedOwner);
    expect(flashcardActionUndoIsApplicable(actual, proof)).toBe(false);
  });

  it('keeps mixed current-writer action proof identical across the actual save boundary', async () => {
    const { setFlashcardExclusion } = await import('../../shared/flashcardActionUndo');
    const card = setFlashcardExclusion(makeFlashcard('mixed-proof'), 'suspended', true);
    writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3, rev: 7, flashcards: { [card.id]: card } }));
    const current = structuredClone(await loadFlashcards());
    current.flashcards[card.id] = setFlashcardExclusion(setFlashcardExclusion(current.flashcards[card.id], 'buried', true), 'suspended', false);
    const expected = structuredClone(current.flashcards[card.id]);
    await saveFlashcards(current);
    expect((await loadFlashcards()).flashcards[card.id]).toEqual(expected);
    await saveFlashcards(structuredClone(await loadFlashcards()));
    expect((await loadFlashcards()).flashcards[card.id]).toEqual(expected);
  });

  it('keeps a shipped unowned daily unbury identical across the authoritative save', async () => {
    const { setFlashcardExclusion } = await import('../../shared/flashcardActionUndo');
    const card = makeFlashcard('legacy-daily-unbury', { buried: true });
    writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3, rev: 7, flashcards: { [card.id]: card } }));
    const current = structuredClone(await loadFlashcards());
    current.flashcards[card.id] = setFlashcardExclusion(current.flashcards[card.id], 'buried', false);
    const expected = structuredClone(current.flashcards[card.id]);
    await saveFlashcards(current);
    expect((await loadFlashcards()).flashcards[card.id]).toEqual(expected);
  });

  it('preserves restored review position and unknown assistance flags through native store load and save', async () => {
    const data = makeStore({ version: 3 });
    data.meta.reviewPresentations = { 'future-package': { id: 'restored-attempt', cardId: 'restored-card',
      scaffolds: { 'provided-access:future:structured-relationship': true, 'future:cue': true } } };
    writeFlashcardsFile(tempDir.tmpDir, data);
    const loaded = await loadFlashcards();
    expect(loaded.meta.reviewPresentations).toEqual(data.meta.reviewPresentations);
    await saveFlashcards(loaded);
    const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8')) as FlashcardStore;
    expect(persisted.meta.reviewPresentations).toEqual(data.meta.reviewPresentations);
  });

  it('carries a pending Undo record forward when an unrelated window saves without it', async () => {
    // The store is a whole snapshot and every window saves all of it, so a
    // window whose snapshot predates the record has no `pendingRetraction` key
    // at all. Persisting that snapshot verbatim deleted the record and left
    // the rating the learner tried to take back applied with nothing able to
    // take it back — the one outcome the record exists to prevent.
    const retraction = {
      attemptId: 'attempt-1',
      surface: 'word-sync',
      word: '赤い',
      language: 'ja',
      attemptIds: ['attempt-1'],
      restore: { ratedCount: 3 },
    };
    const recording = makeStore({
      rev: 0,
      flashcards: { 'card-1': makeFlashcard('card-1', { state: 'review', reviews: 4 }) },
      pendingRetraction: retraction,
    } as Partial<FlashcardStore>);
    await saveFlashcards(recording);
    expect((await loadFlashcards()).pendingRetraction).toMatchObject({ attemptId: 'attempt-1' });

    // An unrelated window at the new revision, built before it knew about the
    // Undo, saving its own change.
    const unrelated = makeStore({
      rev: 1,
      flashcards: { 'card-1': makeFlashcard('card-1', { state: 'review', reviews: 4 }) },
      wordStatsMap: { '赤い': { attempts: 2 } },
    } as Partial<FlashcardStore>);
    await saveFlashcards(unrelated);

    const stored = await loadFlashcards();
    // Its own change landed...
    expect(stored.wordStatsMap['赤い']).toEqual({ attempts: 2 });
    // ...and the record the learner is relying on survived it.
    expect(stored.pendingRetraction).toMatchObject({ attemptId: 'attempt-1', surface: 'word-sync' });
  });

  it.each(['pendingRetraction', 'pendingReviewUndo'])('preserves a cold %s record through unrelated saves and explicit completion', async (field) => {
    const pending = { attemptId: 'cold-undo', surface: 'custom', word: '', language: 'future', attemptIds: ['physical-response'], restore: { position: 3 } };
    writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3, rev: 9, [field]: pending }));
    await saveFlashcards(makeStore({ version: 3, rev: 9 }));
    const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
    expect(persisted.pendingRetraction).toMatchObject(pending);
    const { invalidateFlashcardsCache } = await import('./flashcardStorage');
    invalidateFlashcardsCache();
    await saveFlashcards(makeStore({ version: 3, rev: 10, retractionCompleted: 'cold-undo' }));
    const finished = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
    expect(finished.pendingRetraction).toBeUndefined();
    expect(finished.retractionCompleted).toBeUndefined();
  });

  it('refuses to replace another pending Undo even at the current revision', async () => {
    const pending = { attemptId: 'first', surface: 'custom', word: '', language: 'unknown', attemptIds: ['attempt'], restore: { position: 1 } };
    await saveFlashcards(makeStore({ rev: 0, pendingRetraction: pending }));
    await expect(saveFlashcards(makeStore({ rev: 1, pendingRetraction: { ...pending, attemptId: 'second' } }))).rejects.toThrow(/pending Undo/i);
    expect((await loadFlashcards()).pendingRetraction?.attemptId).toBe('first');
  });

  it('lets the window that recorded a pending Undo clear it', async () => {
    // Preserving the record must not make it permanent: finishing the Undo is
    // exactly a write that omits the field on purpose.
    const recording = makeStore({
      rev: 0,
      pendingRetraction: {
        attemptId: 'attempt-1',
        surface: 'word-sync',
        word: '赤い',
        language: 'ja',
        attemptIds: ['attempt-1'],
        restore: { ratedCount: 3 },
      },
    } as Partial<FlashcardStore>);
    await saveFlashcards(recording);

    const finishing = makeStore({ rev: 1, retractionCompleted: 'attempt-1' } as Partial<FlashcardStore>);
    await saveFlashcards(finishing);

    expect((await loadFlashcards()).pendingRetraction).toBeUndefined();
  });

  it('never persists a retraction completion claim', async () => {
    // The claim exists to disambiguate one write from another. Persisted, it
    // would let a much later unrelated write look like it was finishing an Undo
    // that had long since been resolved.
    await saveFlashcards(makeStore({
      rev: 0,
      retractionCompleted: 'attempt-1',
    } as Partial<FlashcardStore>));

    const stored = await loadFlashcards();
    expect(stored.retractionCompleted).toBeUndefined();
  });

  it('rejects a stale renderer snapshot after another window commits a newer revision', async () => {
    const original = makeStore({
      rev: 0,
      flashcards: { 'shared-card': makeFlashcard('shared-card', { state: 'review', reviews: 4 }) },
    });
    await saveFlashcards(original);

    const undone = makeStore({
      rev: 1,
      flashcards: { 'shared-card': makeFlashcard('shared-card', { state: 'review', reviews: 3 }) },
    });
    await saveFlashcards(undone);

    const staleWindow = makeStore({
      rev: 0,
      flashcards: { 'shared-card': makeFlashcard('shared-card', { state: 'review', reviews: 4 }) },
    });
    await expect(saveFlashcards(staleWindow)).rejects.toThrow(/revision/i);

    const stored = await loadFlashcards();
    expect(stored.rev).toBe(2);
    expect(stored.flashcards['shared-card'].reviews).toBe(3);
  });

  describe('saveFlashcards', () => {
    it('saves store to flashcards.json', async () => {
      const store = makeStore({ flashcards: { 'card-save': makeFlashcard('card-save') } });

      await saveFlashcards(store);

      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(saved.flashcards['card-save']).toBeDefined();
    });

    it('persists current generic prosody content without Japanese-specific rewrite', async () => {
      const card = makeFlashcard('card-1', {
        content: {
          type: 'word',
          front: 'سلام',
          back: 'hello',
          prosody: {
            type: 'tone-contour',
            position: 1,
            raw: { contour: 'LH' },
          },
        },
      });

      await saveFlashcards(makeStore({ flashcards: { 'card-1': card } }));

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-1'].content.prosody).toEqual({
        type: 'tone-contour',
        position: 1,
        raw: { contour: 'LH' },
      });
    });

    it('uses atomic write via .tmp file then rename', async () => {
      const store = makeStore();
      const tmpPath = path.join(tempDir.tmpDir, 'flashcards.json.tmp');

      await saveFlashcards(store);

      expect(fs.existsSync(tmpPath)).toBe(false);
      expect(fs.existsSync(path.join(tempDir.tmpDir, 'flashcards.json'))).toBe(true);
    });

    it('calls extractBase64Images before persisting', async () => {
      const { extractBase64Images } = await import('./flashcardImageStorage');
      const store = makeStore();

      await saveFlashcards(store);

      expect(extractBase64Images).toHaveBeenCalledWith(store);
    });

    it('overwrites existing file with updated store', async () => {
      const storeV1 = makeStore({ flashcards: { 'card-a': makeFlashcard('card-a') } });
      const revision = await saveFlashcards(storeV1);

      const storeV2 = makeStore({ rev: revision, flashcards: { 'card-b': makeFlashcard('card-b') } });
      await saveFlashcards(storeV2);

      const saved = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8'));
      expect(saved.flashcards['card-b']).toBeDefined();
      expect(saved.flashcards['card-a']).toBeUndefined();
    });

    it('serializes store as valid JSON with indentation', async () => {
      const store = makeStore();

      await saveFlashcards(store);

      const raw = fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
      expect(raw).toContain('\n');
    });

    it('rejects concurrent stale snapshots after the first serialized commit', async () => {
      const stores = Array.from({ length: 5 }, (_, i) => {
        const id = `card-${i}`;
        return makeStore({ flashcards: { [id]: makeFlashcard(id) } });
      });

      const results = await Promise.allSettled(stores.map(s => saveFlashcards(s)));

      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      expect(fs.existsSync(filePath)).toBe(true);
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(typeof saved.flashcards).toBe('object');
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(4);
      expect(saved.rev).toBe(1);
    });
  });

  describe('getFlashcardEaseMap', () => {
    it('returns empty map when no flashcards exist', async () => {
      const map = await getFlashcardEaseMap();
      expect(map).toEqual({});
    });

    it('returns map of front -> ease for each flashcard', async () => {
      const store = makeStore({
        flashcards: {
          'card-1': makeFlashcard('card-1', { content: { type: 'word', front: 'hello', back: 'world' }, ease: 2.5 }),
          'card-2': makeFlashcard('card-2', { content: { type: 'word', front: 'goodbye', back: 'au revoir' }, ease: 1.8 }),
        },
        version: 2,
      });
      writeFlashcardsFile(tempDir.tmpDir, store);

      const map = await getFlashcardEaseMap();

      expect(map['hello']).toBe(2.5);
      expect(map['goodbye']).toBe(1.8);
    });

    it('skips cards without content.front', async () => {
      const store = makeStore({
        flashcards: {
          'card-nf': makeFlashcard('card-nf', { content: { type: 'word', front: '', back: 'x' } }),
        },
        version: 2,
      });
      writeFlashcardsFile(tempDir.tmpDir, store);

      const map = await getFlashcardEaseMap();

      expect(Object.keys(map)).toHaveLength(0);
    });
  });

  describe('migrations', () => {
    it('migrates v2 store to v5: converts single cardId string to array in wordToCardMap', async () => {
      const cardId = 'card-v2';
      const v2Store = {
        flashcards: {
          [cardId]: makeFlashcard(cardId, { content: { type: 'word', front: 'test-word', back: 'x' } }),
        },
        wordToCardMap: { 'some-key': cardId },
        version: 2,
      };
      writeFlashcardsFile(tempDir.tmpDir, v2Store);

      const store = await loadFlashcards();

      expect(store.version).toBe(3);
      expect(store.flashcards[cardId].content.front).toBe('test-word');
    });

    it('v2 migration handles array cardIds in wordToCardMap', async () => {
      const cardId1 = 'card-a';
      const cardId2 = 'card-b';
      const v2Store = {
        flashcards: {
          [cardId1]: makeFlashcard(cardId1, { content: { type: 'word', front: 'word', back: 'x' } }),
          [cardId2]: makeFlashcard(cardId2, { content: { type: 'word', front: 'word', back: 'y' } }),
        },
        wordToCardMap: { 'word-key': [cardId1, cardId2] },
        version: 2,
      };
      writeFlashcardsFile(tempDir.tmpDir, v2Store);

      const store = await loadFlashcards();

      expect(store.version).toBe(3);
      expect(Object.keys(store.flashcards)).toEqual([cardId1, cardId2]);
    });

  });

  describe('setupFlashcardIPC', () => {
    it('registers GET_FLASHCARDS and an acknowledged SAVE_FLASHCARDS handler', async () => {
      const { ipcMain } = await import('electron');

      setupFlashcardIPC();

      expect(vi.mocked(ipcMain.on)).toHaveBeenCalledWith('get-flashcards', expect.any(Function));
      expect(vi.mocked(ipcMain.handle)).toHaveBeenCalledWith('save-flashcards', expect.any(Function));
    });

    it('GET_FLASHCARDS handler replies with loaded flashcards', async () => {
      const store = makeStore({ version: 2 });
      writeFlashcardsFile(tempDir.tmpDir, store);

      setupFlashcardIPC();

      const listeners = mockIpcListeners.get('get-flashcards');
      expect(listeners).toBeDefined();
      expect(listeners!).toHaveLength(1);

      const replyFn = vi.fn();
      await listeners![0]({ reply: replyFn });

      expect(replyFn).toHaveBeenCalledWith('flashcards-loaded', expect.objectContaining({ version: 3 }));
    });

    it('GET_FLASHCARDS handler skips the store ship when the requester holds the current rev', async () => {
      const store = makeStore({ version: 3 });
      writeFlashcardsFile(tempDir.tmpDir, store);

      setupFlashcardIPC();

      const listeners = mockIpcListeners.get('get-flashcards');
      const replyFn = vi.fn();
      const event = { reply: replyFn };

      // Unknown rev (initial load): full store ships.
      await listeners![0](event);
      expect(replyFn).toHaveBeenCalledWith('flashcards-loaded', expect.objectContaining({ version: 3 }));

      // Learn the current rev (from the reply) and probe with it: null payload.
      const currentRev = replyFn.mock.calls[0][1].rev;
      replyFn.mockClear();
      await listeners![0](event, currentRev);
      expect(replyFn).toHaveBeenCalledWith('flashcards-loaded', null);

      // A stale rev still ships the full store.
      replyFn.mockClear();
      await listeners![0](event, currentRev - 1);
      expect(replyFn).toHaveBeenCalledWith('flashcards-loaded', expect.objectContaining({ rev: currentRev }));
    });

    it('GET_FLASHCARDS handler also replies with migration info when migration occurred', async () => {
      writeLanguageMetadata(tempDir.tmpDir, 'zh', {
        name: 'Chinese',
        legacyCodes: ['zh-Hans', 'zh-Hant'],
        variants: {
          'zh-Hans': { name: 'Simplified', overrides: {} },
          'zh-Hant': { name: 'Traditional', overrides: {}, scriptConversion: { engine: 'opencc', config: 't2s', mappingAsset: 'languages/zh.t2s.json' } },
        },
      });
      writeLanguageMetadata(tempDir.tmpDir, 'zh.t2s', { words: {}, chars: {} });
      const legacyV2Store = makeStore({
        flashcards: { 'card-zh': makeFlashcard('card-zh', { language: 'zh-Hans' }) },
        version: 2,
      });
      writeFlashcardsFile(tempDir.tmpDir, legacyV2Store);

      await loadFlashcards();

      setupFlashcardIPC();

      const listeners = mockIpcListeners.get('get-flashcards');
      const replyFn = vi.fn();
      await listeners![0]({ reply: replyFn });

      expect(replyFn).toHaveBeenCalledWith('flashcard-migration-complete', expect.objectContaining({ occurred: true, fromVersion: 2 }));
    });

    it('SAVE_FLASHCARDS handler resolves only after the provided store is durable', async () => {
      setupFlashcardIPC();

      const handler = mockIpcHandlers.get('save-flashcards');
      expect(handler).toBeDefined();

      const store = makeStore({ flashcards: { 'card-ipc': makeFlashcard('card-ipc') } });
      await expect(handler!({}, store)).resolves.toBe(1);

      const filePath = path.join(tempDir.tmpDir, 'flashcards.json');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      expect(saved.flashcards['card-ipc']).toBeDefined();
    });

    it('SAVE_FLASHCARDS handler rejects when durable persistence fails', async () => {
      setupFlashcardIPC();
      const handler = mockIpcHandlers.get('save-flashcards');
      expect(handler).toBeDefined();
      vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full'));

      await expect(handler!({}, makeStore())).rejects.toThrow('disk full');
    });

  });

  describe('authoritative media release', () => {
    it('waits for a queued store write before deciding whether to release media', async () => {
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3 }));
      const before = structuredClone(await loadFlashcards());
      const peer = makeFlashcard('peer', { content: { type: 'word', front: 'peer', back: 'answer', imageUrl: 'flashcard-image://shared.png' } });
      const next = { ...before, flashcards: { peer } };
      const writeFile = fs.promises.writeFile.bind(fs.promises);
      let unblock!: () => void;
      const gate = new Promise<void>(resolve => { unblock = resolve; });
      vi.spyOn(fs.promises, 'writeFile').mockImplementationOnce(async (...args) => { await gate; return writeFile(...args); });
      const save = saveFlashcards(next);
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      const cleanup = releaseUnusedFlashcardMedia('image', 'shared', release);
      try {
        expect(release).not.toHaveBeenCalled();
        unblock(); await save;
        await expect(cleanup).resolves.toBe(false);
        expect(release).not.toHaveBeenCalled();
      } finally { unblock(); await save; }
    });

    it.each(['image', 'video', 'tts'] as const)('releases unreferenced %s only within the authority turn', async kind => {
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3 }));
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia(kind, 'absent', release)).resolves.toBe(true);
      expect(release).toHaveBeenCalledOnce();
    });

    it.each(['missing', 'invalid-json', 'invalid-collection'] as const)('retains media when cold authority is %s', async variant => {
      if (variant === 'invalid-json') fs.writeFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), '{');
      if (variant === 'invalid-collection') writeFlashcardsFile(tempDir.tmpDir, { flashcards: [], suggestedFlashcards: {} });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', 'shared', release)).rejects.toThrow();
      expect(release).not.toHaveBeenCalled();
    });

    it.each(['missing', 'nonobject'] as const)('does not trust a warm %s loader fallback to release media', async variant => {
      if (variant === 'nonobject') writeFlashcardsFile(tempDir.tmpDir, []);
      if (variant === 'nonobject') await expect(loadFlashcards()).rejects.toThrow();
      else await loadFlashcards();
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', 'shared', release)).rejects.toThrow();
      expect(release).not.toHaveBeenCalled();
    });

    it.each(['image', 'video', 'tts'] as const)('retains recreated %s namespaces before an explicit URL is populated', async kind => {
      writeFlashcardsFile(tempDir.tmpDir, { flashcards: { shared: { id: 'shared', content: { front: 'new owner' } } },
        suggestedFlashcards: { suggestion: { id: 'capture', word: 'new capture' } } });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia(kind, 'shared', release)).resolves.toBe(false);
      await expect(releaseUnusedFlashcardMedia(kind, 'capture', release)).resolves.toBe(false);
      if (kind === 'image') await expect(releaseUnusedFlashcardMedia(kind, 'suggested-capture', release)).resolves.toBe(false);
      expect(release).not.toHaveBeenCalled();
    });

    it.each(['flashcard-image://shared&#46;png', 'flashcard-image&colon;//shared.png',
      '&#102;lashcard-image://shared.png', 'flashcard-image://shared&period;png',
      'flashcard-image://shared&fjlig;.png'])('retains rendered or opaque entity references %s', async url => {
      writeFlashcardsFile(tempDir.tmpDir, { flashcards: { peer: { content: { back: `<img src="${url}">` } } }, suggestedFlashcards: {} });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', url.includes('fjlig') ? 'sharedfj' : 'shared', release)).resolves.toBe(false);
      expect(release).not.toHaveBeenCalled();
    });

    it.each([
      ['FLASHCARD-IMAGE://shared.png', 'shared'],
      ['flashcard-image://shared asset.png', 'shared asset'],
      ['flashcard-image://sh\tared.png', 'shared'],
      ['flashcard-image://shared&Tab;.png', 'shared'],
      ['flashcard-image://shared&#34;asset.png', 'shared"asset'],
    ])('retains browser-normalized resource spelling %s', async (url, id) => {
      writeFlashcardsFile(tempDir.tmpDir, { flashcards: { peer: { content: { back: `<img src="${url}">` } } }, suggestedFlashcards: {} });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', id, release)).resolves.toBe(false);
      expect(release).not.toHaveBeenCalled();
    });

    it.each([' ', '\t'])('retains an unquoted HTML source with %j attribute separation', async separator => {
      writeFlashcardsFile(tempDir.tmpDir, { flashcards: { peer: { content: {
        back: `<img src=flashcard-image://shared.png${separator}alt=description>`,
      } } }, suggestedFlashcards: {} });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', 'shared', release)).resolves.toBe(false);
      expect(release).not.toHaveBeenCalled();
    });

    it('retains audio when an encoded query is removed by its serving protocol', async () => {
      writeFlashcardsFile(tempDir.tmpDir, { flashcards: { peer: { content: {
        unknown: '<audio src="flashcard-audio://shared-word.ogg%3Fcache=1"></audio>',
      } } }, suggestedFlashcards: {} });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('tts', 'shared', release)).resolves.toBe(false);
      expect(release).not.toHaveBeenCalled();
    });

    it.each([undefined, null, 123, '', '../original', 'a/b', 'a\\b', '.', '..', '/tmp/original', 'a\0b'])('rejects invalid media ID %j before release', async id => {
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3 }));
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', id as string, release)).rejects.toThrow();
      expect(release).not.toHaveBeenCalled();
    });

    it('refuses cleanup from an incomplete card envelope or unknown media operation', async () => {
      writeFlashcardsFile(tempDir.tmpDir, { flashcards: { incomplete: { id: 'incomplete' } }, suggestedFlashcards: {} });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', 'shared', release)).rejects.toThrow();
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3 }));
      await expect(releaseUnusedFlashcardMedia('other' as 'image', 'shared', release)).rejects.toThrow();
      expect(release).not.toHaveBeenCalled();
    });

    it('preserves opaque package references and encoded legacy screenshots', async () => {
      writeFlashcardsFile(tempDir.tmpDir, { flashcards: { peer: { id: 'peer', content: {
        screenshotUrl: 'flashcard-image://shared%20asset.gif',
        unknown: { arbitrary: ['<audio src="flashcard-audio://shared%20asset-example.ogg"></audio>'] },
      } } }, suggestedFlashcards: {} });
      const release = vi.fn();
      const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
      await expect(releaseUnusedFlashcardMedia('image', 'shared asset', release)).resolves.toBe(false);
      await expect(releaseUnusedFlashcardMedia('tts', 'shared asset', release)).resolves.toBe(false);
      expect(release).not.toHaveBeenCalled();
    });
  });

  describe('mutation-owned store cache', () => {
    it('serves repeat loads from memory, updates on save, and re-reads after invalidation', async () => {
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ version: 3 }));
      const first = await loadFlashcards();

      const readFileSpy = vi.spyOn(fs.promises, 'readFile');
      const second = await loadFlashcards();
      expect(second).toBe(first);
      expect(readFileSpy).not.toHaveBeenCalled();
      readFileSpy.mockRestore();

      // A save is the mutation path: the in-memory store becomes the saved
      // object (with its bumped rev) — reads never touch disk.
      first.flashcards['mutated'] = makeFlashcard('mutated');
      const revBeforeSave = first.rev ?? 0;
      await saveFlashcards(first);
      const third = await loadFlashcards();
      expect(third).toBe(first);
      expect(third.rev).toBe(revBeforeSave + 1);

      // Direct disk writes bypass the mutation path; invalidation restores
      // disk truth.
      writeFlashcardsFile(tempDir.tmpDir, makeStore({
        version: 3,
        flashcards: { ext: makeFlashcard('ext') },
      }));
      invalidateFlashcardsCache();
      const fourth = await loadFlashcards();
      expect(fourth).not.toBe(first);
      expect(fourth.flashcards['ext']).toBeDefined();
    });
  });
  describe('saveFlashcardPatch', () => {
    const patchFor = (entries: StorePatch['entries'], baseRev = 0): StorePatch => ({ baseRev, entries });

    /**
     * Regression: saveFlashcardPatch runs inside the write queue, so it must not
     * call the queued saveFlashcards — that re-enters the same queue and awaits
     * the write that is already awaiting it. The write then never settles, the
     * renderer hangs, and the rating surfaces as "could not be saved".
     * A timeout here is the deadlock, not a slow test.
     */
    it('settles instead of deadlocking on the write queue', async () => {
      const card = makeFlashcard('card-patch', { reviews: 1 });
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ flashcards: { 'card-patch': card }, version: 3 }));
      const store = await loadFlashcards();

      const patch = patchFor([{ path: ['flashcards', 'card-patch'], before: card, after: { ...card, reviews: 2 } }], store.rev ?? 0);
      const revision = await saveFlashcardPatch(patch);

      // The write advances the authoritative revision exactly once.
      const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8')) as FlashcardStore;
      // The revision main reports is the one it wrote.
      expect(persisted.rev).toBe(revision);
      expect(persisted.flashcards['card-patch'].reviews).toBe(2);
    }, 10_000);

    it('falls back to a full save when the patch targets a stale revision', async () => {
      const card = makeFlashcard('card-stale', { reviews: 1 });
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ flashcards: { 'card-stale': card }, version: 3 }));
      const store = await loadFlashcards();
      await saveFlashcardPatch(patchFor([], store.rev ?? 0));

      // A patch computed against the previous revision must still be applied to
      // the CURRENT store rather than rejected or applied to a stale snapshot.
      const stale = patchFor(
        [{ path: ['flashcards', 'card-stale'], before: card, after: { ...card, reviews: 7 } }],
        (store.rev ?? 0),
      );
      await saveFlashcardPatch(stale);

      const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8')) as FlashcardStore;
      expect(persisted.flashcards['card-stale'].reviews).toBe(7);
    }, 10_000);

    it('preserves a newer restored presentation when an older rating consumes its admitted owner', async () => {
      const data = makeStore({ version: 3 });
      const ownerPath = ['meta', 'reviewPresentations', 'future'];
      data.meta.reviewPresentations = { future: { id: 'old-owner', cardId: 'a' } };
      writeFlashcardsFile(tempDir.tmpDir, data);
      const original = await loadFlashcards();
      const stale: StorePatch = { baseRev: original.rev ?? 0, entries: [{
        path: ownerPath, before: data.meta.reviewPresentations.future, after: undefined,
        condition: { path: [...ownerPath, 'id'], equals: 'old-owner' },
      }] };
      await saveFlashcardPatch(patchFor([{ path: ownerPath, before: data.meta.reviewPresentations.future,
        after: { id: 'new-owner', cardId: 'b', scaffolds: { 'provided-access:future:cue': true } } }], original.rev ?? 0));
      await saveFlashcardPatch(stale);
      const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8')) as FlashcardStore;
      expect(persisted.meta.reviewPresentations?.future).toEqual({ id: 'new-owner', cardId: 'b',
        scaffolds: { 'provided-access:future:cue': true } });
      await saveFlashcardPatch({ baseRev: persisted.rev ?? 0, entries: [{ ...stale.entries[0],
        condition: { path: [...ownerPath, 'id'], equals: 'new-owner' } }] });
      expect((await loadFlashcards()).meta.reviewPresentations?.future).toBeUndefined();
    });

    it('applies to a cold cache by loading the store from disk first', async () => {
      const card = makeFlashcard('card-cold', { reviews: 1 });
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ flashcards: { 'card-cold': card }, version: 3 }));
      invalidateFlashcardsCache();

      const patch = patchFor([{ path: ['flashcards', 'card-cold'], before: card, after: { ...card, reviews: 3 } }], 0);
      await saveFlashcardPatch(patch);

      const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8')) as FlashcardStore;
      expect(persisted.flashcards['card-cold'].reviews).toBe(3);
    }, 10_000);

    it('keeps the authoritative cache unchanged on disk failure and permits the same patch to retry', async () => {
      const card = makeFlashcard('retry-card', { reviews: 1 });
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ flashcards: { [card.id]: card }, version: 3 }));
      const before = structuredClone(await loadFlashcards());
      const patch = patchFor([{ path: ['flashcards', card.id], before: card, after: { ...card, reviews: 2 } }], before.rev ?? 0);
      vi.spyOn(fs.promises, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
      await expect(saveFlashcardPatch(patch)).rejects.toThrow('disk full');
      expect(await loadFlashcards()).toEqual(before);
      await expect(saveFlashcardPatch(patch)).resolves.toBe((before.rev ?? 0) + 1);
      invalidateFlashcardsCache();
      expect((await loadFlashcards()).flashcards[card.id].reviews).toBe(2);
    });

    it('rebases a queued patch onto the full-store write that finishes ahead of it', async () => {
      const card = makeFlashcard('queued-card', { reviews: 1 });
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ flashcards: { [card.id]: card }, version: 3 }));
      const before = structuredClone(await loadFlashcards());
      const next = structuredClone(before);
      next.meta.maxReviewsPerDay = 37;
      const first = saveFlashcards(next);
      const second = saveFlashcardPatch(patchFor([
        { path: ['flashcards', card.id], before: card, after: { ...card, reviews: 2 } },
      ], before.rev ?? 0));
      await expect(Promise.all([first, second])).resolves.toEqual([(before.rev ?? 0) + 1, (before.rev ?? 0) + 2]);
      const result = await loadFlashcards();
      expect(result.meta.maxReviewsPerDay).toBe(37);
      expect(result.flashcards[card.id].reviews).toBe(2);
    });

    it('serializes concurrent patches without losing any of them', async () => {
      const card = makeFlashcard('card-serial', { reviews: 0 });
      writeFlashcardsFile(tempDir.tmpDir, makeStore({ flashcards: { 'card-serial': card }, version: 3 }));
      const store = await loadFlashcards();

      const first = saveFlashcardPatch(patchFor(
        [{ path: ['flashcards', 'card-serial'], before: card, after: { ...card, reviews: 1 } }], store.rev ?? 0,
      ));
      const second = saveFlashcardPatch(patchFor(
        [{ path: ['flashcards', 'card-serial'], before: { ...card, reviews: 1 }, after: { ...card, reviews: 2 } }],
        (store.rev ?? 0) + 1,
      ));
      await Promise.all([first, second]);

      const persisted = JSON.parse(fs.readFileSync(path.join(tempDir.tmpDir, 'flashcards.json'), 'utf-8')) as FlashcardStore;
      expect(persisted.flashcards['card-serial'].reviews).toBe(2);
    }, 10_000);
  });
});
