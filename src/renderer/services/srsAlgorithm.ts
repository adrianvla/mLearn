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

// Time constants
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// SRS constants
export const MIN_EASE = 1.3;
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
 * Generate hash for word lookups using SHA-256 (canonical algorithm).
 * Produces a 64-char lowercase hex string identical to Node's
 * crypto.createHash('sha256').update(Buffer.from(word)).digest('hex').
 * Requires crypto.subtle — available in all target environments
 * (Electron renderer, Capacitor WebView). Throws if unavailable.
 */
export async function hashWord(word: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(word);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Pure-JS SHA-256 — used by hashWordSync so synchronous callers produce the
// same 64-char lowercase hex as hashWord() / Node's crypto.createHash.
// Based on the FIPS 180-4 reference implementation; no external dependencies.
// ---------------------------------------------------------------------------
const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Sync(message: string): string {
    const encoder = new TextEncoder();
    const msgBytes = encoder.encode(message);
    const msgLen = msgBytes.length;
    const bitLen = msgLen * 8;

    // Pad to 512-bit blocks: append 0x80, then zeros, then 64-bit big-endian length
    const padLen = ((msgLen + 9 + 63) & ~63);
    const padded = new Uint8Array(padLen);
    padded.set(msgBytes);
    padded[msgLen] = 0x80;
    // Write 64-bit big-endian bit length (JS numbers are 53-bit safe so high word is 0)
    const dv = new DataView(padded.buffer);
    dv.setUint32(padLen - 4, bitLen >>> 0, false);
    dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);

    // Initial hash values (first 32 bits of fractional parts of square roots of first 8 primes)
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const w = new Uint32Array(64);
    const blocks = padLen / 64;

    for (let i = 0; i < blocks; i++) {
        const off = i * 64;
        for (let j = 0; j < 16; j++) {
            w[j] = dv.getUint32(off + j * 4, false);
        }
        for (let j = 16; j < 64; j++) {
            const s0 = (w[j - 15] >>> 7 | w[j - 15] << 25) ^ (w[j - 15] >>> 18 | w[j - 15] << 14) ^ (w[j - 15] >>> 3);
            const s1 = (w[j - 2] >>> 17 | w[j - 2] << 15) ^ (w[j - 2] >>> 19 | w[j - 2] << 13) ^ (w[j - 2] >>> 10);
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
        }

        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

        for (let j = 0; j < 64; j++) {
            const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (h + S1 + ch + SHA256_K[j] + w[j]) >>> 0;
            const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            h = g; g = f; f = e; e = (d + temp1) >>> 0;
            d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
        }

        h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
        h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    const result = new Uint32Array([h0, h1, h2, h3, h4, h5, h6, h7]);
    return Array.from(result).map(n => n.toString(16).padStart(8, '0')).join('');
}

/**
 * Synchronous word hash using the same SHA-256 algorithm as hashWord().
 * Produces a 64-char lowercase hex string — identical output to hashWord().
 * Use for performance-sensitive synchronous paths (rendering, hover tracking).
 */
export function hashWordSync(word: string): string {
    return sha256Sync(word);
}

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
 * All card types use end-of-SRS-day cutoff so all cards due today appear in one session.
 * @param newDayHour Hour (0-23) at which the new SRS day begins (default 4)
 */
export function getDueCards(cards: Record<string, Flashcard>, newDayHour: number = 4): Flashcard[] {
    const dayEnd = getEndOfSRSDay(newDayHour);
    return Object.values(cards)
        .filter(c => {
            if (c.suspended || c.buried) return false;
            return c.dueDate <= dayEnd;
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
 * Get learning cards (in learning phase only — relearning cards go to relearnQueue).
 * Only returns cards whose exact step due time has arrived.
 */
export function getLearningCards(cards: Record<string, Flashcard>): Flashcard[] {
    const now = Date.now();
    return Object.values(cards)
        .filter(c => c.state === 'learning' && !c.suspended && !c.buried && c.dueDate <= now)
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

function isQueuedLearningCard(card: Flashcard, newDayHour: number): boolean {
    return card.state === 'learning' && !card.suspended && !card.buried && card.dueDate <= getEndOfSRSDay(newDayHour);
}

function isLearningCardDueNow(card: Flashcard, now: number): boolean {
    return card.state === 'learning' && !card.suspended && !card.buried && card.dueDate <= now;
}

function isQueuedRelearningCard(card: Flashcard, newDayHour: number): boolean {
    return card.state === 'relearning' && !card.suspended && !card.buried && card.dueDate <= getEndOfSRSDay(newDayHour);
}

function isRelearningCardDueNow(card: Flashcard, now: number): boolean {
    return card.state === 'relearning' && !card.suspended && !card.buried && card.dueDate <= now;
}

/**
 * Build the review queue for a study session.
 * All card types use end-of-SRS-day cutoff so all cards due today appear in one session.
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
    const hour = newDayHour ?? DEFAULT_SETTINGS.newDayHour;

    // Get all card lists
    const allNewCards = getNewCards(cards);
    const learningCards = Object.values(cards)
        .filter(c => isQueuedLearningCard(c, hour))
        .sort((a, b) => a.dueDate - b.dueDate);
    const reviewCards = getReviewCards(cards, hour);
    const relearnCards = Object.values(cards)
        .filter(c => isQueuedRelearningCard(c, hour))
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
 * Priority: relearning (due now) > learning (due now) > new (interleaved) > review
 *
 * Each queue section verifies the card's state matches expectations to prevent
 * stale queue entries from causing duplicate card appearances.
 * Learning and relearning cards stay queued for the current SRS day so the
 * session can enter a waiting state, but they are only surfaced once their
 * exact due time arrives.
 */
export function getNextCard(
    queue: ReviewQueue,
    cards: Record<string, Flashcard>,
    newDayHour: number = 4
): Flashcard | null {
    const now = Date.now();

    // Check relearning cards first (most urgent — only if actually due)
    for (const id of queue.relearnQueue) {
        const card = cards[id];
        if (card && isQueuedRelearningCard(card, newDayHour) && isRelearningCardDueNow(card, now)) {
            return card;
        }
    }

    // Check learning cards
    for (const id of queue.learningQueue) {
        const card = cards[id];
        if (card && isQueuedLearningCard(card, newDayHour) && isLearningCardDueNow(card, now)) {
            return card;
        }
    }

    // Interleave new cards with review cards
    // Show new card if: there are new cards and (no review cards or every 10th card)
    // Review cards in the queue are already filtered to be due today (end-of-SRS-day cutoff),
    // so we don't re-check dueDate here.
    const hasNewCards = queue.newQueue.some(id => {
        const card = cards[id];
        return card && card.state === 'new' && !card.suspended && !card.buried;
    });
    const hasReviewCards = queue.reviewQueue.some(id => {
        const card = cards[id];
        return card && card.state === 'review' && !card.suspended && !card.buried;
    });

    if (hasNewCards && (!hasReviewCards || Math.random() < 0.1)) {
        for (const id of queue.newQueue) {
            const card = cards[id];
            if (card && card.state === 'new' && !card.suspended && !card.buried) {
                return card;
            }
        }
    }

    // Check review cards (already filtered to be due today, no dueDate re-check needed)
    for (const id of queue.reviewQueue) {
        const card = cards[id];
        if (card && card.state === 'review' && !card.suspended && !card.buried) {
            return card;
        }
    }

    // Return first valid new card if nothing else
    for (const id of queue.newQueue) {
        const card = cards[id];
        if (card && card.state === 'new' && !card.suspended && !card.buried) {
            return card;
        }
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
 * Get the earliest due date among learning/relearning cards in the queue that
 * are queued for the current SRS day but whose exact due time has not arrived.
 */
export function getNextPendingLearningDueDate(
    queue: ReviewQueue,
    cards: Record<string, Flashcard>,
    newDayHour: number = 4
): number | null {
    const now = Date.now();
    let nextDue: number | null = null;

    for (const id of queue.learningQueue) {
        const card = cards[id];
        if (card && isQueuedLearningCard(card, newDayHour) && !isLearningCardDueNow(card, now)) {
            nextDue = nextDue === null ? card.dueDate : Math.min(nextDue, card.dueDate);
        }
    }

    for (const id of queue.relearnQueue) {
        const card = cards[id];
        if (card && isQueuedRelearningCard(card, newDayHour) && !isRelearningCardDueNow(card, now)) {
            nextDue = nextDue === null ? card.dueDate : Math.min(nextDue, card.dueDate);
        }
    }

    return nextDue;
}

/**
 * Get queue counts for display.
 * Learning and relearning cards both stay counted while they are queued for
 * the current SRS day, even if their exact due time has not arrived yet.
 */
export function getQueueCounts(queue: ReviewQueue, cards: Record<string, Flashcard>, newDayHour: number = 4): {
    new: number;
    learning: number;
    review: number;
    total: number;
} {
    const learning = [...queue.learningQueue, ...queue.relearnQueue]
        .filter(id => {
            const card = cards[id];
            if (!card || card.suspended || card.buried) {
                return false;
            }

            if (card.state === 'learning') {
                return isQueuedLearningCard(card, newDayHour);
            }

            if (card.state === 'relearning') {
                return isQueuedRelearningCard(card, newDayHour);
            }

            return false;
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
