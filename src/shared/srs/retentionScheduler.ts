import type { FlashcardMeta, RetentionScheduleCache } from '../types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MIN_EASE = 1.3;
const EASY_BONUS = 1.3;

export type RetentionRating = 'again' | 'hard' | 'good' | 'easy';

export interface RetentionEvidence {
  t: number;
  rating: RetentionRating;
  /**
   * Card-level presentation conditioning. 'assisted' = the presentation cued
   * part of what the card tests (downgraded one rating step: weaker refresh);
   * 'supplied' = everything tested was scaffold-supplied (exposure only: the
   * schedule is preserved, the review happened but measures nothing).
   * Absent = unassisted.
   */
  condition?: 'assisted' | 'supplied';
}

export interface RetentionTemplate {
  createdAt: number;
  initialEase: number;
}

export interface RetentionSchedule extends RetentionScheduleCache {
  pressure: number;
}

export type RetentionPolicy = Pick<FlashcardMeta,
  'learningSteps' | 'relearnSteps' | 'graduatingInterval' | 'easyInterval' | 'reviewIntervalModifier' | 'maxInterval'
>;

export function scheduleAfterAnswer(
  schedule: RetentionScheduleCache,
  rating: RetentionRating,
  policy: RetentionPolicy,
  now: number,
  condition: 'assisted' | 'supplied' | 'unassisted' = 'unassisted',
): RetentionScheduleCache {
  // Answer effectively supplied: exposure/reinforcement, not independent
  // retrieval success. The occurrence is recorded (lastReviewed) but the
  // schedule neither extends nor regrades — the access comes back through
  // its existing due date or through calibration probing.
  if (condition === 'supplied') {
    return { ...schedule, lastReviewed: now, provenance: 'derived-scheduler-cache' };
  }
  // Assisted success: weaker, scaffold-conditioned practice. One rating step
  // of scheduling credit — the learner did succeed, but part of the card was
  // cued. The recorded rating itself is never rewritten.
  const schedulingRating: RetentionRating = condition === 'assisted' && rating === 'easy'
    ? 'good'
    : condition === 'assisted' && rating === 'good'
      ? 'hard'
      : rating;
  const next: RetentionScheduleCache = { ...schedule, lastReviewed: now, provenance: 'derived-scheduler-cache' };
  const learningSteps = policy.learningSteps;
  const relearnSteps = policy.relearnSteps;

  if (schedule.state === 'new') {
    if (schedulingRating === 'again' || schedulingRating === 'hard') {
      return { ...next, state: 'learning', learningStep: 0, dueAt: now + learningSteps[0] * MINUTE * (schedulingRating === 'hard' ? 1.5 : 1) };
    }
    if (schedulingRating === 'good' && learningSteps.length > 1) {
      return { ...next, state: 'learning', learningStep: 1, dueAt: now + learningSteps[1] * MINUTE };
    }
    const interval = (schedulingRating === 'easy' ? policy.easyInterval : policy.graduatingInterval) * DAY;
    return { ...next, state: 'review', learningStep: 0, ease: schedulingRating === 'easy' ? schedule.ease + 0.15 : schedule.ease, interval, dueAt: now + interval, reviews: 1 };
  }

  if (schedule.state === 'learning') {
    if (schedulingRating === 'again') return { ...next, learningStep: 0, dueAt: now + learningSteps[0] * MINUTE };
    if (schedulingRating === 'hard') return { ...next, dueAt: now + learningSteps[schedule.learningStep] * MINUTE * 1.5 };
    if (schedulingRating === 'good' && schedule.learningStep + 1 < learningSteps.length) {
      const learningStep = schedule.learningStep + 1;
      return { ...next, learningStep, dueAt: now + learningSteps[learningStep] * MINUTE };
    }
    const interval = (schedulingRating === 'easy' ? policy.easyInterval : policy.graduatingInterval) * DAY;
    return { ...next, state: 'review', learningStep: 0, ease: schedulingRating === 'easy' ? schedule.ease + 0.15 : schedule.ease, interval, dueAt: now + interval, reviews: schedule.reviews + 1 };
  }

  if (schedule.state === 'relearning') {
    if (schedulingRating === 'again') return { ...next, learningStep: 0, dueAt: now + relearnSteps[0] * MINUTE };
    if (schedulingRating === 'hard') return { ...next, dueAt: now + relearnSteps[schedule.learningStep] * MINUTE * 1.5 };
    if (schedulingRating === 'good' && schedule.learningStep + 1 < relearnSteps.length) {
      const learningStep = schedule.learningStep + 1;
      return { ...next, learningStep, dueAt: now + relearnSteps[learningStep] * MINUTE };
    }
    const interval = schedulingRating === 'easy' ? Math.min(schedule.interval * 1.5, policy.maxInterval * DAY) : schedule.interval;
    return { ...next, state: 'review', learningStep: 0, interval, dueAt: now + interval };
  }

  if (schedulingRating === 'again') {
    return {
      ...next,
      state: 'relearning',
      learningStep: 0,
      ease: nextEase(schedule.ease, schedulingRating),
      interval: Math.max(DAY, schedule.interval * 0.5),
      dueAt: now + relearnSteps[0] * MINUTE,
      lapses: schedule.lapses + 1,
    };
  }
  const interval = Math.min(
    schedule.interval * (schedulingRating === 'hard' ? 1.2 : schedule.ease * (schedulingRating === 'easy' ? EASY_BONUS : 1) * (policy.reviewIntervalModifier / 100)),
    policy.maxInterval * DAY,
  );
  return { ...next, ease: nextEase(schedule.ease, schedulingRating), interval, dueAt: now + interval, reviews: schedule.reviews + 1 };
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
  for (const event of [...evidence].sort((a, b) => a.t - b.t)) schedule = scheduleAfterAnswer(schedule, event.rating, policy, event.t, event.condition ?? 'unassisted');
  return { ...schedule, pressure: Math.max(0, (now - schedule.dueAt) / Math.max(1, schedule.interval || DAY)) };
}

function nextEase(ease: number, rating: RetentionRating): number {
  if (rating === 'again') return Math.max(MIN_EASE, ease - 0.2);
  if (rating === 'hard') return Math.max(MIN_EASE, ease - 0.15);
  return rating === 'easy' ? ease + 0.15 : ease;
}
