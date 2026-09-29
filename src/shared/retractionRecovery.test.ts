import { describe, it, expect } from 'vitest';
import { isPendingRetraction, readPendingRetraction, readRetractionCompletionClaim, type PendingRetraction } from './retractionRecovery';

const record = (over: Partial<PendingRetraction> = {}): PendingRetraction => ({
  attemptId: 'attempt-1',
  surface: 'word-sync',
  word: 'word',
  language: 'lang',
  attemptIds: ['attempt-1'],
  restore: { position: 3 },
  ...over,
});

describe('pending retraction record', () => {
  it('accepts a complete record so a reloaded window can finish the Undo', () => {
    expect(isPendingRetraction(record())).toBe(true);
  });

  it('rejects a record missing anything recovery depends on', () => {
    // A half-record must not be acted on: applying the journal half and
    // skipping the projection half is worse than leaving the Undo visibly
    // unfinished, and treating it as "nothing to recover" is the exact silent
    // loss the record exists to prevent.
    expect(isPendingRetraction(null)).toBe(false);
    expect(isPendingRetraction([])).toBe(false);
    expect(isPendingRetraction({ ...record(), attemptId: '' })).toBe(false);
    expect(isPendingRetraction({ ...record(), surface: '' })).toBe(false);
    expect(isPendingRetraction({ ...record(), attemptIds: 'attempt-1' })).toBe(false);
    expect(isPendingRetraction({ ...record(), attemptIds: [1] })).toBe(false);
    expect(isPendingRetraction({ ...record(), word: 5 })).toBe(false);
    expect(isPendingRetraction({ ...record(), language: undefined })).toBe(false);
    // The projection may legitimately be null, but it must be present: a
    // missing `restore` is a truncated record, not a surface that restores
    // nothing.
    expect(isPendingRetraction({ ...record(), restore: undefined })).toBe(false);
    expect(isPendingRetraction({ ...record(), restore: null })).toBe(true);
  });

  it('keeps an unfamiliar surface and projection without interpreting them', () => {
    // Core must not have to learn a new surface's vocabulary for its record to
    // survive the round trip.
    const custom = record({ surface: 'some-third-party-surface', restore: { anything: { nested: true } } });
    expect(readPendingRetraction(custom)).toEqual(custom);
  });

  it('upgrades a pre-envelope review record instead of discarding it', () => {
    // Stores written before the envelope persisted the review Undo under its
    // own field. Dropping it would strand exactly the interrupted Undo the
    // record was written to rescue, so it is lifted into the envelope.
    const legacy = {
      attemptId: 'old-attempt',
      type: 'answer',
      cardId: 'card-1',
      restoreCard: { id: 'card-1' },
      word: 'word',
      language: 'lang',
      restorePerLanguage: null,
      today: '2026-01-01',
      restoreDailyStats: null,
    };
    expect(readPendingRetraction(legacy)).toEqual({
      attemptId: 'old-attempt',
      surface: 'flashcard-review',
      word: 'word',
      language: 'lang',
      attemptIds: ['old-attempt'],
      restore: {
        type: 'answer',
        cardId: 'card-1',
        restoreCard: { id: 'card-1' },
        restorePerLanguage: null,
        today: '2026-01-01',
        restoreDailyStats: null,
      },
    });
  });

  it('reads nothing recoverable from an absent or unusable record', () => {
    expect(readPendingRetraction(undefined)).toBeNull();
    expect(readPendingRetraction(null)).toBeNull();
    expect(readPendingRetraction('not a record')).toBeNull();
    expect(readPendingRetraction({ attemptId: 'a' })).toBeNull();
    expect(readPendingRetraction({ attemptId: '', word: 'w', language: 'l' })).toBeNull();
  });
});

describe('retraction completion claim', () => {
  it('is read from a write that dropped the record it is finishing', () => {
    // The two cases a whole-store save otherwise cannot tell apart: a window
    // completing an Undo, and a window that has simply never seen one.
    expect(readRetractionCompletionClaim({ retractionCompleted: 'attempt-1' }))
      .toEqual({ attemptId: 'attempt-1' });
  });

  it('is absent from an ordinary save that never heard of the Undo', () => {
    expect(readRetractionCompletionClaim({})).toBeNull();
    expect(readRetractionCompletionClaim({ retractionCompleted: '' })).toBeNull();
    expect(readRetractionCompletionClaim({ retractionCompleted: 42 })).toBeNull();
  });

  it('does not count as a completion while the write still carries a record', () => {
    // A write that kept the record is not finishing anything, whatever it
    // claims — otherwise a stale claim could retire an Undo still in flight.
    expect(readRetractionCompletionClaim({
      retractionCompleted: 'attempt-1',
      pendingRetraction: record({ attemptId: 'attempt-2' }),
    })).toBeNull();
  });
});
