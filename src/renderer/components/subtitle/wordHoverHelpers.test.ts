import { describe, it, expect } from 'vitest';
import type { Flashcard } from '../../../shared/types';
import {
  getStatusSource,
  getEffectiveWordStatus,
  numericToWordStatus,
  wordStatusToNumeric,
} from './wordHoverHelpers';
import { WORD_STATUS } from '../../../shared/constants';

function makeCard(state: Flashcard['state']): Flashcard {
  return { state } as Flashcard;
}

describe('getStatusSource', () => {
  it('returns "flashcards" when a flashcard exists', () => {
    expect(getStatusSource(makeCard('new'), 'unknown', false)).toBe('flashcards');
    expect(getStatusSource(makeCard('review'), 'known', true)).toBe('flashcards');
  });

  it('returns "anki" when no flashcard but word is in Anki', () => {
    expect(getStatusSource(null, 'unknown', true)).toBe('anki');
    expect(getStatusSource(null, 'known', true)).toBe('anki');
  });

  it('returns "manual" when no flashcard, not in Anki, but has manual status', () => {
    expect(getStatusSource(null, 'learning', false)).toBe('manual');
    expect(getStatusSource(null, 'known', false)).toBe('manual');
  });

  it('returns "nothing" when no flashcard, not in Anki, and status is unknown', () => {
    expect(getStatusSource(null, 'unknown', false)).toBe('nothing');
  });
});

describe('getEffectiveWordStatus', () => {
  it('returns "learning" for new/learning/relearning flashcard states', () => {
    expect(getEffectiveWordStatus(makeCard('new'), 'unknown')).toBe('learning');
    expect(getEffectiveWordStatus(makeCard('learning'), 'unknown')).toBe('learning');
    expect(getEffectiveWordStatus(makeCard('relearning'), 'known')).toBe('learning');
  });

  it('returns "known" for review flashcard state', () => {
    expect(getEffectiveWordStatus(makeCard('review'), 'unknown')).toBe('known');
  });

  it('falls back to manualStatus when no card', () => {
    expect(getEffectiveWordStatus(null, 'unknown')).toBe('unknown');
    expect(getEffectiveWordStatus(null, 'learning')).toBe('learning');
    expect(getEffectiveWordStatus(null, 'known')).toBe('known');
  });
});

describe('numericToWordStatus', () => {
  it('converts WORD_STATUS values', () => {
    expect(numericToWordStatus(WORD_STATUS.UNKNOWN)).toBe('unknown');
    expect(numericToWordStatus(WORD_STATUS.LEARNING)).toBe('learning');
    expect(numericToWordStatus(WORD_STATUS.KNOWN)).toBe('known');
  });

  it('defaults to unknown for unrecognized', () => {
    expect(numericToWordStatus(999)).toBe('unknown');
  });
});

describe('wordStatusToNumeric', () => {
  it('converts word status strings', () => {
    expect(wordStatusToNumeric('unknown')).toBe(WORD_STATUS.UNKNOWN);
    expect(wordStatusToNumeric('learning')).toBe(WORD_STATUS.LEARNING);
    expect(wordStatusToNumeric('known')).toBe(WORD_STATUS.KNOWN);
  });
});
