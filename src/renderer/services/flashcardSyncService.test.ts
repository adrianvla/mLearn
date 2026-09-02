// @vitest-environment happy-dom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  splitTextIntoChunks,
  toUniqueIdentifier,
  mergeFlashcards,
} from './flashcardSyncService';
import { toUniqueIdentifier as statsToUniqueIdentifier } from './statsService';
import type { FlashcardStore, Flashcard, LanguageDataMap } from '../../shared/types';
import { clearMappingTables, registerMappingTable } from '../../shared/languageFeatures';

const mockAppendEvents = vi.hoisted(() => vi.fn());

vi.mock('./knowledgeEvents', () => ({
  appendEvents: mockAppendEvents,
}));

beforeEach(() => {
  mockAppendEvents.mockReset();
  mockAppendEvents.mockResolvedValue(undefined);
});
const ZH_LANGUAGE_DATA = {
  zh: {
    legacyCodes: ['zh-Hans', 'zh-Hant'],
    textProcessing: {
      lexemeNormalization: { mappingTableAsset: 'languages/zh.t2s.json' },
    },
  },
} as unknown as LanguageDataMap;

function registerZhMappingTable(): void {
  registerMappingTable('zh', {
    words: { '學習': '学习' },
    chars: { 學: '学', 習: '习' },
  });
}

function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: 'card-id-1',
    content: {
      type: 'word',
      front: 'test',
      back: 'テスト',
    },
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 1000,
    lastReviewed: 0,
    lastUpdated: 1000,
    language: 'ja',
    ...overrides,
  };
}

function makeEmptyStore(): FlashcardStore {
  return {
    flashcards: {},
    wordCandidates: {},
    wordToCardMap: {},
    wordStatsMap: {},
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {},
    grammarKnowledge: {},
    dailyStats: {},
    version: 4,
    suggestedFlashcards: {},
    wordSyncSeen: {},
    meta: {
      perLanguage: {},
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
  };
}

describe('splitTextIntoChunks', () => {
  it('splits text into chunks of the given size', () => {
    const result = splitTextIntoChunks('abcdefgh', 3);
    expect(result).toEqual(['abc', 'def', 'gh']);
  });

  it('returns a single chunk when text is shorter than chunk size', () => {
    const result = splitTextIntoChunks('hi', 100);
    expect(result).toEqual(['hi']);
  });

  it('returns a single chunk when text length equals chunk size', () => {
    const result = splitTextIntoChunks('abc', 3);
    expect(result).toEqual(['abc']);
  });

  it('returns empty array for empty string', () => {
    const result = splitTextIntoChunks('', 10);
    expect(result).toEqual([]);
  });

  it('uses default chunk size of 16000 when not specified', () => {
    const text = 'x'.repeat(32001);
    const chunks = splitTextIntoChunks(text);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(16000);
    expect(chunks[1].length).toBe(16000);
    expect(chunks[2].length).toBe(1);
  });

  it('reassembled chunks equal the original text', () => {
    const original = 'Hello World from vitest!';
    const chunks = splitTextIntoChunks(original, 5);
    expect(chunks.join('')).toBe(original);
  });

  it('throws TypeError when first argument is not a string', () => {
    expect(() => splitTextIntoChunks(42 as unknown as string, 10)).toThrow(TypeError);
    expect(() => splitTextIntoChunks(42 as unknown as string, 10)).toThrow('First argument must be a string');
  });

  it('throws RangeError when chunk size is zero', () => {
    expect(() => splitTextIntoChunks('abc', 0)).toThrow(RangeError);
  });

  it('throws RangeError when chunk size is negative', () => {
    expect(() => splitTextIntoChunks('abc', -1)).toThrow(RangeError);
  });

  it('throws RangeError when chunk size is not a number', () => {
    expect(() => splitTextIntoChunks('abc', 'ten' as unknown as number)).toThrow(RangeError);
  });
});

describe('toUniqueIdentifier', () => {
  it('returns a 64-character hex string for a given word', async () => {
    const hash = await toUniqueIdentifier('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('returns same hash for same input', async () => {
    const hash1 = await toUniqueIdentifier('test');
    const hash2 = await toUniqueIdentifier('test');
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different inputs', async () => {
    const hash1 = await toUniqueIdentifier('foo');
    const hash2 = await toUniqueIdentifier('bar');
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty string', async () => {
    const hash = await toUniqueIdentifier('');
    expect(hash).toHaveLength(64);
  });

  it('handles unicode/CJK characters', async () => {
    const hash = await toUniqueIdentifier('日本語');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('returns the exact pinned SHA-256 hex digest for fixed inputs (drift guard)', async () => {
    expect(await toUniqueIdentifier('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(await toUniqueIdentifier('日本語')).toBe('77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5');
    expect(await toUniqueIdentifier('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('is the full hash whose first 16 chars equal the statsService card ID (cross-wire guard)', async () => {
    for (const word of ['hello', '日本語', '']) {
      expect((await toUniqueIdentifier(word)).slice(0, 16)).toBe(await statsToUniqueIdentifier(word));
    }
  });
});

describe('mergeFlashcards', () => {
  it('returns local store unchanged when remote store is empty', async () => {
    const local = makeEmptyStore();
    const card = makeFlashcard({ id: 'card-1', content: { type: 'word', front: 'local', back: 'local-back' } });
    local.flashcards['card-1'] = card;

    const remote = makeEmptyStore();
    const merged = await mergeFlashcards(local, remote);

    expect(Object.keys(merged.flashcards)).toHaveLength(1);
    expect(merged.flashcards['card-1']).toBeDefined();
  });

  it('adds remote-only cards to the merged store', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    const remoteCard = makeFlashcard({ id: 'remote-card', content: { type: 'word', front: 'remote', back: 'back' } });
    remote.flashcards['remote-card'] = remoteCard;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.flashcards['remote-card']).toBeDefined();
    expect(merged.flashcards['remote-card'].content.front).toBe('remote');
  });

  it('keeps all local and remote cards when they have different ids', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.flashcards['local-card'] = makeFlashcard({ id: 'local-card', content: { type: 'word', front: 'local', back: 'l' } });
    remote.flashcards['remote-card'] = makeFlashcard({ id: 'remote-card', content: { type: 'word', front: 'remote', back: 'r' } });

    const merged = await mergeFlashcards(local, remote);

    expect(Object.keys(merged.flashcards)).toHaveLength(2);
  });

  it('keeps remote card when remote has more reviews', async () => {
    const cardId = 'shared-card';
    const localCard = makeFlashcard({ id: cardId, reviews: 2, lastUpdated: 1000, content: { type: 'word', front: 'word', back: 'local-back' } });
    const remoteCard = makeFlashcard({ id: cardId, reviews: 5, lastUpdated: 2000, content: { type: 'word', front: 'word', back: 'remote-back' } });

    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.flashcards[cardId] = localCard;
    remote.flashcards[cardId] = remoteCard;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.flashcards[cardId].reviews).toBe(5);
  });

  it('keeps local card SRS data when local has more reviews', async () => {
    const cardId = 'shared-card';
    const localCard = makeFlashcard({ id: cardId, reviews: 10, lastUpdated: 2000, ease: 3.0, content: { type: 'word', front: 'word', back: 'l' } });
    const remoteCard = makeFlashcard({ id: cardId, reviews: 2, lastUpdated: 1000, ease: 1.5, content: { type: 'word', front: 'word', back: 'r' } });

    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.flashcards[cardId] = localCard;
    remote.flashcards[cardId] = remoteCard;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.flashcards[cardId].ease).toBe(3.0);
    expect(merged.flashcards[cardId].reviews).toBe(10);
  });

  it('merges content when remote has longer example than local', async () => {
    const cardId = 'card';
    const shortExample = 'short';
    const longExample = 'this is a much longer example sentence that should win';
    const localCard = makeFlashcard({ id: cardId, reviews: 5, lastUpdated: 1000, content: { type: 'word', front: 'w', back: 'b', example: shortExample } });
    const remoteCard = makeFlashcard({ id: cardId, reviews: 5, lastUpdated: 2000, content: { type: 'word', front: 'w', back: 'b', example: longExample } });

    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.flashcards[cardId] = localCard;
    remote.flashcards[cardId] = remoteCard;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.flashcards[cardId].content.example).toBe(longExample);
  });

  it('keeps local example when local example is longer', async () => {
    const cardId = 'card';
    const shortExample = 'short';
    const longExample = 'this is the longer local example sentence';
    const localCard = makeFlashcard({ id: cardId, reviews: 5, lastUpdated: 2000, content: { type: 'word', front: 'w', back: 'b', example: longExample } });
    const remoteCard = makeFlashcard({ id: cardId, reviews: 5, lastUpdated: 1000, content: { type: 'word', front: 'w', back: 'b', example: shortExample } });

    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.flashcards[cardId] = localCard;
    remote.flashcards[cardId] = remoteCard;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.flashcards[cardId].content.example).toBe(longExample);
  });

  it('preserves imageUrl from remote when local has none', async () => {
    const cardId = 'card';
    const localCard = makeFlashcard({ id: cardId, reviews: 5, lastUpdated: 2000, content: { type: 'word', front: 'w', back: 'b' } });
    const remoteCard = makeFlashcard({ id: cardId, reviews: 5, lastUpdated: 2001, content: { type: 'word', front: 'w', back: 'b', imageUrl: 'flashcard-image://abc.jpg' } });

    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.flashcards[cardId] = localCard;
    remote.flashcards[cardId] = remoteCard;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.flashcards[cardId].content.imageUrl).toBe('flashcard-image://abc.jpg');
  });

  it('rebuilds wordToCardMap from merged flashcards', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    const card = makeFlashcard({ id: 'card-1', language: 'ja', content: { type: 'word', front: 'テスト', back: 'test' } });
    remote.flashcards['card-1'] = card;

    const merged = await mergeFlashcards(local, remote);

    const hash = await toUniqueIdentifier('テスト');
    const key = 'ja:' + hash;
    expect(merged.wordToCardMap[key]).toBeDefined();
    expect(merged.wordToCardMap[key]).toContain('card-1');
  });

  it('rebuilds wordStatsMap with correct cardCount', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    const card1 = makeFlashcard({ id: 'c1', language: 'ja', reviews: 3, ease: 2.8, state: 'review', content: { type: 'word', front: '水', back: 'water' } });
    const card2 = makeFlashcard({ id: 'c2', language: 'ja', reviews: 1, ease: 2.0, state: 'learning', content: { type: 'word', front: '水', back: 'water' } });
    local.flashcards['c1'] = card1;
    remote.flashcards['c2'] = card2;

    const merged = await mergeFlashcards(local, remote);

    const hash = await toUniqueIdentifier('水');
    const key = 'ja:' + hash;
    expect(merged.wordStatsMap[key]).toBeDefined();
    expect(merged.wordStatsMap[key].cardCount).toBe(2);
    expect(merged.wordStatsMap[key].bestState).toBe('review');
  });

  it('merges knownUntracked by union', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.knownUntracked['hash-a'] = true;
    remote.knownUntracked['hash-b'] = true;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.knownUntracked['hash-a']).toBe(true);
    expect(merged.knownUntracked['hash-b']).toBe(true);
  });

  it('ingests legacy remote knownUntracked with recoverable word text as known claims', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    remote.knownUntracked['ja:h1'] = true;
    remote.ignoredWords['ja:h1'] = { word: '学校', language: 'ja', ignoredAt: 1 };

    const merged = await mergeFlashcards(local, remote);

    expect(merged.knownUntracked['ja:h1']).toBeUndefined();
    expect(merged.wordKnowledge['ja:h1']).toMatchObject({ word: '学校', claim: 'known' });
  });

  it('merges wordKnowledge per-entry LWW with claim timestamps winning', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.wordKnowledge['ja:h1'] = { word: '学校', language: 'ja', ease: 2.5, lastSeen: 10, timesSeen: 5, timesHovered: 0, claim: 'known', claimAt: 100 };
    remote.wordKnowledge['ja:h1'] = { word: '学校', language: 'ja', ease: 1.0, lastSeen: 99, timesSeen: 5, timesHovered: 0, lastStatusChange: 99 };
    local.wordKnowledge['ja:h2'] = { word: '町', language: 'ja', ease: 1.0, lastSeen: 5, timesSeen: 1, timesHovered: 0 };
    remote.wordKnowledge['ja:h2'] = { word: '町', language: 'ja', ease: 2.6, lastSeen: 50, timesSeen: 9, timesHovered: 0, lastStatusChange: 50 };

    const merged = await mergeFlashcards(local, remote);

    // Local claim (100) outranks the remote status change (99).
    expect(merged.wordKnowledge['ja:h1']?.ease).toBe(2.5);
    // Remote evidence (50) outranks the stale local entry (5).
    expect(merged.wordKnowledge['ja:h2']?.ease).toBe(2.6);
  });

  it('does not add knownUntracked entries with falsy value', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    remote.knownUntracked['hash-false'] = false;

    const merged = await mergeFlashcards(local, remote);

    expect(merged.knownUntracked['hash-false']).toBeUndefined();
  });

  it('merges wordCandidates by taking max count and latest lastSeen', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    local.wordCandidates['key1'] = { word: 'word', count: 3, lastSeen: 1000 };
    remote.wordCandidates['key1'] = { word: 'word', count: 5, lastSeen: 500 };

    const merged = await mergeFlashcards(local, remote);

    expect(merged.wordCandidates['key1'].count).toBe(5);
    expect(merged.wordCandidates['key1'].lastSeen).toBe(1000);
  });

  it('adds remote-only wordCandidates', async () => {
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    remote.wordCandidates['new-key'] = { word: 'newword', count: 2, lastSeen: 9999 };

    const merged = await mergeFlashcards(local, remote);

    expect(merged.wordCandidates['new-key']).toBeDefined();
    expect(merged.wordCandidates['new-key'].count).toBe(2);
  });

  it('does not mutate the local store', async () => {
    const local = makeEmptyStore();
    const localCard = makeFlashcard({ id: 'c1', content: { type: 'word', front: 'local', back: 'b' } });
    local.flashcards['c1'] = localCard;

    const remote = makeEmptyStore();
    const remoteCard = makeFlashcard({ id: 'c2', content: { type: 'word', front: 'remote', back: 'r' } });
    remote.flashcards['c2'] = remoteCard;

    const originalFlashcardKeys = Object.keys(local.flashcards).length;
    await mergeFlashcards(local, remote);

    expect(Object.keys(local.flashcards).length).toBe(originalFlashcardKeys);
  });

  it('handles cards without a language field using an undetermined language key', async () => {
    const local = makeEmptyStore();
    const card = makeFlashcard({ id: 'no-lang', language: undefined, content: { type: 'word', front: 'test', back: 'b' } });
    delete card.language;
    local.flashcards['no-lang'] = card;

    const remote = makeEmptyStore();
    const merged = await mergeFlashcards(local, remote);

    const hash = await toUniqueIdentifier('test');
    const undeterminedKey = 'und:' + hash;
    expect(merged.wordToCardMap[undeterminedKey]).toBeDefined();
  });

  describe('sync journal ingestion (REQ59)', () => {
    it('journals applied remote epistemic state as passive rollup + manual claim', async () => {
      const local = makeEmptyStore();
      const remote = makeEmptyStore();
      remote.wordKnowledge['ja:h1'] = {
        word: '学校', language: 'ja',
        ease: 4.2, lastSeen: 400, timesSeen: 7, timesHovered: 1,
        claim: 'known', claimAt: 500,
        hasActiveEvidence: true, lastEvidenceSource: 'srs', lastStatusChange: 450,
      };

      const merged = await mergeFlashcards(local, remote);

      expect(merged.wordKnowledge['ja:h1']).toMatchObject({ ease: 4.2, claim: 'known', claimAt: 500 });
      expect(merged.wordKnowledge['ja:h1']?.hasActiveEvidence).toBeUndefined();
      expect(merged.wordKnowledge['ja:h1']?.lastStatusChange).toBeUndefined();
      expect(mockAppendEvents).toHaveBeenCalledTimes(1);
      const journal = mockAppendEvents.mock.calls[0][0] as Record<string, Array<Record<string, unknown>>>;
      expect(journal['ja:h1']).toHaveLength(2);
      expect(journal['ja:h1'][0]).toMatchObject({
        t: 400, kind: 'rollup', source: 'passiveTracking', aspect: 'meaning', easeAfter: 4.2, origin: 'sync',
      });
      expect(journal['ja:h1'][1]).toMatchObject({
        t: 500, kind: 'claim', source: 'manual', aspect: 'meaning', origin: 'sync', toStatus: 'known',
      });
    });

    it('does not journal keys where the local entry wins the LWW', async () => {
      const local = makeEmptyStore();
      const remote = makeEmptyStore();
      local.wordKnowledge['ja:h1'] = { word: '学校', language: 'ja', ease: 2.5, lastSeen: 10, timesSeen: 5, timesHovered: 0, claim: 'known', claimAt: 100 };
      remote.wordKnowledge['ja:h1'] = { word: '学校', language: 'ja', ease: 1.0, lastSeen: 99, timesSeen: 5, timesHovered: 0, lastStatusChange: 99 };

      await mergeFlashcards(local, remote);

      expect(mockAppendEvents).not.toHaveBeenCalled();
    });

    it('journals the synthesized claim for legacy knownUntracked ingestion', async () => {
      const local = makeEmptyStore();
      const remote = makeEmptyStore();
      remote.knownUntracked['ja:h1'] = true;
      remote.ignoredWords['ja:h1'] = { word: '学校', language: 'ja', ignoredAt: 1 };

      await mergeFlashcards(local, remote);

      const journal = mockAppendEvents.mock.calls[0][0] as Record<string, Array<Record<string, unknown>>>;
      const claim = journal['ja:h1']?.find((event) => event.kind === 'claim');
      expect(claim).toMatchObject({
        kind: 'claim', source: 'manual', aspect: 'meaning', origin: 'sync', toStatus: 'known',
      });
      expect(typeof claim?.t).toBe('number');
    });
  });

  it('skips cards with empty front in wordToCardMap rebuild', async () => {
    const local = makeEmptyStore();
    const card = makeFlashcard({ id: 'empty-front', content: { type: 'word', front: '', back: 'b' } });
    local.flashcards['empty-front'] = card;

    const remote = makeEmptyStore();
    const merged = await mergeFlashcards(local, remote);

    expect(Object.keys(merged.wordToCardMap)).toHaveLength(0);
  });

  it('normalizes legacy-language cards and canonicalizes their keys when the mapping table is registered', async () => {
    registerZhMappingTable();
    const remote = makeEmptyStore();
    remote.flashcards['traditional-card'] = makeFlashcard({
      id: 'traditional-card',
      language: 'zh-Hant',
      content: { type: 'word', front: '學習', back: 'to study' },
    });

    const merged = await mergeFlashcards(makeEmptyStore(), remote, { languageData: ZH_LANGUAGE_DATA });
    const key = `zh:${await toUniqueIdentifier('学习')}`;

    expect(merged.flashcards['traditional-card'].language).toBe('zh');
    expect(merged.wordToCardMap[key]).toEqual(['traditional-card']);
    expect(Object.keys(merged.wordToCardMap)).toEqual([key]);
    clearMappingTables();
  });

  it('merges canonical collisions into one card and archives the loser snapshot', async () => {
    registerZhMappingTable();
    const local = makeEmptyStore();
    const remote = makeEmptyStore();
    const archived: unknown[] = [];
    local.flashcards.local = makeFlashcard({
      id: 'local',
      language: 'zh',
      state: 'review',
      ease: 3,
      interval: 500,
      learningStep: 2,
      dueDate: 300,
      reviews: 10,
      lapses: 2,
      createdAt: 200,
      lastReviewed: 2000,
      lastUpdated: 2000,
      tags: ['local'],
      buried: true,
      content: { type: 'word', front: '学习', back: 'study' },
    });
    remote.flashcards.remote = makeFlashcard({
      id: 'remote',
      language: 'zh-Hant',
      state: 'learning',
      ease: 1.5,
      interval: 10,
      learningStep: 1,
      dueDate: 100,
      reviews: 3,
      lapses: 4,
      createdAt: 100,
      lastReviewed: 1000,
      lastUpdated: 3000,
      tags: ['remote'],
      suspended: true,
      content: { type: 'word', front: '學習', back: 'study traditional' },
    });

    const merged = await mergeFlashcards(local, remote, {
      languageData: ZH_LANGUAGE_DATA,
      onCardCollision: (entry) => archived.push(entry),
    });
    const key = `zh:${await toUniqueIdentifier('学习')}`;

    expect(merged.flashcards).toEqual({
      local: expect.objectContaining({
        id: 'local',
        content: { type: 'word', front: '学习', back: 'study' },
        state: 'review',
        ease: 3,
        interval: 500,
        learningStep: 2,
        dueDate: 100,
        lastReviewed: 2000,
        createdAt: 100,
        reviews: 13,
        lapses: 6,
        tags: expect.arrayContaining(['local', 'remote']),
        suspended: true,
        buried: true,
      }),
    });
    expect(merged.wordToCardMap[key]).toEqual(['local']);
    expect(archived).toEqual([
      expect.objectContaining({ source: 'sync-merge', survivorId: 'local', loser: remote.flashcards.remote }),
    ]);
    clearMappingTables();
  });

  it('preserves the previous byte-identical key behavior for non-variant languages', async () => {
    const local = makeEmptyStore();
    local.flashcards.ja = makeFlashcard({
      id: 'ja',
      language: 'ja',
      content: { type: 'word', front: '日本語', back: 'Japanese' },
    });

    const merged = await mergeFlashcards(local, makeEmptyStore(), { languageData: ZH_LANGUAGE_DATA });
    const previousKey = `ja:${await toUniqueIdentifier('日本語')}`;

    expect(Object.keys(merged.wordToCardMap)).toEqual([previousKey]);
    expect(merged.wordToCardMap[previousKey]).toEqual(['ja']);
  });
});
