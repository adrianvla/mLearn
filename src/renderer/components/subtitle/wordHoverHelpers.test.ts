import { describe, it, expect } from 'vitest';
import type { Flashcard } from '../../../shared/types';
import {
  resolveWordKnowledge,
  getEffectiveWordStatus,
  numericToWordStatus,
  wordStatusToNumeric,
  getEaseFromWordStatus,
  getAnkiEaseForStatus,
} from './wordHoverHelpers';
import { WORD_STATUS } from '../../../shared/constants';
import type { KnowledgeSource } from '../../../shared/constants';

function makeCard(state: Flashcard['state']): Flashcard {
  return { state } as Flashcard;
}

describe('resolveWordKnowledge', () => {
  describe('order mode', () => {
    it('picks first source with data', () => {
      const result = resolveWordKnowledge(
        makeCard('review'), 'learning', true,
        ['anki', 'srs', 'manual'], 'order',
      );
      expect(result.status).toBe('learning'); // anki → learning
      expect(result.activeSources).toEqual(['anki']);
      expect(result.dataSources).toEqual(['anki', 'srs', 'manual']);
    });

    it('skips sources without data', () => {
      const result = resolveWordKnowledge(
        null, 'known', false,
        ['srs', 'anki', 'manual'], 'order',
      );
      // srs: no card → null, anki: false → null, manual: known → 'known'
      expect(result.status).toBe('known');
      expect(result.activeSources).toEqual(['manual']);
    });
  });

  describe('highest mode', () => {
    it('picks highest status across all sources', () => {
      const result = resolveWordKnowledge(
        makeCard('review'), 'learning', true,
        ['srs', 'anki', 'manual'], 'highest',
      );
      // srs=known(2), anki=learning(1), manual=learning(1) → known wins
      expect(result.status).toBe('known');
      expect(result.activeSources).toEqual(['srs']);
    });

    it('returns multiple active sources when tied', () => {
      const result = resolveWordKnowledge(
        makeCard('new'), 'learning', true,
        ['srs', 'anki', 'manual'], 'highest',
      );
      // srs=learning(1), anki=learning(1), manual=learning(1) → all tied
      expect(result.status).toBe('learning');
      expect(result.activeSources).toEqual(['srs', 'anki', 'manual']);
    });
  });

  describe('lowest mode', () => {
    it('picks lowest status across all sources', () => {
      const result = resolveWordKnowledge(
        makeCard('review'), 'learning', true,
        ['srs', 'anki', 'manual'], 'lowest',
      );
      // srs=known(2), anki=learning(1), manual=learning(1) → learning wins
      expect(result.status).toBe('learning');
      expect(result.activeSources).toEqual(['anki', 'manual']);
    });
  });

  describe('no data', () => {
    it('falls back to manualStatus when no source has data', () => {
      const result = resolveWordKnowledge(null, 'unknown', false, ['srs', 'anki', 'manual'], 'highest');
      expect(result.status).toBe('unknown');
      expect(result.activeSources).toEqual([]);
      expect(result.dataSources).toEqual([]);
    });
  });

  describe('source data detection', () => {
    it('srs returns null when no card', () => {
      const result = resolveWordKnowledge(null, 'unknown', false, ['srs'], 'highest');
      expect(result.dataSources).toEqual([]);
    });

    it('anki returns learning when word is in Anki', () => {
      const result = resolveWordKnowledge(null, 'unknown', true, ['anki'], 'highest');
      expect(result.status).toBe('learning');
      expect(result.dataSources).toEqual(['anki']);
    });

    it('manual returns null when status is unknown', () => {
      const result = resolveWordKnowledge(null, 'unknown', false, ['manual'], 'highest');
      expect(result.dataSources).toEqual([]);
    });

    it('manual returns status when not unknown', () => {
      const result = resolveWordKnowledge(null, 'known', false, ['manual'], 'highest');
      expect(result.status).toBe('known');
      expect(result.dataSources).toEqual(['manual']);
    });
  });
});

describe('getEffectiveWordStatus', () => {
  it('returns "learning" for new/learning/relearning flashcard states', () => {
    expect(getEffectiveWordStatus(makeCard('new'), 'unknown')).toBe('learning');
    expect(getEffectiveWordStatus(makeCard('learning'), 'unknown')).toBe('learning');
    expect(getEffectiveWordStatus(makeCard('relearning'), 'unknown')).toBe('learning');
  });

  it('returns highest status when card and manual differ (default highest mode)', () => {
    // relearning card → learning(1), manual → known(2) → highest picks known
    expect(getEffectiveWordStatus(makeCard('relearning'), 'known')).toBe('known');
  });

  it('returns "known" for review flashcard state', () => {
    expect(getEffectiveWordStatus(makeCard('review'), 'unknown')).toBe('known');
  });

  it('falls back to manualStatus when no card', () => {
    expect(getEffectiveWordStatus(null, 'unknown')).toBe('unknown');
    expect(getEffectiveWordStatus(null, 'learning')).toBe('learning');
    expect(getEffectiveWordStatus(null, 'known')).toBe('known');
  });

  it('respects Anki and settings params', () => {
    // Anki-only word, order mode with anki first
    expect(getEffectiveWordStatus(null, 'unknown', true, ['anki', 'srs', 'manual'], 'order')).toBe('learning');
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

describe('getEaseFromWordStatus', () => {
  it('returns default eases when no custom values are provided', () => {
    expect(getEaseFromWordStatus('learning')).toBeCloseTo(1.55);
    expect(getEaseFromWordStatus('known')).toBeCloseTo(1.8);
    expect(getEaseFromWordStatus('unknown')).toBeCloseTo(1.3);
  });

  it('uses custom ease values when provided', () => {
    expect(getEaseFromWordStatus('learning', 2.0, 2.5)).toBeCloseTo(2.0);
    expect(getEaseFromWordStatus('known', 2.0, 2.5)).toBeCloseTo(2.5);
  });

  it('returns minimum ease for unknown status regardless of custom values', () => {
    expect(getEaseFromWordStatus('unknown', 2.0, 2.5)).toBeCloseTo(1.3);
  });
});

describe('getAnkiEaseForStatus', () => {
  it('returns ankiLearningEase for learning status', () => {
    expect(getAnkiEaseForStatus('learning', 1550, 1800)).toBe(1550);
    expect(getAnkiEaseForStatus('learning', 2000, 2500)).toBe(2000);
  });

  it('returns ankiKnownEase for known status', () => {
    expect(getAnkiEaseForStatus('known', 1550, 1800)).toBe(1800);
    expect(getAnkiEaseForStatus('known', 2000, 2500)).toBe(2500);
  });

  it('returns Anki minimum ease (1300) for unknown status', () => {
    expect(getAnkiEaseForStatus('unknown', 1550, 1800)).toBe(1300);
  });
});
