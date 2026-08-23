import { describe, expect, it } from 'vitest';
import type { FlashcardMeta } from '../types';
import { deriveRetentionSchedule, scheduleAfterAnswer } from './retentionScheduler';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const meta: FlashcardMeta = {
  perLanguage: {}, maxNewCardsPerDay: 20, maxNewCardsPerDayLearning: 20, maxReviewsPerDay: -1,
  learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4,
  newIntervalModifier: 100, reviewIntervalModifier: 100, maxInterval: 36500,
};
const template = { createdAt: 0, initialEase: 2.5 };

describe('RetentionScheduler', () => {
  it('characterizes the legacy good progression through learning into SM-2 review', () => {
    const first = deriveRetentionSchedule(template, [{ t: 100, rating: 'good' }], meta, 100);
    const graduated = deriveRetentionSchedule(template, [{ t: 100, rating: 'good' }, { t: 200, rating: 'good' }], meta, 200);
    const reviewed = deriveRetentionSchedule(template, [{ t: 100, rating: 'good' }, { t: 200, rating: 'good' }, { t: 300, rating: 'good' }], meta, 300);
    expect(first).toMatchObject({ state: 'learning', learningStep: 1, dueAt: 100 + 10 * MINUTE });
    expect(graduated).toMatchObject({ state: 'review', interval: DAY, dueAt: 200 + DAY, reviews: 1 });
    expect(reviewed).toMatchObject({ state: 'review', ease: 2.5, interval: 2.5 * DAY, dueAt: 300 + 2.5 * DAY, reviews: 2 });
  });

  it('replays active evidence identically and drops a retracted last review', () => {
    const active = [{ t: 100, rating: 'good' as const }, { t: 200, rating: 'good' as const }, { t: 300, rating: 'easy' as const }];
    const before = deriveRetentionSchedule(template, active.slice(0, -1), meta, 300);
    const afterRetraction = deriveRetentionSchedule(template, active.slice(0, -1), meta, 300);
    expect(afterRetraction).toEqual(before);
  });

  it('preserves lapse and relearning ladders', () => {
    const review = { state: 'review' as const, ease: 2.5, interval: 10 * DAY, dueAt: 0, reviews: 5, lapses: 0, learningStep: 0, lastReviewed: 0, provenance: 'derived-scheduler-cache' as const };
    const lapse = scheduleAfterAnswer(review, 'again', meta, 100);
    const relearned = scheduleAfterAnswer(lapse, 'good', meta, 200);
    expect(lapse).toMatchObject({ state: 'relearning', lapses: 1, ease: 2.3, interval: 5 * DAY, dueAt: 100 + 10 * MINUTE });
    expect(relearned).toMatchObject({ state: 'review', dueAt: 200 + 5 * DAY });
  });

  it('uses a migrated cache only when no evidence is available', () => {
    const migrated = { state: 'review' as const, ease: 2.1, interval: 3 * DAY, dueAt: 50, reviews: 4, lapses: 1, learningStep: 0, lastReviewed: 20, provenance: 'migrated-scheduler-cache' as const };
    expect(deriveRetentionSchedule(template, [], meta, 100, migrated)).toMatchObject(migrated);
    expect(deriveRetentionSchedule(template, [{ t: 100, rating: 'good' }], meta, 100, migrated)).toMatchObject({ state: 'learning', learningStep: 1 });
  });
});
