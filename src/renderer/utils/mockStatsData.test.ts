import { describe, expect, it } from 'vitest';
import { generateCohortKnowledgeEvents, generateKnowledgeEvents } from './mockStatsData';
import { replayKnowledgeHistory } from './knowledgeHistory';
import { normalizedStrength } from '../../shared/utils/knowledgeStrength';

const NOW = 200_000_000_000;
const WORDS = Array.from({ length: 40 }, (_, i) => `gen-word-${i}`);

describe('generateKnowledgeEvents', () => {
  it('is deterministic for a fixed seed', () => {
    const a = generateKnowledgeEvents(WORDS, { seed: 7, now: NOW });
    const b = generateKnowledgeEvents(WORDS, { seed: 7, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('differs across seeds', () => {
    const a = generateKnowledgeEvents(WORDS, { seed: 7, now: NOW });
    const b = generateKnowledgeEvents(WORDS, { seed: 8, now: NOW });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('replays every word to its final event strength', () => {
    const log = generateKnowledgeEvents(WORDS, { seed: 1, now: NOW });
    for (const events of Object.values(log)) {
      const meaning = events.filter((e) => e.aspect === 'meaning');
      const { points } = replayKnowledgeHistory(meaning, { now: NOW });
      const last = meaning.reduce((a, b) => (b.t >= a.t ? b : a));
      const expected = typeof last.easeAfter === 'number'
        ? normalizedStrength(last.easeAfter * 1000, 1550, 1800)
        : last.toStatus === 'known' ? 1 : last.toStatus === 'learning' ? 0.5 : 0;
      expect(points[points.length - 1].strength).toBeCloseTo(expected, 10);
    }
  });

  it('covers known and lapse-recovery arcs and non-meaning aspects', () => {
    const log = generateKnowledgeEvents(WORDS, { seed: 1, now: NOW });
    const all = Object.values(log).flat();
    expect(all.some((e) => e.kind === 'review' && e.easeAfter !== undefined && e.easeAfter >= 1.8)).toBe(true);
    expect(all.some((e) => e.rating === 'again')).toBe(true);
    expect(all.some((e) => e.aspect === 'reading')).toBe(true);
    expect(all.some((e) => e.aspect === 'prosody')).toBe(true);
    expect(all.every((e) => e.t <= NOW)).toBe(true);
  });
});

describe('generateCohortKnowledgeEvents', () => {
  const DAY = 86_400_000;

  function daysToKnownByMonth(log: Record<string, { t: number; fromStatus?: string; toStatus?: string }[]>): Map<number, number[]> {
    const byMonth = new Map<number, number[]>();
    for (const events of Object.values(log)) {
      const learning = events.find((e) => e.toStatus === 'learning');
      const known = events.find((e) => e.toStatus === 'known');
      if (!learning || !known) continue;
      const month = Math.floor((NOW - learning.t) / (30 * DAY));
      const days = (known.t - learning.t) / DAY;
      byMonth.set(month, [...(byMonth.get(month) ?? []), days]);
    }
    return byMonth;
  }

  function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  it('is deterministic for a fixed seed and spans multiple months', () => {
    const a = generateCohortKnowledgeEvents({ seed: 3, now: NOW, language: 'ja' });
    const b = generateCohortKnowledgeEvents({ seed: 3, now: NOW, language: 'ja' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const byMonth = daysToKnownByMonth(a);
    expect(byMonth.size).toBeGreaterThanOrEqual(4);
  });

  it('newer cohorts reach known faster (different known-answer medians)', () => {
    const log = generateCohortKnowledgeEvents({ seed: 3, now: NOW, language: 'ja' });
    const byMonth = daysToKnownByMonth(log);
    const months = [...byMonth.keys()].sort((x, y) => y - x);
    const oldest = median(byMonth.get(months[0])!);
    const newest = median(byMonth.get(months[months.length - 1])!);
    expect(newest).toBeLessThan(oldest);
  });

  it('includes within-30d lapse arcs after known for retention signal', () => {
    const log = generateCohortKnowledgeEvents({ seed: 3, now: NOW, language: 'ja' });
    const all = Object.values(log).flat();
    expect(all.some((e) => e.fromStatus === 'known' && e.toStatus === 'learning')).toBe(true);
    expect(all.every((e) => e.t <= NOW)).toBe(true);
  });
});
