import type { FlashcardMeta, RetentionScheduleCache } from '../types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MIN_EASE = 1.3;
const EASY_BONUS = 1.3;

export type RetentionRating = 'again' | 'hard' | 'good' | 'easy';

export interface RetentionEvidence {
  t: number;
  rating: RetentionRating;
}

export interface RetentionTemplate {
  createdAt: number;
  initialEase: number;
}

export interface RetentionSchedule extends RetentionScheduleCache {
  pressure: number;
}

type RetentionPolicy = Pick<FlashcardMeta,
  'learningSteps' | 'relearnSteps' | 'graduatingInterval' | 'easyInterval' | 'reviewIntervalModifier' | 'maxInterval'
>;

export function scheduleAfterAnswer(
  schedule: RetentionScheduleCache,
  rating: RetentionRating,
  policy: RetentionPolicy,
  now: number,
): RetentionScheduleCache {
  const next: RetentionScheduleCache = { ...schedule, lastReviewed: now, provenance: 'derived-scheduler-cache' };
  const learningSteps = policy.learningSteps;
  const relearnSteps = policy.relearnSteps;

  if (schedule.state === 'new') {
    if (rating === 'again' || rating === 'hard') {
      return { ...next, state: 'learning', learningStep: 0, dueAt: now + learningSteps[0] * MINUTE * (rating === 'hard' ? 1.5 : 1) };
    }
    if (rating === 'good' && learningSteps.length > 1) {
      return { ...next, state: 'learning', learningStep: 1, dueAt: now + learningSteps[1] * MINUTE };
    }
    const interval = (rating === 'easy' ? policy.easyInterval : policy.graduatingInterval) * DAY;
    return { ...next, state: 'review', learningStep: 0, ease: rating === 'easy' ? schedule.ease + 0.15 : schedule.ease, interval, dueAt: now + interval, reviews: 1 };
  }

  if (schedule.state === 'learning') {
    if (rating === 'again') return { ...next, learningStep: 0, dueAt: now + learningSteps[0] * MINUTE };
    if (rating === 'hard') return { ...next, dueAt: now + learningSteps[schedule.learningStep] * MINUTE * 1.5 };
    if (rating === 'good' && schedule.learningStep + 1 < learningSteps.length) {
      const learningStep = schedule.learningStep + 1;
      return { ...next, learningStep, dueAt: now + learningSteps[learningStep] * MINUTE };
    }
    const interval = (rating === 'easy' ? policy.easyInterval : policy.graduatingInterval) * DAY;
    return { ...next, state: 'review', learningStep: 0, ease: rating === 'easy' ? schedule.ease + 0.15 : schedule.ease, interval, dueAt: now + interval, reviews: schedule.reviews + 1 };
  }

  if (schedule.state === 'relearning') {
    if (rating === 'again') return { ...next, learningStep: 0, dueAt: now + relearnSteps[0] * MINUTE };
    if (rating === 'hard') return { ...next, dueAt: now + relearnSteps[schedule.learningStep] * MINUTE * 1.5 };
    if (rating === 'good' && schedule.learningStep + 1 < relearnSteps.length) {
      const learningStep = schedule.learningStep + 1;
      return { ...next, learningStep, dueAt: now + relearnSteps[learningStep] * MINUTE };
    }
    const interval = rating === 'easy' ? Math.min(schedule.interval * 1.5, policy.maxInterval * DAY) : schedule.interval;
    return { ...next, state: 'review', learningStep: 0, interval, dueAt: now + interval };
  }

  if (rating === 'again') {
    return {
      ...next,
      state: 'relearning',
      learningStep: 0,
      ease: nextEase(schedule.ease, rating),
      interval: Math.max(DAY, schedule.interval * 0.5),
      dueAt: now + relearnSteps[0] * MINUTE,
      lapses: schedule.lapses + 1,
    };
  }
  const interval = Math.min(
    schedule.interval * (rating === 'hard' ? 1.2 : schedule.ease * (rating === 'easy' ? EASY_BONUS : 1) * (policy.reviewIntervalModifier / 100)),
    policy.maxInterval * DAY,
  );
  return { ...next, ease: nextEase(schedule.ease, rating), interval, dueAt: now + interval, reviews: schedule.reviews + 1 };
}

/** Replays active review evidence; retractions are applied by the evidence reader. */
export function deriveRetentionSchedule(
  template: RetentionTemplate,
  evidence: readonly RetentionEvidence[],
  policy: RetentionPolicy,
  now: number,
  migratedSeed?: RetentionScheduleCache,
): RetentionSchedule {
  let schedule: RetentionScheduleCache = migratedSeed && evidence.length === 0
    ? migratedSeed
    : { state: 'new', ease: template.initialEase, interval: 0, dueAt: template.createdAt, reviews: 0, lapses: 0, learningStep: 0, lastReviewed: 0, provenance: 'derived-scheduler-cache' };
  for (const event of [...evidence].sort((a, b) => a.t - b.t)) schedule = scheduleAfterAnswer(schedule, event.rating, policy, event.t);
  return { ...schedule, pressure: Math.max(0, (now - schedule.dueAt) / Math.max(1, schedule.interval || DAY)) };
}

function nextEase(ease: number, rating: RetentionRating): number {
  if (rating === 'again') return Math.max(MIN_EASE, ease - 0.2);
  if (rating === 'hard') return Math.max(MIN_EASE, ease - 0.15);
  return rating === 'easy' ? ease + 0.15 : ease;
}
