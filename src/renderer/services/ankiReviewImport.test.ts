import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashWordSync } from './srsAlgorithm';
import type { AnkiReviewEntry } from '../hooks/useAnki';

const mocks = vi.hoisted(() => ({
  getAnkiWordStatuses: vi.fn(),
  appendEvents: vi.fn().mockResolvedValue(undefined),
  getEventLogForLanguage: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../shared/backends', () => ({
  getBackend: () => ({ getAnkiWordStatuses: mocks.getAnkiWordStatuses }),
}));

vi.mock('./knowledgeEvents', () => ({
  appendEvents: mocks.appendEvents,
  getEventLogForLanguage: mocks.getEventLogForLanguage,
}));

import { importAnkiReviewHistory, mapAnkiGrammarReviews } from './ankiReviewImport';
import type { AnkiCardInfo } from '../hooks/useAnki';

const grammarCard: AnkiCardInfo = {
  cardId: 1, type: 2, queue: 2, due: 1, factor: 2500, interval: 1, note: 1,
  fields: { Front: { value: 'known pattern', order: 0 }, Back: { value: 'explanation', order: 1 } },
};
const grammarReview: AnkiReviewEntry = { id: 123, cid: 1, usn: 0, ease: 3, ivl: 1, lastIvl: 1, factor: 2500, time: 1, type: 1 };

function grammarCardWithSides(question: string, answer: string): AnkiCardInfo {
  return {
    ...grammarCard,
    question,
    answer,
    deckName: 'Japanese::Grammar',
    ord: 2,
  };
}

describe('mapAnkiGrammarReviews', () => {
  it('stays recognition and reports the ambiguity when template sides are unverifiable', () => {
    const result = mapAnkiGrammarReviews({
      language: 'example', grammar: [{ pattern: 'known pattern', meaning: 'x', level: 1 }], card: grammarCard,
      reviews: [grammarReview], existingReviewIdsByTarget: new Map(),
    });
    expect(result.ambiguousProduction).toEqual(['known pattern']);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.targetRef).toMatchObject({ capability: 'grammar-recognition' });
    expect(result.events[0].event.source).toBe('anki');
    expect(result.events[0].event.origin).toBe('anki-review');
    // Idempotent per review and target even when the card is ambiguous.
    expect(mapAnkiGrammarReviews({
      language: 'example', grammar: [{ pattern: 'known pattern', meaning: 'x', level: 1 }], card: grammarCard,
      reviews: [grammarReview], existingReviewIdsByTarget: new Map([[result.events[0].key, new Set([grammarReview.id])]]),
    }).events).toEqual([]);
  });

  it('maps a pattern on the verified question side to recognition only', () => {
    const result = mapAnkiGrammarReviews({
      language: 'example',
      grammar: [{ pattern: 'known pattern', meaning: 'x', level: 1 }],
      card: grammarCardWithSides('<div>known pattern</div>', '<div>explanation</div>'),
      reviews: [grammarReview], existingReviewIdsByTarget: new Map(),
    });
    expect(result.ambiguousProduction).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.targetRef).toMatchObject({ capability: 'grammar-recognition' });
    expect(result.events[0].event.origin).toBe('anki-review');
  });

  it('maps an answer-only pattern to grammar-production when the verified prompt lacks it', () => {
    const result = mapAnkiGrammarReviews({
      language: 'example',
      grammar: [
        { pattern: 'known pattern', meaning: 'x', level: 1 },
        { pattern: 'not on this card', meaning: 'y', level: 2 },
      ],
      card: grammarCardWithSides('<div>Translate into English</div>', '<div>known pattern</div>'),
      reviews: [grammarReview], existingReviewIdsByTarget: new Map(),
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.targetRef).toMatchObject({ capability: 'grammar-production' });
    expect(result.events[0].event.origin).toBe('anki-production-review');
    expect(result.events[0].event.schedulerCardId).toBe('1');
  });

  it('keeps production and recognition idempotence separate per target', () => {
    const targeted = mapAnkiGrammarReviews({
      language: 'example',
      grammar: [{ pattern: 'known pattern', meaning: 'x', level: 1 }],
      card: grammarCardWithSides('<div>Translate into English</div>', '<div>known pattern</div>'),
      reviews: [grammarReview], existingReviewIdsByTarget: new Map(),
    });
    expect(targeted.events).toHaveLength(1);
    const productionKey = targeted.events[0].key;
    // The same review already stored under production must not re-emit there...
    const rerun = mapAnkiGrammarReviews({
      language: 'example',
      grammar: [{ pattern: 'known pattern', meaning: 'x', level: 1 }],
      card: grammarCardWithSides('<div>Translate into English</div>', '<div>known pattern</div>'),
      reviews: [grammarReview],
      existingReviewIdsByTarget: new Map([[productionKey, new Set([grammarReview.id])]]),
    });
    expect(rerun.events).toEqual([]);
    // ...but it is still free to emit under recognition from a different card.
    const recognitionRerun = mapAnkiGrammarReviews({
      language: 'example',
      grammar: [{ pattern: 'known pattern', meaning: 'x', level: 1 }],
      card: grammarCardWithSides('<div>known pattern</div>', '<div>explanation</div>'),
      reviews: [grammarReview],
      existingReviewIdsByTarget: new Map([[productionKey, new Set([grammarReview.id])]]),
    });
    expect(recognitionRerun.events).toHaveLength(1);
    expect(recognitionRerun.events[0].event.targetRef).toMatchObject({ capability: 'grammar-recognition' });
  });

  it('does not fabricate evidence for unmapped cards', () => {
    expect(mapAnkiGrammarReviews({
      language: 'example', grammar: [{ pattern: 'missing', meaning: 'x', level: 1 }], card: grammarCard,
      reviews: [grammarReview], existingReviewIdsByTarget: new Map(),
    }).events).toEqual([]);
  });
});

function review(overrides: Partial<AnkiReviewEntry>): AnkiReviewEntry {
  return {
    id: 1000,
    cid: 1,
    usn: 0,
    ease: 3,
    ivl: 4,
    lastIvl: 1,
    factor: 1800,
    time: 5000,
    type: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getAnkiWordStatuses.mockReset();
  mocks.appendEvents.mockClear();
  mocks.getEventLogForLanguage.mockReset().mockResolvedValue({});
});

describe('importAnkiReviewHistory', () => {
  it('returns zeros without fetching reviews when no words have card ids', async () => {
    mocks.getAnkiWordStatuses.mockResolvedValue([
      { word: 'a', cardId: null },
      { word: 'b' },
    ]);
    const fetchReviews = vi.fn();

    const result = await importAnkiReviewHistory('ja', { fetchReviews });

    expect(result).toEqual({ words: 0, imported: 0, skipped: 0, importedWords: [] });
    expect(fetchReviews).not.toHaveBeenCalled();
    expect(mocks.appendEvents).not.toHaveBeenCalled();
  });

  it('maps revlog entries to anki-domain review events keyed by word hash', async () => {
    mocks.getAnkiWordStatuses.mockResolvedValue([{ word: '食べる', cardId: 11 }]);
    const fetchReviews = vi.fn().mockResolvedValue({
      '11': [review({ id: 2000, cid: 11, ease: 4, ivl: 10, lastIvl: 4, factor: 1950, type: 1 })],
    });

    const result = await importAnkiReviewHistory('ja', { fetchReviews });

    expect(result).toEqual({ words: 1, imported: 1, skipped: 0, importedWords: ['食べる'] });
    const [byKey] = mocks.appendEvents.mock.calls[0];
    const key = `ja:${hashWordSync('食べる')}`;
    expect(Object.keys(byKey)).toEqual([key]);
    expect(byKey[key]).toEqual([{
      t: 2000,
      kind: 'review',
      source: 'anki',
      aspect: 'meaning',
      rating: 'easy',
      intervalBefore: 4,
      intervalAfter: 10,
      easeAfter: 1950, // raw anki factor, not scaled
      easeBefore: undefined,
      ankiReviewId: 2000,
    }]);
  });

  it('chains easeBefore per card, not across a word’s cards', async () => {
    mocks.getAnkiWordStatuses.mockResolvedValue([{ word: 'w', cardId: 1 }, { word: 'w', cardId: 2 }]);
    const fetchReviews = vi.fn().mockResolvedValue({
      // Card 2 sorts first by id but must not inherit card 1's factor chain.
      '1': [
        review({ id: 3000, cid: 1, factor: 1700 }),
        review({ id: 3100, cid: 1, factor: 1600 }),
      ],
      '2': [review({ id: 2000, cid: 2, factor: 2100 })],
    });

    await importAnkiReviewHistory('ja', { fetchReviews });

    const [byKey] = mocks.appendEvents.mock.calls[0];
    const events = byKey[`ja:${hashWordSync('w')}`];
    expect(events.map((e: { t: number }) => e.t)).toEqual([2000, 3000, 3100]);
    expect(events[0].easeBefore).toBeUndefined();
    expect(events[1].easeBefore).toBeUndefined();
    expect(events[2].easeBefore).toBe(1700);
  });

  it('filters filtered/manual revlog types out', async () => {
    mocks.getAnkiWordStatuses.mockResolvedValue([{ word: 'w', cardId: 1 }]);
    const fetchReviews = vi.fn().mockResolvedValue({
      '1': [
        review({ id: 1, type: 0 }),
        review({ id: 2, type: 1 }),
        review({ id: 3, type: 2 }),
        review({ id: 4, type: 3 }),
        review({ id: 5, type: 4 }),
      ],
    });

    const result = await importAnkiReviewHistory('ja', { fetchReviews });

    expect(result.imported).toBe(3);
    expect(result.importedWords).toEqual(['w']);
    const [byKey] = mocks.appendEvents.mock.calls[0];
    expect(byKey[`ja:${hashWordSync('w')}`].map((e: { ankiReviewId: number }) => e.ankiReviewId)).toEqual([1, 2, 3]);
  });

  it('maps all four anki buttons to ratings and omits ease for factor-0 learn entries', async () => {
    mocks.getAnkiWordStatuses.mockResolvedValue([{ word: 'w', cardId: 1 }]);
    const fetchReviews = vi.fn().mockResolvedValue({
      '1': [
        review({ id: 1, ease: 1, factor: 0, type: 0 }),
        review({ id: 2, ease: 2 }),
        review({ id: 3, ease: 3 }),
        review({ id: 4, ease: 4 }),
      ],
    });

    await importAnkiReviewHistory('ja', { fetchReviews });

    const [byKey] = mocks.appendEvents.mock.calls[0];
    const events = byKey[`ja:${hashWordSync('w')}`];
    expect(events.map((e: { rating: string }) => e.rating)).toEqual(['again', 'hard', 'good', 'easy']);
    expect(events[0].easeAfter).toBeUndefined();
    expect(events[0].easeBefore).toBeUndefined(); // factor 0 must not poison the chain
    expect(events[1].easeBefore).toBeUndefined();
  });

  it('re-run skips events whose ankiReviewId is already stored', async () => {
    mocks.getAnkiWordStatuses.mockResolvedValue([{ word: 'w', cardId: 1 }]);
    const fetchReviews = vi.fn().mockResolvedValue({
      '1': [review({ id: 100 }), review({ id: 200 })],
    });
    mocks.getEventLogForLanguage.mockResolvedValue({
      [`ja:${hashWordSync('w')}`]: [{ t: 100, kind: 'review', source: 'anki', aspect: 'meaning', ankiReviewId: 100 }],
    });

    const result = await importAnkiReviewHistory('ja', { fetchReviews });

    expect(result).toEqual({ words: 1, imported: 1, skipped: 1, importedWords: ['w'] });
    const [byKey] = mocks.appendEvents.mock.calls[0];
    expect(byKey[`ja:${hashWordSync('w')}`].map((e: { ankiReviewId: number }) => e.ankiReviewId)).toEqual([200]);
  });

  it('appends nothing when every review is already imported', async () => {
    mocks.getAnkiWordStatuses.mockResolvedValue([{ word: 'w', cardId: 1 }]);
    const fetchReviews = vi.fn().mockResolvedValue({ '1': [review({ id: 100 })] });
    mocks.getEventLogForLanguage.mockResolvedValue({
      [`ja:${hashWordSync('w')}`]: [{ t: 100, kind: 'review', source: 'anki', aspect: 'meaning', ankiReviewId: 100 }],
    });

    const result = await importAnkiReviewHistory('ja', { fetchReviews });

    expect(result).toEqual({ words: 0, imported: 0, skipped: 1, importedWords: [] });
    expect(mocks.appendEvents).not.toHaveBeenCalled();
  });

  it('batches review fetches in chunks of 500 card ids', async () => {
    const statuses = Array.from({ length: 1200 }, (_, i) => ({ word: `w${i}`, cardId: i + 1 }));
    mocks.getAnkiWordStatuses.mockResolvedValue(statuses);
    const fetchReviews = vi.fn().mockResolvedValue({});

    await importAnkiReviewHistory('ja', { fetchReviews });

    expect(fetchReviews).toHaveBeenCalledTimes(3);
    expect(fetchReviews.mock.calls[0][0]).toHaveLength(500);
    expect(fetchReviews.mock.calls[1][0]).toHaveLength(500);
    expect(fetchReviews.mock.calls[2][0]).toHaveLength(200);
  });
});