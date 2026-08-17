import { describe, expect, it } from 'vitest';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import { replayKnowledgeHistory } from '../utils/knowledgeHistory';
import { acquisitionSlope, daysToStableKnown, retentionAfterKnown, unifyEventLogByWord } from './learningAnalytics';

const DAY = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 1);

function event(day: number, overrides: Partial<KnowledgeEvent> = {}): KnowledgeEvent {
  return {
    t: start + day * DAY,
    kind: 'status',
    source: 'manual',
    aspect: 'meaning',
    ...overrides,
  };
}

describe('learning analytics cohorts', () => {
  it('computes the median days to stable known for a monthly cohort', () => {
    const eventsByWord = new Map([
      ['one', [event(0), event(5, { toStatus: 'known' })]],
      ['two', [event(0), event(9, { toStatus: 'known' })]],
    ]);

    expect(daysToStableKnown(eventsByWord)).toEqual([{ month: '2026-01', medianDays: 7, wordCount: 2 }]);
  });

  it('uses the next known-reaching event after a lapse', () => {
    const eventsByWord = new Map([
      ['one', [
        event(0),
        event(5, { toStatus: 'known' }),
        event(10, { fromStatus: 'known', toStatus: 'learning' }),
        event(40, { toStatus: 'known' }),
      ]],
    ]);

    expect(daysToStableKnown(eventsByWord)).toEqual([{ month: '2026-01', medianDays: 40, wordCount: 1 }]);
  });

  it('excludes recent known words and counts lapses during the 30-day retention window', () => {
    const now = start + 50 * DAY;
    const eventsByWord = new Map([
      ['recent', [event(0), event(40, { toStatus: 'known' })]],
      ['lapsed', [event(0), event(5, { toStatus: 'known' }), event(25, { fromStatus: 'known', toStatus: 'learning' })]],
    ]);

    expect(retentionAfterKnown(eventsByWord, now)).toEqual([{ month: '2026-01', lapseRate: 1, knownWordCount: 1 }]);
  });

  it('measures 14-day strength gain through the history replay', () => {
    const events = [event(0, { easeAfter: 1.3 }), event(14, { easeAfter: 1.8 })];
    const expected = replayKnowledgeHistory(events, { now: start + 14 * DAY }).points;
    const eventsByWord = new Map([['one', events]]);

    expect(acquisitionSlope(eventsByWord)).toEqual([{
      month: '2026-01',
      medianSlope: expected[1].strength - expected[0].strength,
      wordCount: 1,
    }]);
  });

  it('derives known and lapse transitions from anki review ease and rating', () => {
    const now = start + 90 * DAY;
    const ankiReview = (day: number, overrides: Partial<KnowledgeEvent> = {}): KnowledgeEvent =>
      event(day, { kind: 'review', source: 'anki', ...overrides });
    const eventsByWord = new Map([
      ['matured', [ankiReview(0, { easeAfter: 1400 }), ankiReview(20, { easeAfter: 1900 })]],
      ['lapsed', [ankiReview(0, { easeAfter: 2000 }), ankiReview(15, { rating: 'again', easeAfter: 1700 })]],
      ['learning', [ankiReview(0, { easeAfter: 1500 }), ankiReview(10, { easeAfter: 1650 })]],
    ]);

    expect(daysToStableKnown(eventsByWord)).toEqual([
      { month: '2026-01', medianDays: 20, wordCount: 1 },
    ]);
    expect(retentionAfterKnown(eventsByWord, now)).toEqual([
      { month: '2026-01', lapseRate: 0.5, knownWordCount: 2 },
    ]);
  });

  it('returns empty cohorts for an empty input', () => {
    const eventsByWord = new Map<string, readonly KnowledgeEvent[]>();

    expect(daysToStableKnown(eventsByWord)).toEqual([]);
    expect(acquisitionSlope(eventsByWord)).toEqual([]);
    expect(retentionAfterKnown(eventsByWord, start)).toEqual([]);
  });
});

describe('unifyEventLogByWord', () => {
  const family = ['ja:a-hash', 'ja:b-hash'];

  it('merges form-hash keys of one word into a single cohort sample', () => {
    // One pill write fans out to both surface hashes of the same word (#230):
    // per-key aggregation would count this word twice.
    const log = {
      'ja:a-hash': [event(0), event(5, { toStatus: 'known' })],
      'ja:b-hash': [event(0), event(5, { toStatus: 'known' })],
    };

    const unified = unifyEventLogByWord(log, () => family);
    expect(unified.size).toBe(1);

    expect(daysToStableKnown(unified)).toEqual([
      { month: '2026-01', medianDays: 5, wordCount: 1 },
    ]);
  });

  it('keeps keys without a word or family as their own group', () => {
    const log = {
      'ja:a-hash': [event(0)],
      'ja:lonely': [event(1)],
    };

    const unified = unifyEventLogByWord(log, (key) => (key === 'ja:a-hash' ? family : undefined));
    expect(unified.size).toBe(2);
    // The family member absent from the log must not create an empty group.
    expect(unified.get('ja:a-hash')).toHaveLength(1);
    expect(unified.get('ja:lonely')).toHaveLength(1);
  });
});
