/**
 * SRS Algorithm Service
 * Implements Anki-like Spaced Repetition System (SM-2 variant)
 *
 * Card states:
 * - new: Never reviewed, waiting in new card queue
 * - learning: Currently in learning phase (short intervals based on steps)
 * - review: Graduated to review phase (longer intervals)
 * - relearning: Failed review, back to learning phase
 */

import {DEFAULT_SETTINGS, Flashcard, FlashcardMeta, ReviewQueue} from '../../shared/types';
import { CURRENT_NORMALIZATION_VERSION } from '../../shared/utils/normalizationVersion';
import type { RetentionRating } from '../../shared/srs/retentionScheduler';
import { SRS_EASE } from '../../shared/constants';
import { scheduleAfterAnswer } from '../../shared/srs/retentionScheduler';
import { setFlashcardExclusion } from '../../shared/flashcardActionUndo';

// SRS constants
/** Canonical ease floor. The scheduler owns every other ease rule. */
export const MIN_EASE = SRS_EASE.MIN;

// Time constants
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Rating values — one definition shared with the retention scheduler.
export type Rating = RetentionRating;

/**
 * Get the effective date after applying the new day hour offset.
 * If current time is before newDayHour, the SRS day is still "yesterday".
 * @param date The date to offset
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4 = 4:00 AM)
 */
function getEffectiveDate(date: Date, newDayHour: number = 4): Date {
    const offset = new Date(date.getTime() - newDayHour * 60 * 60 * 1000);
    return offset;
}

/**
 * Get today's date string in YYYY-MM-DD format, respecting newDayHour.
 * Before newDayHour, it's still considered the previous day.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4 = 4:00 AM)
 */
export function getTodayDateString(newDayHour: number = 4): string {
    const effective = getEffectiveDate(new Date(), newDayHour);
    return `${effective.getFullYear()}-${String(effective.getMonth() + 1).padStart(2, '0')}-${String(effective.getDate()).padStart(2, '0')}`;
}

/**
 * Get the timestamp for the end of the current SRS day.
 * The SRS day runs from newDayHour to the next newDayHour.
 * If current time is before newDayHour, the day ends at newDayHour today.
 * If current time is at or after newDayHour, the day ends at newDayHour tomorrow.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4 = 4:00 AM)
 */
export function getEndOfSRSDay(newDayHour: number = 4): number {
    const now = new Date();
    const boundary = new Date(now);
    boundary.setHours(newDayHour, 0, 0, 0);

    if (now.getTime() >= boundary.getTime()) {
        // We're past today's newDayHour, so end of SRS day is tomorrow's newDayHour
        boundary.setDate(boundary.getDate() + 1);
    }

    return boundary.getTime();
}

/**
 * Generate UUID v4
 */
export function generateUUID(): string {
    return crypto.randomUUID();
}

/**
 * Generate hash for word lookups using SHA-256 (canonical algorithm).
 * Produces a 64-char lowercase hex string identical to Node's
 * crypto.createHash('sha256').update(Buffer.from(word)).digest('hex').
 * Requires crypto.subtle — available in all target environments
 * (Electron renderer, Capacitor WebView). Throws if unavailable.
 */
export { hashWord, hashWordSync } from '../../shared/utils/wordHash';

/**
 * Convert interval in milliseconds to human-readable string.
 * When a translation function is provided, time units are localized.
 */
export function intervalToString(intervalMs: number, t?: (key: string, params?: Record<string, string | number>) => string): string {
    if (intervalMs < 0) intervalMs = 0;

    if (t) {
        if (intervalMs < MINUTE) return t('mlearn.Global.Time.LessThanMinute');
        if (intervalMs < HOUR) return t('mlearn.Global.Time.ShortMinute', { value: Math.round(intervalMs / MINUTE) });
        if (intervalMs < DAY) return t('mlearn.Global.Time.ShortHour', { value: Math.round(intervalMs / HOUR) });
        if (intervalMs < 365 * DAY) return t('mlearn.Global.Time.ShortDay', { value: Math.round(intervalMs / DAY) });
        return t('mlearn.Global.Time.ShortYear', { value: (intervalMs / (365 * DAY)).toFixed(1) });
    }

    if (intervalMs < MINUTE) return '< 1m';
    if (intervalMs < HOUR) return `${Math.round(intervalMs / MINUTE)}m`;
    if (intervalMs < DAY) return `${Math.round(intervalMs / HOUR)}h`;
    if (intervalMs < 365 * DAY) return `${Math.round(intervalMs / DAY)}d`;
    return `${(intervalMs / (365 * DAY)).toFixed(1)}y`;
}

/**
 * Convert due date to relative string (e.g., "in 5m", "in 2d").
 * When a translation function is provided, output is localized.
 */
export function dueDateToString(dueDate: number, t?: (key: string, params?: Record<string, string | number>) => string): string {
    const now = Date.now();
    const diff = dueDate - now;

    if (diff <= 0) return t ? t('mlearn.Global.Time.Now') : 'now';
    return intervalToString(diff, t);
}

/**
 * Default metadata
 */
export function getDefaultMeta(_newDayHour: number = 4): FlashcardMeta {
    return {
        perLanguage: {},
        normalizationVersion: CURRENT_NORMALIZATION_VERSION,
        maxNewCardsPerDay: 20,
        maxNewCardsPerDayLearning: 20,
        maxReviewsPerDay: -1, // -1 = unlimited
        learningSteps: [1, 10], // 1 min, 10 min
        relearnSteps: [10], // 10 min
        graduatingInterval: 1, // 1 day
        easyInterval: 4, // 4 days
        newIntervalModifier: 100,
        reviewIntervalModifier: 100,
        maxInterval: 36500, // 100 years in days
    };
}

/** Scheduler-backed compatibility adapter for legacy flashcard consumers. */
export function answerCard(
  card: Flashcard,
  rating: Rating,
  meta: FlashcardMeta,
  /** Card-level scaffold conditioning; see shared/srs/retentionScheduler. */
  condition: 'assisted' | 'supplied' | 'unassisted' = 'unassisted',
): Flashcard {
    const now = Date.now();
    const prior = card.retentionCache ?? {
        state: card.state,
        ease: card.ease,
        interval: card.interval,
        dueAt: card.dueDate,
        reviews: card.reviews,
        lapses: card.lapses,
        learningStep: card.learningStep,
        lastReviewed: card.lastReviewed,
        provenance: 'migrated-scheduler-cache' as const,
    };
    const retentionCache = scheduleAfterAnswer({ ...prior,
        // Hydration can replay only the available journal window; it must not
        // erase history already preserved by the saved compatibility counters.
        reviews: Math.max(card.reviews, prior.reviews),
        lapses: Math.max(card.lapses, prior.lapses),
    }, rating, meta, now, condition);
    return {
        ...card,
        state: retentionCache.state,
        ease: retentionCache.ease,
        interval: retentionCache.interval,
        dueDate: retentionCache.dueAt,
        reviews: retentionCache.reviews,
        lapses: retentionCache.lapses,
        learningStep: retentionCache.learningStep,
        lastReviewed: retentionCache.lastReviewed,
        lastUpdated: now,
        retentionCache,
    };
}

/**
 * Preview what would happen if a card was answered with each rating
 */
export function previewAnswers(card: Flashcard, meta: FlashcardMeta): Record<Rating, number> {
    return {
        again: answerCard(card, 'again', meta).dueDate,
        hard: answerCard(card, 'hard', meta).dueDate,
        good: answerCard(card, 'good', meta).dueDate,
        easy: answerCard(card, 'easy', meta).dueDate,
    };
}

/**
 * Sort cards by urgency (due soonest first)
 */
export function sortByDueDate(cards: Flashcard[]): Flashcard[] {
    return [...cards].sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Get all cards that are due for review.
 * All card types use end-of-SRS-day cutoff so all cards due today appear in one session.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4)
 */
export function getDueCards(cards: Record<string, Flashcard>, newDayHour: number = 4, language?: string): Flashcard[] {
    const dayEnd = getEndOfSRSDay(newDayHour);
    return Object.values(cards)
        .filter(c => {
            if (language && c.language !== language && c.language) return false;
            if (c.suspended || c.buried) return false;
            return c.dueDate <= dayEnd;
        })
        .sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Get new cards (never reviewed)
 */
export function getNewCards(cards: Record<string, Flashcard>, language?: string): Flashcard[] {
    return Object.values(cards)
        .filter(c => {
            if (language && c.language !== language && c.language) return false;
            return c.state === 'new' && !c.suspended && !c.buried;
        })
        .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get review cards (graduated cards that are due).
 * Uses end-of-SRS-day cutoff so all review cards due today appear in one session.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4)
 */
export function getReviewCards(cards: Record<string, Flashcard>, newDayHour: number = 4, language?: string): Flashcard[] {
    const dayEnd = getEndOfSRSDay(newDayHour);
    return Object.values(cards)
        .filter(c => {
            if (language && c.language !== language && c.language) return false;
            return c.state === 'review' && !c.suspended && !c.buried && c.dueDate <= dayEnd;
        })
        .sort((a, b) => a.dueDate - b.dueDate);
}

function isQueuedLearningCard(card: Flashcard, newDayHour: number, language?: string): boolean {
    if (language && card.language !== language && card.language) return false;
    return card.state === 'learning' && !card.suspended && !card.buried && card.dueDate <= getEndOfSRSDay(newDayHour);
}

function isQueuedRelearningCard(card: Flashcard, newDayHour: number, language?: string): boolean {
    if (language && card.language !== language && card.language) return false;
    return card.state === 'relearning' && !card.suspended && !card.buried && card.dueDate <= getEndOfSRSDay(newDayHour);
}

function isQueuedReviewCard(card: Flashcard, newDayHour: number, language?: string): boolean {
    if (language && card.language !== language && card.language) return false;
    return card.state === 'review' && !card.suspended && !card.buried && card.dueDate <= getEndOfSRSDay(newDayHour);
}

function isQueuedScheduledCard(card: Flashcard, newDayHour: number, language?: string): boolean {
    return isQueuedLearningCard(card, newDayHour, language)
        || isQueuedRelearningCard(card, newDayHour, language)
        || isQueuedReviewCard(card, newDayHour, language);
}

function compareScheduledCards(a: Flashcard, b: Flashcard, now: number): number {
    const aDueBucket = a.dueDate <= now ? 0 : 1;
    const bDueBucket = b.dueDate <= now ? 0 : 1;

    if (aDueBucket !== bDueBucket) {
        return aDueBucket - bDueBucket;
    }

    if (a.dueDate !== b.dueDate) {
        return a.dueDate - b.dueDate;
    }

    if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
    }

    return a.id.localeCompare(b.id);
}

function getFirstValidNewCard(queue: ReviewQueue, cards: Record<string, Flashcard>): Flashcard | null {
    for (const id of queue.newQueue) {
        const card = cards[id];
        if (card && card.state === 'new' && !card.suspended && !card.buried) {
            return card;
        }
    }

    return null;
}

function getBestScheduledCard(
    queue: ReviewQueue,
    cards: Record<string, Flashcard>,
    newDayHour: number,
    dueNowOnly: boolean
): Flashcard | null {
    const now = Date.now();

    for (const id of queue.scheduledQueue) {
        const card = cards[id];
        if (!card || !isQueuedScheduledCard(card, newDayHour)) {
            continue;
        }

        if (dueNowOnly && card.dueDate > now) {
            continue;
        }

        return card;
    }

    return null;
}

/**
 * Build the review queue for a study session.
 * Same-day scheduled cards share one priority queue so failed cards can be
 * pushed to the end of the sitting instead of repeating immediately.
 */
export function buildReviewQueue(
    cards: Record<string, Flashcard>,
    maxNewCards: number,
    newCardsToday: number,
    maxNewCardsPerDayLearning?: number,
    maxReviewsPerDay?: number,
    reviewsToday?: number,
    newDayHour?: number,
    language?: string
): ReviewQueue {
    const hour = newDayHour ?? DEFAULT_SETTINGS.newDayHour;
    const now = Date.now();

    // Get all card lists
    const allNewCards = getNewCards(cards, language);
    const learningCards = Object.values(cards)
        .filter(c => isQueuedLearningCard(c, hour, language))
        .sort((a, b) => a.dueDate - b.dueDate);
    const reviewCards = getReviewCards(cards, hour, language);
    const relearnCards = Object.values(cards)
        .filter(c => isQueuedRelearningCard(c, hour, language))
        .sort((a, b) => a.dueDate - b.dueDate);

    // Limit new cards for auto-creation system
    const remainingNewCards = Math.max(0, maxNewCards - newCardsToday);
    let newCardsToShow = allNewCards.slice(0, remainingNewCards);

    // Apply learning limit for new cards (-1 means unlimited)
    if (maxNewCardsPerDayLearning !== undefined && maxNewCardsPerDayLearning >= 0) {
        // The learning limit is the actual limit for studying new cards
        // newCardsToday already tracks how many new cards were studied
        const remainingLearning = Math.max(0, maxNewCardsPerDayLearning - newCardsToday);
        newCardsToShow = newCardsToShow.slice(0, remainingLearning);
    }

    // Apply review limit (-1 means unlimited)
    let reviewCardsToShow = reviewCards;
    if (maxReviewsPerDay !== undefined && maxReviewsPerDay >= 0 && reviewsToday !== undefined) {
        const remainingReviews = Math.max(0, maxReviewsPerDay - reviewsToday);
        reviewCardsToShow = reviewCards.slice(0, remainingReviews);
    }

    const scheduledCards = [...learningCards, ...relearnCards, ...reviewCardsToShow]
        .sort((a, b) => compareScheduledCards(a, b, now));

    return {
        newQueue: newCardsToShow.map(c => c.id),
        scheduledQueue: scheduledCards.map(c => c.id),
    };
}

/**
 * Get the next card to review from the queue
 * Priority: due-now scheduled cards > new (interleaved with due-now reviews) >
 * remaining same-day scheduled cards in queue order
 *
 * Each queue section verifies the card's state matches expectations to prevent
 * stale queue entries from causing duplicate card appearances.
 * Cards scheduled later today stay in the session and are surfaced in queue
 * order so the whole same-day workload can be finished in one sitting.
 */
export function getNextCard(
    queue: ReviewQueue,
    cards: Record<string, Flashcard>,
    newDayHour: number = 4
): Flashcard | null {
    const dueNowScheduledCard = getBestScheduledCard(queue, cards, newDayHour, true);
    const newCard = getFirstValidNewCard(queue, cards);

    if (dueNowScheduledCard) {
        if (dueNowScheduledCard.state === 'review' && newCard && Math.random() < 0.1) {
            return newCard;
        }

        return dueNowScheduledCard;
    }

    if (newCard) {
        return newCard;
    }

    return getBestScheduledCard(queue, cards, newDayHour, false);
}

/**
 * Remove a card from the queue (after answering)
 */
export function removeFromQueue(queue: ReviewQueue, cardId: string): ReviewQueue {
    return {
        newQueue: queue.newQueue.filter(id => id !== cardId),
        scheduledQueue: queue.scheduledQueue.filter(id => id !== cardId),
    };
}

/**
 * Add a card to the appropriate queue based on its state.
 * Same-day learning, relearning, and review cards all share the scheduled queue.
 */
export function addToQueue(queue: ReviewQueue, card: Flashcard, newDayHour: number = 4): ReviewQueue {
    const id = card.id;

    // Remove from all queues first
    const cleanQueue = removeFromQueue(queue, id);

    // Add to appropriate queue
    if (card.state === 'new') {
        return { ...cleanQueue, newQueue: [...cleanQueue.newQueue, id] };
    }

    if (isQueuedScheduledCard(card, newDayHour)) {
        return { ...cleanQueue, scheduledQueue: [...cleanQueue.scheduledQueue, id] };
    }

    return cleanQueue;
}
/**
 * Cards due for the current SRS day, bucketed by scheduler state.
 *
 * This is the single owner of "how much is left to study today". The review
 * queue and the statistics surfaces both read it, so a rating that moves a
 * card out of today's set is reflected identically everywhere.
 *
 * `relearning` is a scheduler state in its own right; the review header folds
 * it into `learning` at the point of display, not here.
 */
export interface DueCardCounts {
    new: number;
    learning: number;
    review: number;
    relearning: number;
    total: number;
}

/**
 * Count the cards that are due for the current SRS day.
 *
 * A card is due when it is neither suspended nor buried and either has never
 * been studied (`new`) or its due date has passed the SRS day boundary.
 * `language` scopes the result to a single language; omit it to count across
 * every language in the collection.
 */
export function countDueCards(
    cards: Iterable<Flashcard>,
    newDayHour: number = DEFAULT_SETTINGS.newDayHour,
    language?: string
): DueCardCounts {
    const dayEnd = getEndOfSRSDay(newDayHour);
    let newCards = 0;
    let learning = 0;
    let review = 0;
    let relearning = 0;

    for (const card of cards) {
        if (language && card.language !== language && card.language) continue;
        if (card.suspended || card.buried) continue;

        if (card.state === 'new') {
            newCards++;
            continue;
        }
        if (card.dueDate > dayEnd) continue;

        if (card.state === 'learning') learning++;
        else if (card.state === 'review') review++;
        else if (card.state === 'relearning') relearning++;
    }

    return {
        new: newCards,
        learning,
        review,
        relearning,
        total: newCards + learning + review + relearning,
    };
}

/**
 * Counts for the cards the review queue will actually serve.
 *
 * The queue is the studyable set: it applies the daily new-card and review
 * caps, so it can be smaller than the raw due total. The per-state buckets
 * are counted off the queue itself so the header always describes the session
 * the learner is in, and `relearning` is reported under `learning` because the
 * header shows a single "Learning" badge for both.
 */
export function getQueueCounts(queue: ReviewQueue, cards: Record<string, Flashcard>, newDayHour: number = 4): {
    new: number;
    learning: number;
    review: number;
    total: number;
} {
    let learning = 0;
    let review = 0;

    for (const id of queue.scheduledQueue) {
        const card = cards[id];
        if (!card || !isQueuedScheduledCard(card, newDayHour)) {
            continue;
        }

        if (card.state === 'review') {
            review += 1;
            continue;
        }

        learning += 1;
    }

    return {
        new: queue.newQueue.length,
        learning,
        review,
        total: queue.newQueue.length + learning + review,
    };
}

/**
 * Bury a card until the next day
 */
export function buryCard(card: Flashcard): Flashcard {
    return setFlashcardExclusion(card, 'buried', true);
}

/**
 * Suspend a card indefinitely
 */
export function suspendCard(card: Flashcard): Flashcard {
    return setFlashcardExclusion(card, 'suspended', true);
}

/**
 * Unbury all cards
 */
export function unburyCards(cards: Record<string, Flashcard>): Record<string, Flashcard> {
    const result: Record<string, Flashcard> = {};
    for (const [id, card] of Object.entries(cards)) {
        if (card.buried) {
            result[id] = setFlashcardExclusion(card, 'buried', false);
        } else {
            result[id] = card;
        }
    }
    return result;
}
