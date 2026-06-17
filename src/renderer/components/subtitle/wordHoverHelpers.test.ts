import { describe, it, expect, vi } from 'vitest';
import {
  getAnkiWordKnowledgeStatus,
  numericToWordStatus,
  wordStatusToNumeric,
  getEaseFromWordStatus,
  getAnkiEaseForStatus,
  resolvePitchAccentForHover,
} from './wordHoverHelpers';
import { WORD_STATUS } from '../../../shared/constants';

describe('getAnkiWordKnowledgeStatus', () => {
  it('returns null when there are no matching Anki cards', () => {
    expect(getAnkiWordKnowledgeStatus([], 1550, 1800)).toBeNull();
    expect(getAnkiWordKnowledgeStatus(null, 1550, 1800)).toBeNull();
  });

  it('returns unknown for new cards below the learning threshold', () => {
    expect(getAnkiWordKnowledgeStatus([{ factor: 1300, queue: 0, type: 0 }], 1550, 1800)).toBe('unknown');
  });

  it('returns learning for learning queue cards', () => {
    expect(getAnkiWordKnowledgeStatus([{ factor: 1500, queue: 1, type: 1 }], 1550, 1800)).toBe('learning');
  });

  it('returns known for review cards', () => {
    expect(getAnkiWordKnowledgeStatus([{ factor: 1700, queue: 2, type: 2 }], 1550, 1800)).toBe('known');
  });

  it('uses the highest status across multiple Anki cards for the same word', () => {
    expect(getAnkiWordKnowledgeStatus([
      { factor: 1300, queue: 0, type: 0 },
      { factor: 2300, queue: 2, type: 2 },
    ], 1550, 1800)).toBe('known');
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

describe('resolvePitchAccentForHover', () => {
  const baseOptions = {
    supportsPitchAccent: true,
    showPitchAccent: true,
    getCanonicalForm: (word: string) => word,
    getCachedTranslation: () => null,
  };

  const translationWithPitch = (position: number, reading = 'やっかい') => ({
    data: [
      { reading, definitions: ['trouble'] },
      { reading: '', definitions: [] },
      { pitches: [{ position }] },
    ],
  });

  it('returns null when pitch accent is disabled', () => {
    expect(resolvePitchAccentForHover({
      ...baseOptions,
      word: '厄介',
      showPitchAccent: false,
      translationData: translationWithPitch(0),
    })).toBeNull();
  });

  it('returns pitch from the current translation data', () => {
    const result = resolvePitchAccentForHover({
      ...baseOptions,
      word: '厄介',
      translationData: translationWithPitch(0, 'やっかい'),
    });
    expect(result).toEqual({ position: 0, reading: 'やっかい' });
  });

  it('prefers the token reading over the cached reading', () => {
    const result = resolvePitchAccentForHover({
      ...baseOptions,
      word: '厄介',
      reading: 'やっかい',
      translationData: translationWithPitch(0, 'cached-reading'),
    });
    expect(result).toEqual({ position: 0, reading: 'やっかい' });
  });

  it('falls back to the canonical form when the hovered word has no pitch data', () => {
    const result = resolvePitchAccentForHover({
      ...baseOptions,
      word: 'やっかい',
      reading: 'やっかい',
      getCanonicalForm: (word) => word === 'やっかい' ? '厄介' : word,
      getCachedTranslation: (word) =>
        word === '厄介' ? translationWithPitch(0, 'やっかい') : null,
    });
    expect(result).toEqual({ position: 0, reading: 'やっかい' });
  });

  it('does not fallback when the current word already has pitch data', () => {
    const getCachedTranslation = vi.fn(() => translationWithPitch(1, 'different'));
    const result = resolvePitchAccentForHover({
      ...baseOptions,
      word: 'やっかい',
      getCanonicalForm: (word) => word === 'やっかい' ? '厄介' : word,
      getCachedTranslation,
      translationData: translationWithPitch(0, 'やっかい'),
    });
    expect(result).toEqual({ position: 0, reading: 'やっかい' });
    expect(getCachedTranslation).not.toHaveBeenCalled();
  });

  it('returns null when no pitch data exists for the word or its canonical form', () => {
    const result = resolvePitchAccentForHover({
      ...baseOptions,
      word: 'やっかい',
      getCanonicalForm: (word) => word === 'やっかい' ? '厄介' : word,
      getCachedTranslation: () => ({
        data: [
          { reading: 'やっかい', definitions: ['trouble'] },
          { reading: '', definitions: [] },
          null,
        ],
      }),
    });
    expect(result).toBeNull();
  });
});
