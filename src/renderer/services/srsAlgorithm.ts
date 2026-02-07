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

import type { Flashcard, FlashcardMeta, ReviewQueue } from '../../shared/types';

// Time constants
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// SRS constants
const MIN_EASE = 1.3;
const EASE_BONUS = 1.3; // Bonus for Easy button

// Rating values
export type Rating = 'again' | 'hard' | 'good' | 'easy';

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
 * Check if a timestamp is from today, respecting newDayHour.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4 = 4:00 AM)
 */
export function isToday(timestamp: number, newDayHour: number = 4): boolean {
    const todayEffective = getEffectiveDate(new Date(), newDayHour);
    const dateEffective = getEffectiveDate(new Date(timestamp), newDayHour);
    return todayEffective.getFullYear() === dateEffective.getFullYear() &&
        todayEffective.getMonth() === dateEffective.getMonth() &&
        todayEffective.getDate() === dateEffective.getDate();
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
 * Generate hash for word lookups using SHA-256 with fallback to simple hash
 */
export async function hashWord(word: string): Promise<string> {
    try {
        // Try Web Crypto API first
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const encoder = new TextEncoder();
            const data = encoder.encode(word);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (e) {
        console.warn('crypto.subtle not available, using fallback hash:', e);
    }
    
    // Fallback: simple djb2 hash for environments without crypto.subtle
    let hash = 5381;
    for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) + hash) ^ word.charCodeAt(i);
    }
    return 'djb2_' + Math.abs(hash).toString(16);
}

/**
 * Convert interval in milliseconds to human-readable string
 */
export function intervalToString(intervalMs: number): string {
    if (intervalMs < 0) intervalMs = 0;

    if (intervalMs < MINUTE) return '< 1m';
    if (intervalMs < HOUR) return `${Math.round(intervalMs / MINUTE)}m`;
    if (intervalMs < DAY) return `${Math.round(intervalMs / HOUR)}h`;
    if (intervalMs < 365 * DAY) return `${Math.round(intervalMs / DAY)}d`;
    return `${(intervalMs / (365 * DAY)).toFixed(1)}y`;
}

/**
 * Convert due date to relative string (e.g., "in 5m", "in 2d")
 */
export function dueDateToString(dueDate: number): string {
    const now = Date.now();
    const diff = dueDate - now;

    if (diff <= 0) return 'now';
    return intervalToString(diff);
}

/**
 * Default metadata
 */
export function getDefaultMeta(newDayHour: number = 4): FlashcardMeta {
    return {
        newCardsToday: 0,
        reviewsToday: 0,
        newCardsDate: getTodayDateString(newDayHour),
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

/**
 * Calculate new ease factor based on rating
 */
function calculateNewEase(currentEase: number, rating: Rating): number {
    let ease = currentEase;

    switch (rating) {
        case 'again':
            ease = Math.max(MIN_EASE, ease - 0.2);
            break;
        case 'hard':
            ease = Math.max(MIN_EASE, ease - 0.15);
            break;
        case 'good':
            // No change
            break;
        case 'easy':
            ease += 0.15;
            break;
    }

    return ease;
}

/**
 * Answer a card with a rating and return the updated card
 */
export function answerCard(card: Flashcard, rating: Rating, meta: FlashcardMeta): Flashcard {
    const now = Date.now();
    const updated: Flashcard = {
        ...card,
        lastReviewed: now,
        lastUpdated: now,
    };

    switch (card.state) {
        case 'new':
            return answerNewCard(updated, rating, meta);
        case 'learning':
            return answerLearningCard(updated, rating, meta);
        case 'review':
            return answerReviewCard(updated, rating, meta);
        case 'relearning':
            return answerRelearningCard(updated, rating, meta);
        default:
            return updated;
    }
}

/**
 * Answer a new card
 */
function answerNewCard(card: Flashcard, rating: Rating, meta: FlashcardMeta): Flashcard {
    const now = Date.now();
    const steps = meta.learningSteps;

    switch (rating) {
        case 'again':
            // Stay in learning, first step
            return {
                ...card,
                state: 'learning',
                learningStep: 0,
                dueDate: now + steps[0] * MINUTE,
            };

        case 'hard':
            // Stay in learning, first step with 1.5x delay
            return {
                ...card,
                state: 'learning',
                learningStep: 0,
                dueDate: now + steps[0] * MINUTE * 1.5,
            };

        case 'good':
            if (steps.length === 1) {
                // Graduate directly
                return {
                    ...card,
                    state: 'review',
                    learningStep: 0,
                    interval: meta.graduatingInterval * DAY,
                    dueDate: now + meta.graduatingInterval * DAY,
                    reviews: 1,
                };
            }
            // Move to next learning step
            return {
                ...card,
                state: 'learning',
                learningStep: 1,
                dueDate: now + steps[1] * MINUTE,
            };

        case 'easy':
            // Graduate immediately with easy interval
            return {
                ...card,
                state: 'review',
                learningStep: 0,
                ease: card.ease + 0.15,
                interval: meta.easyInterval * DAY,
                dueDate: now + meta.easyInterval * DAY,
                reviews: 1,
            };
    }
}

/**
 * Answer a learning card
 */
function answerLearningCard(card: Flashcard, rating: Rating, meta: FlashcardMeta): Flashcard {
    const now = Date.now();
    const steps = meta.learningSteps;
    const currentStep = card.learningStep;

    switch (rating) {
        case 'again':
            // Reset to first step
            return {
                ...card,
                learningStep: 0,
                dueDate: now + steps[0] * MINUTE,
            };

        case 'hard':
            // Repeat current step with 1.5x delay
            const hardDelay = steps[currentStep] * MINUTE * 1.5;
            return {
                ...card,
                dueDate: now + hardDelay,
            };

        case 'good':
            // Move to next step or graduate
            const nextStep = currentStep + 1;
            if (nextStep >= steps.length) {
                // Graduate
                return {
                    ...card,
                    state: 'review',
                    learningStep: 0,
                    interval: meta.graduatingInterval * DAY,
                    dueDate: now + meta.graduatingInterval * DAY,
                    reviews: (card.reviews || 0) + 1,
                };
            }
            // Next learning step
            return {
                ...card,
                learningStep: nextStep,
                dueDate: now + steps[nextStep] * MINUTE,
            };

        case 'easy':
            // Graduate immediately with easy interval
            return {
                ...card,
                state: 'review',
                learningStep: 0,
                ease: card.ease + 0.15,
                interval: meta.easyInterval * DAY,
                dueDate: now + meta.easyInterval * DAY,
                reviews: (card.reviews || 0) + 1,
            };
    }
}

/**
 * Answer a review card
 */
function answerReviewCard(card: Flashcard, rating: Rating, meta: FlashcardMeta): Flashcard {
    const now = Date.now();
    const relearnSteps = meta.relearnSteps;

    switch (rating) {
        case 'again':
            // Lapse - move to relearning
            const lapseInterval = Math.max(1 * DAY, card.interval * 0.5); // At least 1 day, 50% of previous
            return {
                ...card,
                state: 'relearning',
                learningStep: 0,
                lapses: (card.lapses || 0) + 1,
                ease: calculateNewEase(card.ease, rating),
                interval: lapseInterval,
                dueDate: now + relearnSteps[0] * MINUTE,
            };

        case 'hard':
            // Increase interval slightly (1.2x), decrease ease
            const hardInterval = Math.min(
                card.interval * 1.2,
                meta.maxInterval * DAY
            );
            return {
                ...card,
                ease: calculateNewEase(card.ease, rating),
                interval: hardInterval,
                dueDate: now + hardInterval,
                reviews: (card.reviews || 0) + 1,
            };

        case 'good':
            // Normal interval increase (ease factor)
            const modifier = meta.reviewIntervalModifier / 100;
            const goodInterval = Math.min(
                card.interval * card.ease * modifier,
                meta.maxInterval * DAY
            );
            return {
                ...card,
                ease: calculateNewEase(card.ease, rating),
                interval: goodInterval,
                dueDate: now + goodInterval,
                reviews: (card.reviews || 0) + 1,
            };

        case 'easy':
            // Large interval increase (ease factor * bonus)
            const easyModifier = meta.reviewIntervalModifier / 100;
            const easyInterval = Math.min(
                card.interval * card.ease * EASE_BONUS * easyModifier,
                meta.maxInterval * DAY
            );
            return {
                ...card,
                ease: calculateNewEase(card.ease, rating),
                interval: easyInterval,
                dueDate: now + easyInterval,
                reviews: (card.reviews || 0) + 1,
            };
    }
}

/**
 * Answer a relearning card
 */
function answerRelearningCard(card: Flashcard, rating: Rating, meta: FlashcardMeta): Flashcard {
    const now = Date.now();
    const steps = meta.relearnSteps;
    const currentStep = card.learningStep;

    switch (rating) {
        case 'again':
            // Reset to first relearn step
            return {
                ...card,
                learningStep: 0,
                dueDate: now + steps[0] * MINUTE,
            };

        case 'hard':
            // Repeat current step with 1.5x delay
            const hardDelay = steps[currentStep] * MINUTE * 1.5;
            return {
                ...card,
                dueDate: now + hardDelay,
            };

        case 'good':
            // Move to next step or return to review
            const nextStep = currentStep + 1;
            if (nextStep >= steps.length) {
                // Return to review with stored interval
                return {
                    ...card,
                    state: 'review',
                    learningStep: 0,
                    dueDate: now + card.interval,
                };
            }
            // Next relearn step
            return {
                ...card,
                learningStep: nextStep,
                dueDate: now + steps[nextStep] * MINUTE,
            };

        case 'easy':
            // Return to review immediately with 1.5x stored interval
            const easyInterval = Math.min(card.interval * 1.5, meta.maxInterval * DAY);
            return {
                ...card,
                state: 'review',
                learningStep: 0,
                interval: easyInterval,
                dueDate: now + easyInterval,
            };
    }
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
 * Review cards use end-of-SRS-day cutoff so all cards due today appear in one session.
 * Learning/relearning cards still use current time.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4)
 */
export function getDueCards(cards: Record<string, Flashcard>, newDayHour: number = 4): Flashcard[] {
    const now = Date.now();
    const dayEnd = getEndOfSRSDay(newDayHour);
    return Object.values(cards)
        .filter(c => {
            if (c.suspended || c.buried) return false;
            // Review cards: show all that are due by end of SRS day
            if (c.state === 'review') return c.dueDate <= dayEnd;
            // Learning/relearning/new: show only when actually due
            return c.dueDate <= now;
        })
        .sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Get new cards (never reviewed)
 */
export function getNewCards(cards: Record<string, Flashcard>): Flashcard[] {
    return Object.values(cards)
        .filter(c => c.state === 'new' && !c.suspended && !c.buried)
        .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get learning cards (in learning or relearning phase)
 */
export function getLearningCards(cards: Record<string, Flashcard>): Flashcard[] {
    const now = Date.now();
    return Object.values(cards)
        .filter(c => (c.state === 'learning' || c.state === 'relearning') && !c.suspended && !c.buried && c.dueDate <= now)
        .sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Get review cards (graduated cards that are due).
 * Uses end-of-SRS-day cutoff so all review cards due today appear in one session.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4)
 */
export function getReviewCards(cards: Record<string, Flashcard>, newDayHour: number = 4): Flashcard[] {
    const dayEnd = getEndOfSRSDay(newDayHour);
    return Object.values(cards)
        .filter(c => c.state === 'review' && !c.suspended && !c.buried && c.dueDate <= dayEnd)
        .sort((a, b) => a.dueDate - b.dueDate);
}

/**
 * Build the review queue for a study session.
 * Review cards use end-of-SRS-day cutoff so all reviews due today appear in one session.
 * Learning/relearning cards still use current time.
 */
export function buildReviewQueue(
    cards: Record<string, Flashcard>,
    maxNewCards: number,
    newCardsToday: number,
    maxNewCardsPerDayLearning?: number,
    maxReviewsPerDay?: number,
    reviewsToday?: number,
    newDayHour?: number
): ReviewQueue {
    const now = Date.now();
    const hour = newDayHour ?? 4;

    // Get all card lists
    const allNewCards = getNewCards(cards);
    const learningCards = getLearningCards(cards);
    const reviewCards = getReviewCards(cards, hour);
    const relearnCards = Object.values(cards)
        .filter(c => c.state === 'relearning' && !c.suspended && !c.buried && c.dueDate <= now)
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

    return {
        newQueue: newCardsToShow.map(c => c.id),
        learningQueue: learningCards.map(c => c.id),
        reviewQueue: reviewCardsToShow.map(c => c.id),
        relearnQueue: relearnCards.map(c => c.id),
    };
}

/**
 * Get the next card to review from the queue
 * Priority: relearning > learning > new (interleaved) > review
 */
export function getNextCard(
    queue: ReviewQueue,
    cards: Record<string, Flashcard>
): Flashcard | null {
    const now = Date.now();

    // Check relearning cards first (most urgent)
    for (const id of queue.relearnQueue) {
        const card = cards[id];
        if (card && card.dueDate <= now && !card.suspended && !card.buried) {
            return card;
        }
    }

    // Check learning cards
    for (const id of queue.learningQueue) {
        const card = cards[id];
        if (card && card.dueDate <= now && !card.suspended && !card.buried) {
            return card;
        }
    }

    // Interleave new cards with review cards
    // Show new card if: there are new cards and (no review cards or every 10th card)
    // Review cards in the queue are already filtered to be due today (end-of-SRS-day cutoff),
    // so we don't re-check dueDate here.
    const hasNewCards = queue.newQueue.length > 0;
    const hasReviewCards = queue.reviewQueue.some(id => {
        const card = cards[id];
        return card && !card.suspended && !card.buried;
    });

    if (hasNewCards && (!hasReviewCards || Math.random() < 0.1)) {
        const id = queue.newQueue[0];
        const card = cards[id];
        if (card && !card.suspended && !card.buried) {
            return card;
        }
    }

    // Check review cards (already filtered to be due today, no dueDate re-check needed)
    for (const id of queue.reviewQueue) {
        const card = cards[id];
        if (card && !card.suspended && !card.buried) {
            return card;
        }
    }

    // Return first new card if nothing else
    if (hasNewCards) {
        const id = queue.newQueue[0];
        return cards[id] || null;
    }

    return null;
}

/**
 * Remove a card from the queue (after answering)
 */
export function removeFromQueue(queue: ReviewQueue, cardId: string): ReviewQueue {
    return {
        newQueue: queue.newQueue.filter(id => id !== cardId),
        learningQueue: queue.learningQueue.filter(id => id !== cardId),
        reviewQueue: queue.reviewQueue.filter(id => id !== cardId),
        relearnQueue: queue.relearnQueue.filter(id => id !== cardId),
    };
}

/**
 * Add a card to the appropriate queue based on its state
 */
export function addToQueue(queue: ReviewQueue, card: Flashcard): ReviewQueue {
    const id = card.id;

    // Remove from all queues first
    const cleanQueue = removeFromQueue(queue, id);

    // Add to appropriate queue
    switch (card.state) {
        case 'new':
            return { ...cleanQueue, newQueue: [...cleanQueue.newQueue, id] };
        case 'learning':
            return { ...cleanQueue, learningQueue: [...cleanQueue.learningQueue, id] };
        case 'review':
            return { ...cleanQueue, reviewQueue: [...cleanQueue.reviewQueue, id] };
        case 'relearning':
            return { ...cleanQueue, relearnQueue: [...cleanQueue.relearnQueue, id] };
        default:
            return cleanQueue;
    }
}

/**
 * Get queue counts for display
 */
export function getQueueCounts(queue: ReviewQueue, cards: Record<string, Flashcard>): {
    new: number;
    learning: number;
    review: number;
    total: number;
} {
    const now = Date.now();

    const learning = [...queue.learningQueue, ...queue.relearnQueue]
        .filter(id => {
            const card = cards[id];
            return card && card.dueDate <= now;
        }).length;

    // Review cards in the queue are already filtered to be due today
    // (end-of-SRS-day cutoff), so count them all regardless of exact time
    const review = queue.reviewQueue
        .filter(id => {
            const card = cards[id];
            return card && !card.suspended && !card.buried;
        }).length;

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
    return {
        ...card,
        buried: true,
        lastUpdated: Date.now(),
    };
}

/**
 * Suspend a card indefinitely
 */
export function suspendCard(card: Flashcard): Flashcard {
    return {
        ...card,
        suspended: true,
        lastUpdated: Date.now(),
    };
}

/**
 * Unbury all cards
 */
export function unburyCards(cards: Record<string, Flashcard>): Record<string, Flashcard> {
    const result: Record<string, Flashcard> = {};
    for (const [id, card] of Object.entries(cards)) {
        if (card.buried) {
            result[id] = { ...card, buried: false, lastUpdated: Date.now() };
        } else {
            result[id] = card;
        }
    }
    return result;
}
