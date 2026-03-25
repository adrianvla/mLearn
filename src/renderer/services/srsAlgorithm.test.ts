import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Flashcard, FlashcardMeta, ReviewQueue } from '@shared/types';
import {
    getTodayDateString,
    isToday,
    getEndOfSRSDay,
    generateUUID,
    hashWord,
    hashWordSync,
    intervalToString,
    dueDateToString,
    getDefaultMeta,
    answerCard,
    previewAnswers,
    sortByDueDate,
    getDueCards,
    getNewCards,
    getLearningCards,
    getReviewCards,
    buildReviewQueue,
    getNextCard,
    removeFromQueue,
    addToQueue,
    getNextPendingLearningDueDate,
    getQueueCounts,
    buryCard,
    suspendCard,
    unburyCards,
} from './srsAlgorithm';

// ---------------------------------------------------------------------------
// Time constants (mirrors source)
// ---------------------------------------------------------------------------
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function createTestCard(overrides: Partial<Flashcard> = {}): Flashcard {
    const now = Date.now();
    return {
        id: 'test-card-1',
        content: { type: 'word', front: 'hello', back: 'world' },
        state: 'new',
        ease: 2.5,
        interval: 0,
        dueDate: now,
        reviews: 0,
        lapses: 0,
        learningStep: 0,
        createdAt: now,
        lastReviewed: 0,
        lastUpdated: now,
        ...overrides,
    };
}

function createTestMeta(overrides: Partial<FlashcardMeta> = {}): FlashcardMeta {
    return {
        newCardsToday: 0,
        reviewsToday: 0,
        newCardsDate: '2025-01-15',
        maxNewCardsPerDay: 20,
        maxNewCardsPerDayLearning: 20,
        maxReviewsPerDay: -1,
        learningSteps: [1, 10],
        relearnSteps: [10],
        graduatingInterval: 1,
        easyInterval: 4,
        newIntervalModifier: 100,
        reviewIntervalModifier: 100,
        maxInterval: 36500,
        ...overrides,
    };
}

function createEmptyQueue(): ReviewQueue {
    return { newQueue: [], learningQueue: [], reviewQueue: [], relearnQueue: [] };
}

// ---------------------------------------------------------------------------
// getTodayDateString
// ---------------------------------------------------------------------------

describe('getTodayDateString', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns YYYY-MM-DD format', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const result = getTodayDateString(4);
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('returns correct date when well past newDayHour', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        expect(getTodayDateString(4)).toBe('2025-06-15');
    });

    it('returns previous day when before newDayHour', () => {
        vi.useFakeTimers();
        // 3:00 AM is before default 4 AM newDayHour — still "yesterday" (June 14)
        vi.setSystemTime(new Date('2025-06-15T03:00:00'));
        expect(getTodayDateString(4)).toBe('2025-06-14');
    });

    it('returns current day when exactly at newDayHour', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T04:00:00'));
        expect(getTodayDateString(4)).toBe('2025-06-15');
    });

    it('handles newDayHour = 0 (midnight boundary)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T00:30:00'));
        // newDayHour = 0: subtract 0 hours, stays same day
        expect(getTodayDateString(0)).toBe('2025-06-15');
    });

    it('handles custom newDayHour = 6', () => {
        vi.useFakeTimers();
        // 5:59 AM before 6 AM boundary → still previous day
        vi.setSystemTime(new Date('2025-06-15T05:59:00'));
        expect(getTodayDateString(6)).toBe('2025-06-14');
    });

    it('handles custom newDayHour = 6 at boundary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T06:00:00'));
        expect(getTodayDateString(6)).toBe('2025-06-15');
    });

    it('pads month and day with leading zeros', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-05T10:00:00'));
        expect(getTodayDateString(4)).toBe('2025-01-05');
    });

    it('defaults newDayHour to 4 when not provided', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        expect(getTodayDateString()).toBe('2025-06-15');
    });
});

// ---------------------------------------------------------------------------
// isToday
// ---------------------------------------------------------------------------

describe('isToday', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns true for timestamp in the current SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const ts = new Date('2025-06-15T08:00:00').getTime();
        expect(isToday(ts, 4)).toBe(true);
    });

    it('returns false for timestamp from yesterday', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const ts = new Date('2025-06-14T20:00:00').getTime();
        expect(isToday(ts, 4)).toBe(false);
    });

    it('returns false for timestamp from tomorrow', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const ts = new Date('2025-06-16T08:00:00').getTime();
        expect(isToday(ts, 4)).toBe(false);
    });

    it('treats 3 AM as still "yesterday" for default 4 AM boundary', () => {
        vi.useFakeTimers();
        // Current time is 3 AM on June 15 — in the SRS day of June 14
        vi.setSystemTime(new Date('2025-06-15T03:00:00'));
        // Timestamp at 11 PM on June 14 — in the same SRS day
        const ts = new Date('2025-06-14T23:00:00').getTime();
        expect(isToday(ts, 4)).toBe(true);
    });

    it('returns false when current time is 3 AM and timestamp is from previous SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T03:00:00'));
        // Timestamp is from the day before yesterday evening — different SRS day
        const ts = new Date('2025-06-13T22:00:00').getTime();
        expect(isToday(ts, 4)).toBe(false);
    });

    it('defaults newDayHour to 4', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const ts = new Date('2025-06-15T10:00:00').getTime();
        expect(isToday(ts)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// getEndOfSRSDay
// ---------------------------------------------------------------------------

describe('getEndOfSRSDay', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns tomorrow newDayHour when past the boundary today', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // 10 AM, past 4 AM boundary
        const result = getEndOfSRSDay(4);
        const expected = new Date('2025-06-16T04:00:00').getTime();
        expect(result).toBe(expected);
    });

    it('returns today newDayHour when before the boundary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T02:00:00')); // 2 AM, before 4 AM boundary
        const result = getEndOfSRSDay(4);
        const expected = new Date('2025-06-15T04:00:00').getTime();
        expect(result).toBe(expected);
    });

    it('returns tomorrow newDayHour when exactly at the boundary', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T04:00:00')); // exactly 4 AM
        const result = getEndOfSRSDay(4);
        const expected = new Date('2025-06-16T04:00:00').getTime();
        expect(result).toBe(expected);
    });

    it('defaults newDayHour to 4', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const result = getEndOfSRSDay();
        const expected = new Date('2025-06-16T04:00:00').getTime();
        expect(result).toBe(expected);
    });

    it('handles custom newDayHour', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T20:00:00')); // 8 PM, past 6 AM boundary
        const result = getEndOfSRSDay(6);
        const expected = new Date('2025-06-16T06:00:00').getTime();
        expect(result).toBe(expected);
    });

    it('returns a number (timestamp)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        expect(typeof getEndOfSRSDay(4)).toBe('number');
    });
});

// ---------------------------------------------------------------------------
// generateUUID
// ---------------------------------------------------------------------------

describe('generateUUID', () => {
    it('returns a string', () => {
        expect(typeof generateUUID()).toBe('string');
    });

    it('returns a valid UUID v4 format', () => {
        const uuid = generateUUID();
        expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('returns unique values on each call', () => {
        const a = generateUUID();
        const b = generateUUID();
        expect(a).not.toBe(b);
    });
});

// ---------------------------------------------------------------------------
// hashWord (async)
// ---------------------------------------------------------------------------

describe('hashWord', () => {
    it('returns a 64-character hex string', async () => {
        const result = await hashWord('hello');
        expect(result).toHaveLength(64);
        expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('produces consistent results for the same input', async () => {
        const a = await hashWord('test');
        const b = await hashWord('test');
        expect(a).toBe(b);
    });

    it('produces different hashes for different inputs', async () => {
        const a = await hashWord('hello');
        const b = await hashWord('world');
        expect(a).not.toBe(b);
    });

    it('matches known SHA-256 vector for empty string', async () => {
        const result = await hashWord('');
        expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('produces a 64-char hex string for "abc" consistent across calls', async () => {
        const a = await hashWord('abc');
        const b = await hashWord('abc');
        expect(a).toBe(b);
        expect(a).toHaveLength(64);
    });
});

// ---------------------------------------------------------------------------
// hashWordSync
// ---------------------------------------------------------------------------

describe('hashWordSync', () => {
    it('returns a 64-character hex string', () => {
        expect(hashWordSync('hello')).toHaveLength(64);
        expect(hashWordSync('hello')).toMatch(/^[0-9a-f]+$/);
    });

    it('produces consistent results for the same input', () => {
        expect(hashWordSync('test')).toBe(hashWordSync('test'));
    });

    it('produces different hashes for different inputs', () => {
        expect(hashWordSync('hello')).not.toBe(hashWordSync('world'));
    });

    it('matches known SHA-256 vector for empty string', () => {
        expect(hashWordSync('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('produces a 64-char hex string for "abc" consistent across calls', () => {
        const a = hashWordSync('abc');
        const b = hashWordSync('abc');
        expect(a).toBe(b);
        expect(a).toHaveLength(64);
    });

    it('produces same result as async hashWord', async () => {
        const sync = hashWordSync('synchronous-test');
        const async_ = await hashWord('synchronous-test');
        expect(sync).toBe(async_);
    });
});

// ---------------------------------------------------------------------------
// intervalToString
// ---------------------------------------------------------------------------

describe('intervalToString', () => {
    it('returns "< 1m" for values below 1 minute', () => {
        expect(intervalToString(0)).toBe('< 1m');
        expect(intervalToString(59 * 1000)).toBe('< 1m');
    });

    it('returns "< 1m" for negative values (clamped to 0)', () => {
        expect(intervalToString(-500)).toBe('< 1m');
    });

    it('returns minutes for values in minute range', () => {
        expect(intervalToString(MINUTE)).toBe('1m');
        expect(intervalToString(5 * MINUTE)).toBe('5m');
        expect(intervalToString(59 * MINUTE)).toBe('59m');
    });

    it('returns hours for values in hour range', () => {
        expect(intervalToString(HOUR)).toBe('1h');
        expect(intervalToString(3 * HOUR)).toBe('3h');
        expect(intervalToString(23 * HOUR)).toBe('23h');
    });

    it('returns days for values in day range', () => {
        expect(intervalToString(DAY)).toBe('1d');
        expect(intervalToString(30 * DAY)).toBe('30d');
        expect(intervalToString(364 * DAY)).toBe('364d');
    });

    it('returns years for values >= 365 days', () => {
        expect(intervalToString(365 * DAY)).toBe('1.0y');
        expect(intervalToString(730 * DAY)).toBe('2.0y');
    });

    it('uses translation function when provided', () => {
        const t = vi.fn((key: string) => `t:${key}`);
        const result = intervalToString(0, t);
        expect(t).toHaveBeenCalledWith('mlearn.Global.Time.LessThanMinute');
        expect(result).toBe('t:mlearn.Global.Time.LessThanMinute');
    });

    it('passes value to translation function for minutes', () => {
        const t = vi.fn((key: string, params?: Record<string, string | number>) => `${params?.value}${key}`);
        intervalToString(5 * MINUTE, t);
        expect(t).toHaveBeenCalledWith('mlearn.Global.Time.ShortMinute', { value: 5 });
    });

    it('passes value to translation function for hours', () => {
        const t = vi.fn((key: string, params?: Record<string, string | number>) => `${params?.value}${key}`);
        intervalToString(3 * HOUR, t);
        expect(t).toHaveBeenCalledWith('mlearn.Global.Time.ShortHour', { value: 3 });
    });

    it('passes value to translation function for days', () => {
        const t = vi.fn((key: string, params?: Record<string, string | number>) => `${params?.value}${key}`);
        intervalToString(10 * DAY, t);
        expect(t).toHaveBeenCalledWith('mlearn.Global.Time.ShortDay', { value: 10 });
    });

    it('passes value to translation function for years', () => {
        const t = vi.fn((key: string, params?: Record<string, string | number>) => `${params?.value}${key}`);
        intervalToString(365 * DAY, t);
        expect(t).toHaveBeenCalledWith('mlearn.Global.Time.ShortYear', { value: '1.0' });
    });
});

// ---------------------------------------------------------------------------
// dueDateToString
// ---------------------------------------------------------------------------

describe('dueDateToString', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns "now" when due date is in the past (no t)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        expect(dueDateToString(999000)).toBe('now');
    });

    it('returns "now" when due date equals current time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        expect(dueDateToString(1000000)).toBe('now');
    });

    it('returns interval string for future due date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        expect(dueDateToString(5 * MINUTE)).toBe('5m');
    });

    it('calls t with Now key when past and t provided', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const t = vi.fn(() => 'translated-now');
        const result = dueDateToString(500000, t);
        expect(t).toHaveBeenCalledWith('mlearn.Global.Time.Now');
        expect(result).toBe('translated-now');
    });

    it('delegates to intervalToString with t for future dates', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const t = vi.fn((key: string) => `t:${key}`);
        const result = dueDateToString(5 * MINUTE, t);
        expect(t).toHaveBeenCalledWith('mlearn.Global.Time.ShortMinute', { value: 5 });
        expect(result).toBe('t:mlearn.Global.Time.ShortMinute');
    });
});

// ---------------------------------------------------------------------------
// getDefaultMeta
// ---------------------------------------------------------------------------

describe('getDefaultMeta', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns expected default values', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const meta = getDefaultMeta(4);
        expect(meta.newCardsToday).toBe(0);
        expect(meta.reviewsToday).toBe(0);
        expect(meta.maxNewCardsPerDay).toBe(20);
        expect(meta.maxNewCardsPerDayLearning).toBe(20);
        expect(meta.maxReviewsPerDay).toBe(-1);
        expect(meta.learningSteps).toEqual([1, 10]);
        expect(meta.relearnSteps).toEqual([10]);
        expect(meta.graduatingInterval).toBe(1);
        expect(meta.easyInterval).toBe(4);
        expect(meta.newIntervalModifier).toBe(100);
        expect(meta.reviewIntervalModifier).toBe(100);
        expect(meta.maxInterval).toBe(36500);
    });

    it('sets newCardsDate to today string respecting newDayHour', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const meta = getDefaultMeta(4);
        expect(meta.newCardsDate).toBe('2025-06-15');
    });

    it('defaults newDayHour to 4', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T12:00:00'));
        const metaDefault = getDefaultMeta();
        const meta4 = getDefaultMeta(4);
        expect(metaDefault.newCardsDate).toBe(meta4.newCardsDate);
    });
});

// ---------------------------------------------------------------------------
// answerCard — new state
// ---------------------------------------------------------------------------

describe('answerCard: new state', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('again: transitions to learning at step 0 with 1-minute delay', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'new' });
        const meta = createTestMeta({ learningSteps: [1, 10] });
        const result = answerCard(card, 'again', meta);
        expect(result.state).toBe('learning');
        expect(result.learningStep).toBe(0);
        expect(result.dueDate).toBe(now + 1 * MINUTE);
    });

    it('hard: transitions to learning at step 0 with 1.5x first-step delay', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'new' });
        const meta = createTestMeta({ learningSteps: [1, 10] });
        const result = answerCard(card, 'hard', meta);
        expect(result.state).toBe('learning');
        expect(result.learningStep).toBe(0);
        expect(result.dueDate).toBe(now + 1 * MINUTE * 1.5);
    });

    it('good with 2 steps: transitions to learning step 1 with 10-minute delay', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'new' });
        const meta = createTestMeta({ learningSteps: [1, 10] });
        const result = answerCard(card, 'good', meta);
        expect(result.state).toBe('learning');
        expect(result.learningStep).toBe(1);
        expect(result.dueDate).toBe(now + 10 * MINUTE);
    });

    it('good with 1 step: graduates directly to review', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'new' });
        const meta = createTestMeta({ learningSteps: [1], graduatingInterval: 1 });
        const result = answerCard(card, 'good', meta);
        expect(result.state).toBe('review');
        expect(result.learningStep).toBe(0);
        expect(result.interval).toBe(1 * DAY);
        expect(result.dueDate).toBe(now + 1 * DAY);
        expect(result.reviews).toBe(1);
    });

    it('easy: graduates immediately with easy interval', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'new', ease: 2.5 });
        const meta = createTestMeta({ easyInterval: 4 });
        const result = answerCard(card, 'easy', meta);
        expect(result.state).toBe('review');
        expect(result.learningStep).toBe(0);
        expect(result.interval).toBe(4 * DAY);
        expect(result.dueDate).toBe(now + 4 * DAY);
        expect(result.reviews).toBe(1);
        expect(result.ease).toBeCloseTo(2.5 + 0.15, 5);
    });

    it('sets lastReviewed and lastUpdated on answer', () => {
        vi.useFakeTimers();
        const now = 5000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'new', lastReviewed: 0, lastUpdated: 0 });
        const result = answerCard(card, 'good', createTestMeta());
        expect(result.lastReviewed).toBe(now);
        expect(result.lastUpdated).toBe(now);
    });
});

// ---------------------------------------------------------------------------
// answerCard — learning state
// ---------------------------------------------------------------------------

describe('answerCard: learning state', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('again: resets to step 0', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'learning', learningStep: 1 });
        const meta = createTestMeta({ learningSteps: [1, 10] });
        const result = answerCard(card, 'again', meta);
        expect(result.state).toBe('learning');
        expect(result.learningStep).toBe(0);
        expect(result.dueDate).toBe(now + 1 * MINUTE);
    });

    it('hard at step 0: repeats current step with 1.5x delay', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'learning', learningStep: 0 });
        const meta = createTestMeta({ learningSteps: [1, 10] });
        const result = answerCard(card, 'hard', meta);
        expect(result.state).toBe('learning');
        expect(result.learningStep).toBe(0);
        expect(result.dueDate).toBe(now + 1 * MINUTE * 1.5);
    });

    it('hard at step 1: repeats step 1 with 1.5x delay', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'learning', learningStep: 1 });
        const meta = createTestMeta({ learningSteps: [1, 10] });
        const result = answerCard(card, 'hard', meta);
        expect(result.dueDate).toBe(now + 10 * MINUTE * 1.5);
    });

    it('good at step 0: advances to step 1', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'learning', learningStep: 0 });
        const meta = createTestMeta({ learningSteps: [1, 10] });
        const result = answerCard(card, 'good', meta);
        expect(result.state).toBe('learning');
        expect(result.learningStep).toBe(1);
        expect(result.dueDate).toBe(now + 10 * MINUTE);
    });

    it('good at last step: graduates to review', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'learning', learningStep: 1, reviews: 0 });
        const meta = createTestMeta({ learningSteps: [1, 10], graduatingInterval: 1 });
        const result = answerCard(card, 'good', meta);
        expect(result.state).toBe('review');
        expect(result.learningStep).toBe(0);
        expect(result.interval).toBe(1 * DAY);
        expect(result.dueDate).toBe(now + 1 * DAY);
        expect(result.reviews).toBe(1);
    });

    it('easy: graduates immediately with easy interval', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'learning', learningStep: 0, ease: 2.5, reviews: 2 });
        const meta = createTestMeta({ easyInterval: 4 });
        const result = answerCard(card, 'easy', meta);
        expect(result.state).toBe('review');
        expect(result.interval).toBe(4 * DAY);
        expect(result.dueDate).toBe(now + 4 * DAY);
        expect(result.reviews).toBe(3);
        expect(result.ease).toBeCloseTo(2.65, 5);
    });
});

// ---------------------------------------------------------------------------
// answerCard — review state
// ---------------------------------------------------------------------------

describe('answerCard: review state', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('again: lapses card, moves to relearning', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY, lapses: 0, reviews: 5 });
        const meta = createTestMeta({ relearnSteps: [10] });
        const result = answerCard(card, 'again', meta);
        expect(result.state).toBe('relearning');
        expect(result.learningStep).toBe(0);
        expect(result.lapses).toBe(1);
        expect(result.ease).toBeCloseTo(2.3, 5);
        // interval = max(1*DAY, 10*DAY * 0.5) = 5*DAY
        expect(result.interval).toBe(5 * DAY);
        expect(result.dueDate).toBe(now + 10 * MINUTE);
    });

    it('again: minimum lapse interval is 1 day', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        // interval < 2 days → max(1*DAY, interval*0.5) = 1*DAY
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 1 * DAY, lapses: 0 });
        const meta = createTestMeta({ relearnSteps: [10] });
        const result = answerCard(card, 'again', meta);
        expect(result.interval).toBe(1 * DAY);
    });

    it('hard: increases interval by 1.2x, decreases ease', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY, reviews: 3 });
        const meta = createTestMeta({ reviewIntervalModifier: 100, maxInterval: 36500 });
        const result = answerCard(card, 'hard', meta);
        expect(result.state).toBe('review');
        expect(result.interval).toBeCloseTo(10 * DAY * 1.2, 0);
        expect(result.ease).toBeCloseTo(2.35, 5);
        expect(result.reviews).toBe(4);
    });

    it('hard: does not exceed maxInterval', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 36500 * DAY, reviews: 1 });
        const meta = createTestMeta({ reviewIntervalModifier: 100, maxInterval: 36500 });
        const result = answerCard(card, 'hard', meta);
        expect(result.interval).toBe(36500 * DAY);
    });

    it('good: multiplies interval by ease, decreases ease unchanged', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY, reviews: 3 });
        const meta = createTestMeta({ reviewIntervalModifier: 100, maxInterval: 36500 });
        const result = answerCard(card, 'good', meta);
        expect(result.state).toBe('review');
        expect(result.interval).toBeCloseTo(10 * DAY * 2.5, 0);
        expect(result.ease).toBeCloseTo(2.5, 5); // good doesn't change ease
        expect(result.reviews).toBe(4);
    });

    it('good: applies reviewIntervalModifier', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'review', ease: 2.0, interval: 10 * DAY });
        const meta = createTestMeta({ reviewIntervalModifier: 150, maxInterval: 36500 });
        const result = answerCard(card, 'good', meta);
        expect(result.interval).toBeCloseTo(10 * DAY * 2.0 * 1.5, 0);
    });

    it('easy: multiplies interval by ease * EASE_BONUS (1.3)', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY, reviews: 3 });
        const meta = createTestMeta({ reviewIntervalModifier: 100, maxInterval: 36500 });
        const result = answerCard(card, 'easy', meta);
        expect(result.state).toBe('review');
        expect(result.interval).toBeCloseTo(10 * DAY * 2.5 * 1.3, 0);
        expect(result.ease).toBeCloseTo(2.65, 5);
        expect(result.reviews).toBe(4);
    });
});

// ---------------------------------------------------------------------------
// answerCard — relearning state
// ---------------------------------------------------------------------------

describe('answerCard: relearning state', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('again: resets to first relearn step', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'relearning', learningStep: 0, interval: 5 * DAY });
        const meta = createTestMeta({ relearnSteps: [10] });
        const result = answerCard(card, 'again', meta);
        expect(result.state).toBe('relearning');
        expect(result.learningStep).toBe(0);
        expect(result.dueDate).toBe(now + 10 * MINUTE);
    });

    it('hard: repeats current relearn step with 1.5x delay', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'relearning', learningStep: 0, interval: 5 * DAY });
        const meta = createTestMeta({ relearnSteps: [10] });
        const result = answerCard(card, 'hard', meta);
        expect(result.dueDate).toBe(now + 10 * MINUTE * 1.5);
    });

    it('good at last relearn step: returns to review with stored interval', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'relearning', learningStep: 0, interval: 5 * DAY });
        const meta = createTestMeta({ relearnSteps: [10] });
        const result = answerCard(card, 'good', meta);
        expect(result.state).toBe('review');
        expect(result.learningStep).toBe(0);
        expect(result.dueDate).toBe(now + 5 * DAY);
    });

    it('good with multiple relearn steps: advances to next step', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'relearning', learningStep: 0, interval: 5 * DAY });
        const meta = createTestMeta({ relearnSteps: [10, 20] });
        const result = answerCard(card, 'good', meta);
        expect(result.state).toBe('relearning');
        expect(result.learningStep).toBe(1);
        expect(result.dueDate).toBe(now + 20 * MINUTE);
    });

    it('easy: returns to review with 1.5x stored interval', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'relearning', learningStep: 0, interval: 5 * DAY });
        const meta = createTestMeta({ relearnSteps: [10], maxInterval: 36500 });
        const result = answerCard(card, 'easy', meta);
        expect(result.state).toBe('review');
        expect(result.learningStep).toBe(0);
        expect(result.interval).toBeCloseTo(5 * DAY * 1.5, 0);
        expect(result.dueDate).toBeCloseTo(now + 5 * DAY * 1.5, 0);
    });

    it('easy: does not exceed maxInterval', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'relearning', learningStep: 0, interval: 36500 * DAY });
        const meta = createTestMeta({ relearnSteps: [10], maxInterval: 36500 });
        const result = answerCard(card, 'easy', meta);
        expect(result.interval).toBe(36500 * DAY);
    });
});

// ---------------------------------------------------------------------------
// ease changes (calculateNewEase)
// ---------------------------------------------------------------------------

describe('ease changes on review cards', () => {
    it('again decreases ease by 0.2 (min 1.3)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY });
        const result = answerCard(card, 'again', createTestMeta());
        expect(result.ease).toBeCloseTo(2.3, 5);
    });

    it('again clamps ease to MIN_EASE (1.3)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const card = createTestCard({ state: 'review', ease: 1.4, interval: 10 * DAY });
        const result = answerCard(card, 'again', createTestMeta());
        expect(result.ease).toBeCloseTo(1.3, 5);
    });

    it('hard decreases ease by 0.15', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY });
        const result = answerCard(card, 'hard', createTestMeta());
        expect(result.ease).toBeCloseTo(2.35, 5);
    });

    it('good keeps ease unchanged', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY });
        const result = answerCard(card, 'good', createTestMeta());
        expect(result.ease).toBeCloseTo(2.5, 5);
    });

    it('easy increases ease by 0.15', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY });
        const result = answerCard(card, 'easy', createTestMeta());
        expect(result.ease).toBeCloseTo(2.65, 5);
    });
});

// ---------------------------------------------------------------------------
// previewAnswers
// ---------------------------------------------------------------------------

describe('previewAnswers', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns due dates for all 4 ratings', () => {
        vi.useFakeTimers();
        const now = 1000000;
        vi.setSystemTime(now);
        const card = createTestCard({ state: 'new' });
        const meta = createTestMeta({ learningSteps: [1, 10], easyInterval: 4 });
        const result = previewAnswers(card, meta);
        expect(typeof result.again).toBe('number');
        expect(typeof result.hard).toBe('number');
        expect(typeof result.good).toBe('number');
        expect(typeof result.easy).toBe('number');
    });

    it('returns increasing due dates: again <= hard <= good <= easy (for new card)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const card = createTestCard({ state: 'new' });
        const meta = createTestMeta({ learningSteps: [1, 10], easyInterval: 4 });
        const result = previewAnswers(card, meta);
        expect(result.again).toBeLessThanOrEqual(result.hard);
        expect(result.hard).toBeLessThanOrEqual(result.good);
        expect(result.good).toBeLessThanOrEqual(result.easy);
    });

    it('easy due date is furthest for review card', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const card = createTestCard({ state: 'review', ease: 2.5, interval: 10 * DAY });
        const meta = createTestMeta();
        const result = previewAnswers(card, meta);
        expect(result.easy).toBeGreaterThan(result.good);
        expect(result.good).toBeGreaterThan(result.hard);
    });
});

// ---------------------------------------------------------------------------
// sortByDueDate
// ---------------------------------------------------------------------------

describe('sortByDueDate', () => {
    it('sorts cards by dueDate ascending', () => {
        const cards = [
            createTestCard({ id: 'c', dueDate: 3000 }),
            createTestCard({ id: 'a', dueDate: 1000 }),
            createTestCard({ id: 'b', dueDate: 2000 }),
        ];
        const sorted = sortByDueDate(cards);
        expect(sorted.map(c => c.id)).toEqual(['a', 'b', 'c']);
    });

    it('does not mutate original array', () => {
        const cards = [
            createTestCard({ id: 'b', dueDate: 2000 }),
            createTestCard({ id: 'a', dueDate: 1000 }),
        ];
        const original = [...cards];
        sortByDueDate(cards);
        expect(cards[0].id).toBe(original[0].id);
    });

    it('handles empty array', () => {
        expect(sortByDueDate([])).toEqual([]);
    });

    it('handles single card', () => {
        const card = createTestCard({ dueDate: 1000 });
        expect(sortByDueDate([card])).toEqual([card]);
    });
});

// ---------------------------------------------------------------------------
// getDueCards
// ---------------------------------------------------------------------------

describe('getDueCards', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('excludes suspended cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 1000, suspended: true }),
        };
        expect(getDueCards(cards, 4)).toHaveLength(0);
    });

    it('excludes buried cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 1000, buried: true }),
        };
        expect(getDueCards(cards, 4)).toHaveLength(0);
    });

    it('includes learning cards due now', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 1000 }),
        };
        const result = getDueCards(cards, 4);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('a');
    });

    it('excludes learning cards not yet due (beyond SRS day)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: new Date('2025-06-16T10:00:00').getTime() }),
        };
        expect(getDueCards(cards, 4)).toHaveLength(0);
    });

    it('includes learning cards due within end of SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // endOfDay = June 16 4 AM
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: new Date('2025-06-15T23:00:00').getTime() }),
        };
        const result = getDueCards(cards, 4);
        expect(result).toHaveLength(1);
    });

    it('includes review cards due within end of SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // 10 AM, endOfDay = June 16 4 AM
        const endOfDay = new Date('2025-06-16T03:00:00').getTime(); // before end of day
        const cards = {
            a: createTestCard({ id: 'a', state: 'review', interval: DAY, dueDate: endOfDay }),
        };
        const result = getDueCards(cards, 4);
        expect(result).toHaveLength(1);
    });

    it('excludes review cards due after end of SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // endOfDay = June 16 4 AM
        const afterEndOfDay = new Date('2025-06-16T05:00:00').getTime();
        const cards = {
            a: createTestCard({ id: 'a', state: 'review', interval: DAY, dueDate: afterEndOfDay }),
        };
        expect(getDueCards(cards, 4)).toHaveLength(0);
    });

    it('sorts results by dueDate', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            b: createTestCard({ id: 'b', state: 'learning', dueDate: now - 500 }),
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 1000 }),
        };
        const result = getDueCards(cards, 4);
        expect(result[0].id).toBe('a');
        expect(result[1].id).toBe('b');
    });
});

// ---------------------------------------------------------------------------
// getNewCards
// ---------------------------------------------------------------------------

describe('getNewCards', () => {
    it('returns only new cards, sorted by createdAt', () => {
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'new', createdAt: now - 2000 }),
            b: createTestCard({ id: 'b', state: 'review', createdAt: now - 3000 }),
            c: createTestCard({ id: 'c', state: 'new', createdAt: now - 1000 }),
        };
        const result = getNewCards(cards);
        expect(result.map(c => c.id)).toEqual(['a', 'c']);
    });

    it('excludes suspended new cards', () => {
        const cards = {
            a: createTestCard({ id: 'a', state: 'new', suspended: true }),
        };
        expect(getNewCards(cards)).toHaveLength(0);
    });

    it('excludes buried new cards', () => {
        const cards = {
            a: createTestCard({ id: 'a', state: 'new', buried: true }),
        };
        expect(getNewCards(cards)).toHaveLength(0);
    });

    it('returns empty array when no new cards', () => {
        const cards = {
            a: createTestCard({ id: 'a', state: 'review' }),
        };
        expect(getNewCards(cards)).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// getLearningCards
// ---------------------------------------------------------------------------

describe('getLearningCards', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns learning cards that are due now', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 500 }),
        };
        const result = getLearningCards(cards);
        expect(result).toHaveLength(1);
    });

    it('excludes learning cards not yet due (beyond SRS day)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: new Date('2025-06-16T10:00:00').getTime() }),
        };
        expect(getLearningCards(cards, 4)).toHaveLength(0);
    });

    it('includes learning cards due within same SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: new Date('2025-06-15T12:00:00').getTime() }),
        };
        expect(getLearningCards(cards, 4)).toHaveLength(1);
    });

    it('excludes relearning cards (they are not "learning")', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'relearning', dueDate: now - 500 }),
        };
        expect(getLearningCards(cards)).toHaveLength(0);
    });

    it('excludes suspended and buried', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 500, suspended: true }),
            b: createTestCard({ id: 'b', state: 'learning', dueDate: now - 500, buried: true }),
        };
        expect(getLearningCards(cards)).toHaveLength(0);
    });

    it('sorts by dueDate ascending', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const cards = {
            b: createTestCard({ id: 'b', state: 'learning', dueDate: now - 100 }),
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 500 }),
        };
        const result = getLearningCards(cards);
        expect(result[0].id).toBe('a');
    });
});

// ---------------------------------------------------------------------------
// getReviewCards
// ---------------------------------------------------------------------------

describe('getReviewCards', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns review cards due by end of SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // endOfDay = June 16 4 AM
        const dueBeforeEnd = new Date('2025-06-15T22:00:00').getTime();
        const cards = {
            a: createTestCard({ id: 'a', state: 'review', interval: DAY, dueDate: dueBeforeEnd }),
        };
        expect(getReviewCards(cards, 4)).toHaveLength(1);
    });

    it('excludes review cards due after end of SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const dueAfterEnd = new Date('2025-06-16T06:00:00').getTime();
        const cards = {
            a: createTestCard({ id: 'a', state: 'review', interval: DAY, dueDate: dueAfterEnd }),
        };
        expect(getReviewCards(cards, 4)).toHaveLength(0);
    });

    it('excludes non-review cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 1000 }),
        };
        expect(getReviewCards(cards, 4)).toHaveLength(0);
    });

    it('sorts by dueDate ascending', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            b: createTestCard({ id: 'b', state: 'review', interval: DAY, dueDate: now - 100 }),
            a: createTestCard({ id: 'a', state: 'review', interval: DAY, dueDate: now - 500 }),
        };
        const result = getReviewCards(cards, 4);
        expect(result[0].id).toBe('a');
    });
});

// ---------------------------------------------------------------------------
// buildReviewQueue
// ---------------------------------------------------------------------------

describe('buildReviewQueue', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('builds queue with new, learning, review, relearn cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            new1: createTestCard({ id: 'new1', state: 'new', dueDate: now }),
            learn1: createTestCard({ id: 'learn1', state: 'learning', dueDate: now - 1000 }),
            rev1: createTestCard({ id: 'rev1', state: 'review', interval: DAY, dueDate: now - 1000 }),
            relearn1: createTestCard({ id: 'relearn1', state: 'relearning', learningStep: 0, dueDate: now - 500 }),
        };
        const queue = buildReviewQueue(cards, 20, 0);
        expect(queue.newQueue).toContain('new1');
        expect(queue.learningQueue).toContain('learn1');
        expect(queue.reviewQueue).toContain('rev1');
        expect(queue.relearnQueue).toContain('relearn1');
    });

    it('limits new cards by maxNewCards - newCardsToday', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards: Record<string, Flashcard> = {};
        for (let i = 0; i < 10; i++) {
            cards[`new${i}`] = createTestCard({ id: `new${i}`, state: 'new', createdAt: now + i, dueDate: now });
        }
        // maxNewCards=5, already seen 2 → only 3 remaining
        const queue = buildReviewQueue(cards, 5, 2);
        expect(queue.newQueue).toHaveLength(3);
    });

    it('limits new cards by maxNewCardsPerDayLearning', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards: Record<string, Flashcard> = {};
        for (let i = 0; i < 10; i++) {
            cards[`new${i}`] = createTestCard({ id: `new${i}`, state: 'new', createdAt: now + i, dueDate: now });
        }
        const queue = buildReviewQueue(cards, 20, 0, 3);
        expect(queue.newQueue).toHaveLength(3);
    });

    it('does not limit new cards when maxNewCardsPerDayLearning is undefined', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards: Record<string, Flashcard> = {};
        for (let i = 0; i < 5; i++) {
            cards[`new${i}`] = createTestCard({ id: `new${i}`, state: 'new', createdAt: now + i, dueDate: now });
        }
        const queue = buildReviewQueue(cards, 20, 0, undefined);
        expect(queue.newQueue).toHaveLength(5);
    });

    it('limits reviews by maxReviewsPerDay', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards: Record<string, Flashcard> = {};
        for (let i = 0; i < 10; i++) {
            cards[`rev${i}`] = createTestCard({ id: `rev${i}`, state: 'review', interval: DAY, dueDate: now - i * 1000 });
        }
        const queue = buildReviewQueue(cards, 0, 0, undefined, 4, 1);
        expect(queue.reviewQueue).toHaveLength(3); // max 4 - already done 1 = 3 remaining
    });

    it('does not limit reviews when maxReviewsPerDay is -1', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards: Record<string, Flashcard> = {};
        for (let i = 0; i < 5; i++) {
            cards[`rev${i}`] = createTestCard({ id: `rev${i}`, state: 'review', interval: DAY, dueDate: now - i * 1000 });
        }
        const queue = buildReviewQueue(cards, 0, 0, undefined, -1, 0);
        expect(queue.reviewQueue).toHaveLength(5);
    });
});

// ---------------------------------------------------------------------------
// getNextCard
// ---------------------------------------------------------------------------

describe('getNextCard', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('returns null for empty queues', () => {
        const queue = createEmptyQueue();
        expect(getNextCard(queue, {})).toBeNull();
    });

    it('prefers relearning over learning', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const cards = {
            learn: createTestCard({ id: 'learn', state: 'learning', dueDate: now - 100 }),
            relearn: createTestCard({ id: 'relearn', state: 'relearning', dueDate: now - 100 }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            learningQueue: ['learn'],
            relearnQueue: ['relearn'],
        };
        expect(getNextCard(queue, cards)?.id).toBe('relearn');
    });

    it('skips relearning cards beyond SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            learn: createTestCard({ id: 'learn', state: 'learning', dueDate: now - 100 }),
            relearn: createTestCard({ id: 'relearn', state: 'relearning', dueDate: new Date('2025-06-17T10:00:00').getTime() }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            learningQueue: ['learn'],
            relearnQueue: ['relearn'],
        };
        expect(getNextCard(queue, cards)?.id).toBe('learn');
    });

    it('shows relearning cards due within same SRS day even if future', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00'));
        const now = Date.now();
        const cards = {
            learn: createTestCard({ id: 'learn', state: 'learning', dueDate: now - 100 }),
            relearn: createTestCard({ id: 'relearn', state: 'relearning', dueDate: now + 10 * MINUTE }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            learningQueue: ['learn'],
            relearnQueue: ['relearn'],
        };
        // Relearning is still within SRS day, so it takes priority
        expect(getNextCard(queue, cards)?.id).toBe('relearn');
    });

    it('prefers learning over review when Math.random forces new card skip', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        // Mock Math.random to NOT pick new card (>= 0.1)
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const cards = {
            learn: createTestCard({ id: 'learn', state: 'learning', dueDate: now - 100 }),
            rev: createTestCard({ id: 'rev', state: 'review', dueDate: now - 100 }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            learningQueue: ['learn'],
            reviewQueue: ['rev'],
        };
        expect(getNextCard(queue, cards)?.id).toBe('learn');
    });

    it('returns review card when only review queue has items', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const cards = {
            rev: createTestCard({ id: 'rev', state: 'review', dueDate: now - 100 }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            reviewQueue: ['rev'],
        };
        expect(getNextCard(queue, cards)?.id).toBe('rev');
    });

    it('returns new card when no review cards exist', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const cards = {
            newcard: createTestCard({ id: 'newcard', state: 'new', dueDate: now }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            newQueue: ['newcard'],
        };
        expect(getNextCard(queue, cards)?.id).toBe('newcard');
    });

    it('returns new card when Math.random < 0.1 (interleaving)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        vi.spyOn(Math, 'random').mockReturnValue(0.05); // forces new card interleave
        const cards = {
            newcard: createTestCard({ id: 'newcard', state: 'new', dueDate: now }),
            rev: createTestCard({ id: 'rev', state: 'review', dueDate: now - 100 }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            newQueue: ['newcard'],
            reviewQueue: ['rev'],
        };
        expect(getNextCard(queue, cards)?.id).toBe('newcard');
    });

    it('skips cards not in expected state (stale queue entries)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const cards = {
            // Card is in relearnQueue but state is 'review' (stale)
            stale: createTestCard({ id: 'stale', state: 'review', dueDate: now - 100 }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            relearnQueue: ['stale'],
        };
        expect(getNextCard(queue, cards)).toBeNull();
    });

    it('skips suspended cards in queue', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const cards = {
            rev: createTestCard({ id: 'rev', state: 'review', dueDate: now - 100, suspended: true }),
        };
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            reviewQueue: ['rev'],
        };
        expect(getNextCard(queue, cards)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// removeFromQueue
// ---------------------------------------------------------------------------

describe('removeFromQueue', () => {
    it('removes card from newQueue', () => {
        const queue: ReviewQueue = { ...createEmptyQueue(), newQueue: ['a', 'b', 'c'] };
        const result = removeFromQueue(queue, 'b');
        expect(result.newQueue).toEqual(['a', 'c']);
    });

    it('removes card from learningQueue', () => {
        const queue: ReviewQueue = { ...createEmptyQueue(), learningQueue: ['a', 'b'] };
        const result = removeFromQueue(queue, 'a');
        expect(result.learningQueue).toEqual(['b']);
    });

    it('removes card from reviewQueue', () => {
        const queue: ReviewQueue = { ...createEmptyQueue(), reviewQueue: ['x', 'y'] };
        const result = removeFromQueue(queue, 'y');
        expect(result.reviewQueue).toEqual(['x']);
    });

    it('removes card from relearnQueue', () => {
        const queue: ReviewQueue = { ...createEmptyQueue(), relearnQueue: ['r1'] };
        const result = removeFromQueue(queue, 'r1');
        expect(result.relearnQueue).toEqual([]);
    });

    it('does nothing when card not in any queue', () => {
        const queue: ReviewQueue = { ...createEmptyQueue(), newQueue: ['a'] };
        const result = removeFromQueue(queue, 'nonexistent');
        expect(result.newQueue).toEqual(['a']);
    });

    it('removes from all queues if present in multiple (deduplication)', () => {
        const queue: ReviewQueue = {
            newQueue: ['a'],
            learningQueue: ['a'],
            reviewQueue: ['a'],
            relearnQueue: ['a'],
        };
        const result = removeFromQueue(queue, 'a');
        expect(result.newQueue).toEqual([]);
        expect(result.learningQueue).toEqual([]);
        expect(result.reviewQueue).toEqual([]);
        expect(result.relearnQueue).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// addToQueue
// ---------------------------------------------------------------------------

describe('addToQueue', () => {
    it('adds new card to newQueue', () => {
        const queue = createEmptyQueue();
        const card = createTestCard({ id: 'test', state: 'new' });
        const result = addToQueue(queue, card);
        expect(result.newQueue).toContain('test');
    });

    it('adds learning card to learningQueue', () => {
        const queue = createEmptyQueue();
        const card = createTestCard({ id: 'test', state: 'learning' });
        const result = addToQueue(queue, card);
        expect(result.learningQueue).toContain('test');
    });

    it('adds review card to reviewQueue', () => {
        const queue = createEmptyQueue();
        const card = createTestCard({ id: 'test', state: 'review' });
        const result = addToQueue(queue, card);
        expect(result.reviewQueue).toContain('test');
    });

    it('adds relearning card to relearnQueue', () => {
        const queue = createEmptyQueue();
        const card = createTestCard({ id: 'test', state: 'relearning' });
        const result = addToQueue(queue, card);
        expect(result.relearnQueue).toContain('test');
    });

    it('removes card from old queue before adding to new one', () => {
        const queue: ReviewQueue = { ...createEmptyQueue(), learningQueue: ['test'] };
        const card = createTestCard({ id: 'test', state: 'review' });
        const result = addToQueue(queue, card);
        expect(result.learningQueue).not.toContain('test');
        expect(result.reviewQueue).toContain('test');
    });

    it('does not duplicate card in target queue', () => {
        const queue: ReviewQueue = { ...createEmptyQueue(), newQueue: ['test'] };
        const card = createTestCard({ id: 'test', state: 'new' });
        const result = addToQueue(queue, card);
        expect(result.newQueue.filter(id => id === 'test')).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// getNextPendingLearningDueDate
// ---------------------------------------------------------------------------

describe('getNextPendingLearningDueDate', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null when no learning cards in queue', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        expect(getNextPendingLearningDueDate(createEmptyQueue(), {})).toBeNull();
    });

    it('returns null when all learning cards are already due', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const queue: ReviewQueue = { ...createEmptyQueue(), learningQueue: ['a'] };
        const cards = { a: createTestCard({ id: 'a', state: 'learning', dueDate: now - 500 }) };
        expect(getNextPendingLearningDueDate(queue, cards)).toBeNull();
    });

    it('returns earliest due date beyond SRS day from learningQueue', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // endOfDay = June 16 4 AM
        const queue: ReviewQueue = { ...createEmptyQueue(), learningQueue: ['a', 'b'] };
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: new Date('2025-06-16T12:00:00').getTime() }),
            b: createTestCard({ id: 'b', state: 'learning', dueDate: new Date('2025-06-16T06:00:00').getTime() }),
        };
        expect(getNextPendingLearningDueDate(queue, cards)).toBe(new Date('2025-06-16T06:00:00').getTime());
    });

    it('returns null when all learning cards are within SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // endOfDay = June 16 4 AM
        const queue: ReviewQueue = { ...createEmptyQueue(), learningQueue: ['a'] };
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: new Date('2025-06-15T23:00:00').getTime() }),
        };
        expect(getNextPendingLearningDueDate(queue, cards)).toBeNull();
    });

    it('considers relearnQueue too', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // endOfDay = June 16 4 AM
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            learningQueue: ['a'],
            relearnQueue: ['b'],
        };
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: new Date('2025-06-16T10:00:00').getTime() }),
            b: createTestCard({ id: 'b', state: 'relearning', dueDate: new Date('2025-06-16T06:00:00').getTime() }),
        };
        expect(getNextPendingLearningDueDate(queue, cards)).toBe(new Date('2025-06-16T06:00:00').getTime());
    });

    it('ignores suspended cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const queue: ReviewQueue = { ...createEmptyQueue(), learningQueue: ['a'] };
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now + 5 * MINUTE, suspended: true }),
        };
        expect(getNextPendingLearningDueDate(queue, cards)).toBeNull();
    });

    it('ignores buried cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const queue: ReviewQueue = { ...createEmptyQueue(), learningQueue: ['a'] };
        const cards = {
            a: createTestCard({ id: 'a', state: 'learning', dueDate: now + 5 * MINUTE, buried: true }),
        };
        expect(getNextPendingLearningDueDate(queue, cards)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// getQueueCounts
// ---------------------------------------------------------------------------

describe('getQueueCounts', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns all zeros for empty queue', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const result = getQueueCounts(createEmptyQueue(), {});
        expect(result).toEqual({ new: 0, learning: 0, review: 0, total: 0 });
    });

    it('counts new cards from newQueue length', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const queue: ReviewQueue = { ...createEmptyQueue(), newQueue: ['a', 'b'] };
        const cards = {
            a: createTestCard({ id: 'a', state: 'new' }),
            b: createTestCard({ id: 'b', state: 'new' }),
        };
        const result = getQueueCounts(queue, cards);
        expect(result.new).toBe(2);
    });

    it('counts learning cards due within SRS day', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-06-15T10:00:00')); // endOfDay = June 16 4 AM
        const now = Date.now();
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            learningQueue: ['due', 'future', 'beyond'],
        };
        const cards = {
            due: createTestCard({ id: 'due', state: 'learning', dueDate: now - 500 }),
            future: createTestCard({ id: 'future', state: 'learning', dueDate: now + MINUTE }),
            beyond: createTestCard({ id: 'beyond', state: 'learning', dueDate: new Date('2025-06-16T10:00:00').getTime() }),
        };
        const result = getQueueCounts(queue, cards);
        // 'due' and 'future' are within SRS day; 'beyond' is not
        expect(result.learning).toBe(2);
    });

    it('counts relearn cards in learning count', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            relearnQueue: ['r'],
        };
        const cards = {
            r: createTestCard({ id: 'r', state: 'relearning', dueDate: now - 100 }),
        };
        const result = getQueueCounts(queue, cards);
        expect(result.learning).toBe(1);
    });

    it('counts all review queue items (regardless of exact due time)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            reviewQueue: ['r1', 'r2'],
        };
        const cards = {
            r1: createTestCard({ id: 'r1', state: 'review', dueDate: now + HOUR }),
            r2: createTestCard({ id: 'r2', state: 'review', dueDate: now - 100 }),
        };
        const result = getQueueCounts(queue, cards);
        expect(result.review).toBe(2);
    });

    it('excludes suspended/buried review cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const queue: ReviewQueue = {
            ...createEmptyQueue(),
            reviewQueue: ['r1'],
        };
        const cards = {
            r1: createTestCard({ id: 'r1', state: 'review', dueDate: now - 100, suspended: true }),
        };
        const result = getQueueCounts(queue, cards);
        expect(result.review).toBe(0);
    });

    it('total is sum of new + learning + review', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const now = Date.now();
        const queue: ReviewQueue = {
            newQueue: ['n'],
            learningQueue: ['l'],
            reviewQueue: ['r'],
            relearnQueue: [],
        };
        const cards = {
            n: createTestCard({ id: 'n', state: 'new' }),
            l: createTestCard({ id: 'l', state: 'learning', dueDate: now - 100 }),
            r: createTestCard({ id: 'r', state: 'review', dueDate: now - 100 }),
        };
        const result = getQueueCounts(queue, cards);
        expect(result.total).toBe(result.new + result.learning + result.review);
    });
});

// ---------------------------------------------------------------------------
// buryCard
// ---------------------------------------------------------------------------

describe('buryCard', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('sets buried flag to true', () => {
        const card = createTestCard({ buried: false });
        const result = buryCard(card);
        expect(result.buried).toBe(true);
    });

    it('does not mutate original card', () => {
        const card = createTestCard({ buried: false });
        buryCard(card);
        expect(card.buried).toBe(false);
    });

    it('updates lastUpdated', () => {
        vi.useFakeTimers();
        const now = 9999999;
        vi.setSystemTime(now);
        const card = createTestCard({ lastUpdated: 0 });
        const result = buryCard(card);
        expect(result.lastUpdated).toBe(now);
    });

    it('preserves all other fields', () => {
        const card = createTestCard({ id: 'keep-me', state: 'review', ease: 3.0 });
        const result = buryCard(card);
        expect(result.id).toBe('keep-me');
        expect(result.state).toBe('review');
        expect(result.ease).toBe(3.0);
    });
});

// ---------------------------------------------------------------------------
// suspendCard
// ---------------------------------------------------------------------------

describe('suspendCard', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('sets suspended flag to true', () => {
        const card = createTestCard({ suspended: false });
        const result = suspendCard(card);
        expect(result.suspended).toBe(true);
    });

    it('does not mutate original card', () => {
        const card = createTestCard({ suspended: false });
        suspendCard(card);
        expect(card.suspended).toBe(false);
    });

    it('updates lastUpdated', () => {
        vi.useFakeTimers();
        const now = 9999999;
        vi.setSystemTime(now);
        const card = createTestCard({ lastUpdated: 0 });
        const result = suspendCard(card);
        expect(result.lastUpdated).toBe(now);
    });

    it('preserves all other fields', () => {
        const card = createTestCard({ id: 'keep-me', state: 'learning', ease: 1.8 });
        const result = suspendCard(card);
        expect(result.id).toBe('keep-me');
        expect(result.state).toBe('learning');
        expect(result.ease).toBe(1.8);
    });
});

// ---------------------------------------------------------------------------
// unburyCards
// ---------------------------------------------------------------------------

describe('unburyCards', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('unburied flag set to false on all buried cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const cards = {
            a: createTestCard({ id: 'a', buried: true }),
            b: createTestCard({ id: 'b', buried: true }),
        };
        const result = unburyCards(cards);
        expect(result.a.buried).toBe(false);
        expect(result.b.buried).toBe(false);
    });

    it('leaves non-buried cards unchanged', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const cards = {
            a: createTestCard({ id: 'a', buried: false, ease: 2.5 }),
        };
        const result = unburyCards(cards);
        expect(result.a).toBe(cards.a); // same reference for unchanged
    });

    it('updates lastUpdated for unburied cards', () => {
        vi.useFakeTimers();
        const now = 5000000;
        vi.setSystemTime(now);
        const cards = {
            a: createTestCard({ id: 'a', buried: true, lastUpdated: 0 }),
        };
        const result = unburyCards(cards);
        expect(result.a.lastUpdated).toBe(now);
    });

    it('does not mutate original cards', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const cards = {
            a: createTestCard({ id: 'a', buried: true }),
        };
        unburyCards(cards);
        expect(cards.a.buried).toBe(true);
    });

    it('preserves all card ids', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const cards = {
            a: createTestCard({ id: 'a', buried: true }),
            b: createTestCard({ id: 'b', buried: false }),
            c: createTestCard({ id: 'c', buried: true }),
        };
        const result = unburyCards(cards);
        expect(Object.keys(result)).toHaveLength(3);
        expect(result.a).toBeDefined();
        expect(result.b).toBeDefined();
        expect(result.c).toBeDefined();
    });

    it('handles empty cards record', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        const result = unburyCards({});
        expect(result).toEqual({});
    });
});
