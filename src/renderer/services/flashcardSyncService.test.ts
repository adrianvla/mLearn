// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  splitTextIntoChunks,
  splitForQR,
  toUniqueIdentifier,
  mergeFlashcards,
  ChunkCollector,
  sendChunkedWithBackpressure,
} from './flashcardSyncService';
import type { FlashcardStore, Flashcard } from './flashcardSyncService';

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

describe('splitForQR', () => {
  it('splits a short string into approximately QR_CHUNK_SIZE=60 char chunks', () => {
    const data = 'x'.repeat(180);
    const chunks = splitForQR(data);
    expect(chunks.length).toBe(3);
    chunks.forEach(c => expect(c.length).toBeLessThanOrEqual(60));
  });

  it('reassembled chunks equal original data', () => {
    const data = 'a'.repeat(200);
    const chunks = splitForQR(data);
    expect(chunks.join('')).toBe(data);
  });

  it('returns single chunk when data is shorter than QR_CHUNK_SIZE', () => {
    const data = 'short';
    const chunks = splitForQR(data);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(data);
  });

  it('handles empty string', () => {
    const chunks = splitForQR('');
    expect(chunks).toEqual([]);
  });

  it('handles data of exactly QR_CHUNK_SIZE characters', () => {
    const data = 'z'.repeat(60);
    const chunks = splitForQR(data);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(data);
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

  it('handles cards without a language field using DEFAULT_SETTINGS language', async () => {
    const local = makeEmptyStore();
    const card = makeFlashcard({ id: 'no-lang', language: undefined, content: { type: 'word', front: 'test', back: 'b' } });
    delete card.language;
    local.flashcards['no-lang'] = card;

    const remote = makeEmptyStore();
    const merged = await mergeFlashcards(local, remote);

    const hash = await toUniqueIdentifier('test');
    const jaKey = 'ja:' + hash;
    expect(merged.wordToCardMap[jaKey]).toBeDefined();
  });

  it('skips cards with empty front in wordToCardMap rebuild', async () => {
    const local = makeEmptyStore();
    const card = makeFlashcard({ id: 'empty-front', content: { type: 'word', front: '', back: 'b' } });
    local.flashcards['empty-front'] = card;

    const remote = makeEmptyStore();
    const merged = await mergeFlashcards(local, remote);

    expect(Object.keys(merged.wordToCardMap)).toHaveLength(0);
  });
});

describe('ChunkCollector', () => {
  it('isComplete returns false before any chunks are added', () => {
    const collector = new ChunkCollector();
    expect(collector.isComplete()).toBe(false);
  });

  it('isComplete returns true when all chunks are added', () => {
    const collector = new ChunkCollector();
    collector.addChunk(0, 'part0', 2);
    expect(collector.isComplete()).toBe(false);
    collector.addChunk(1, 'part1', 2);
    expect(collector.isComplete()).toBe(true);
  });

  it('addChunk returns true when collection becomes complete', () => {
    const collector = new ChunkCollector();
    collector.addChunk(0, 'a', 2);
    const done = collector.addChunk(1, 'b', 2);
    expect(done).toBe(true);
  });

  it('addChunk returns false when collection is not yet complete', () => {
    const collector = new ChunkCollector();
    const done = collector.addChunk(0, 'a', 3);
    expect(done).toBe(false);
  });

  it('getProgress returns current and total chunk counts', () => {
    const collector = new ChunkCollector();
    collector.addChunk(0, 'x', 3);
    collector.addChunk(2, 'z', 3);
    const progress = collector.getProgress();
    expect(progress.current).toBe(2);
    expect(progress.total).toBe(3);
  });

  it('getProgress returns {current:0, total:0} before any chunks', () => {
    const collector = new ChunkCollector();
    const progress = collector.getProgress();
    expect(progress.current).toBe(0);
    expect(progress.total).toBe(0);
  });

  it('assemble returns chunks joined in index order', () => {
    const collector = new ChunkCollector();
    collector.addChunk(1, 'World', 3);
    collector.addChunk(0, 'Hello ', 3);
    collector.addChunk(2, '!', 3);
    expect(collector.assemble()).toBe('Hello World!');
  });

  it('assemble throws when a chunk is missing', () => {
    const collector = new ChunkCollector();
    collector.addChunk(0, 'part0', 3);
    collector.addChunk(2, 'part2', 3);
    expect(() => collector.assemble()).toThrow('Missing chunk 1');
  });

  it('reset clears all chunks and totalChunks', () => {
    const collector = new ChunkCollector();
    collector.addChunk(0, 'data', 2);
    collector.addChunk(1, 'more', 2);
    collector.reset();
    expect(collector.isComplete()).toBe(false);
    const progress = collector.getProgress();
    expect(progress.current).toBe(0);
    expect(progress.total).toBe(0);
  });

  it('can be reused after reset', () => {
    const collector = new ChunkCollector();
    collector.addChunk(0, 'first', 1);
    expect(collector.isComplete()).toBe(true);
    collector.reset();
    collector.addChunk(0, 'second', 1);
    expect(collector.assemble()).toBe('second');
  });

  it('single chunk collection assembles correctly', () => {
    const collector = new ChunkCollector();
    collector.addChunk(0, 'all-in-one', 1);
    expect(collector.isComplete()).toBe(true);
    expect(collector.assemble()).toBe('all-in-one');
  });

  it('handles large number of chunks', () => {
    const collector = new ChunkCollector();
    const total = 100;
    for (let i = 0; i < total; i++) {
      collector.addChunk(i, String(i).padStart(3, '0'), total);
    }
    expect(collector.isComplete()).toBe(true);
    const assembled = collector.assemble();
    expect(assembled).toBe(Array.from({ length: total }, (_, i) => String(i).padStart(3, '0')).join(''));
  });
});

describe('sendChunkedWithBackpressure', () => {
  function makeMockPeer() {
    const sentMessages: string[] = [];
    const channel = { bufferedAmount: 0 } as unknown as RTCDataChannel;
    const peer = {
      send: vi.fn((data: string | ArrayBuffer) => {
        sentMessages.push(data as string);
      }),
      signal: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      connected: true,
      _channel: channel,
    } as unknown as SimplePeerInstance;
    return { peer, sentMessages, channel };
  }

  it('sends multiple chunks for payload larger than CHUNK_SIZE (16000 chars)', async () => {
    const { peer, sentMessages } = makeMockPeer();
    const payload = 'a'.repeat(32001);

    await sendChunkedWithBackpressure(peer, 'sync', payload);

    expect(sentMessages).toHaveLength(3);
    const msg0 = JSON.parse(sentMessages[0]);
    expect(msg0.type).toBe('sync-chunk');
    expect(msg0.data[0]).toBe(0);
    expect(msg0.data[2]).toBe(3);

    const msg1 = JSON.parse(sentMessages[1]);
    expect(msg1.data[0]).toBe(1);
  });

  it('sends a single chunk when payload is shorter than CHUNK_SIZE', async () => {
    const { peer, sentMessages } = makeMockPeer();
    await sendChunkedWithBackpressure(peer, 'flashcard', 'hello');

    expect(sentMessages).toHaveLength(1);
    const msg = JSON.parse(sentMessages[0]);
    expect(msg.type).toBe('flashcard-chunk');
    expect(msg.data[0]).toBe(0);
    expect(msg.data[1]).toBe('hello');
    expect(msg.data[2]).toBe(1);
  });

  it('reassembled chunks equal the original payload', async () => {
    const { peer, sentMessages } = makeMockPeer();
    const payload = 'x'.repeat(40000);

    await sendChunkedWithBackpressure(peer, 'msg', payload);

    const assembled = sentMessages
      .map(m => (JSON.parse(m).data as [number, string, number])[1])
      .join('');
    expect(assembled).toBe(payload);
  });

  it('skips buffer drain when channel bufferedAmount is within threshold', async () => {
    const sentMessages: string[] = [];
    const channel = {
      get bufferedAmount() { return 0; },
    } as unknown as RTCDataChannel;
    const peer = {
      send: vi.fn((data: string | ArrayBuffer) => {
        sentMessages.push(data as string);
      }),
      signal: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      connected: true,
      _channel: channel,
    } as unknown as SimplePeerInstance;

    await sendChunkedWithBackpressure(peer, 'data', 'a'.repeat(32001));

    expect(sentMessages.length).toBeGreaterThan(0);
  });

  it('sends all chunks when no _channel is present on peer', async () => {
    const sentMessages: string[] = [];
    const peer = {
      send: vi.fn((data: string | ArrayBuffer) => { sentMessages.push(data as string); }),
      signal: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
      connected: true,
    } as unknown as SimplePeerInstance;

    await sendChunkedWithBackpressure(peer, 'type', 'abc');

    expect(sentMessages).toHaveLength(1);
  });

  it('sends no messages for empty payload', async () => {
    const { peer, sentMessages } = makeMockPeer();
    await sendChunkedWithBackpressure(peer, 'test', '');
    expect(sentMessages).toHaveLength(0);
  });
});
