import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageData } from '../../shared/types';
import { warmTranslationCache } from '../hooks/useTranslation';
import {
  filterSuggestedWords,
  planSubtitleCapture,
  recordCaptureAttempt,
  shouldCaptureSuggestedFlashcard,
  shouldKeepSuggestion,
  isWordInDictionary,
  type SubtitleCaptureState,
} from './suggestedFlashcards';

const translationCache = vi.hoisted(() => new Map<string, { data?: unknown }>());
const warmTranslationCacheMock = vi.hoisted(() => vi.fn());
const hashWordSyncMock = vi.hoisted(() => vi.fn((word: string) => `hash:${word}`));

vi.mock('../hooks/useTranslation', () => ({
  getCachedTranslation: (word: string, language?: string) => translationCache.get(`${language || 'default'}::${word}`) ?? null,
  warmTranslationCache: warmTranslationCacheMock,
}));

vi.mock('../services/srsAlgorithm', () => ({
  hashWordSync: hashWordSyncMock,
}));

const settings = (overrides: Partial<{
  autoSuggestFlashcards: boolean;
  autoSuggestUnknownWords: boolean;
  learningLanguageLevel: number | null;
  learningLanguageLevels: Record<string, number | null>;
}> = {}) => ({
  autoSuggestFlashcards: true,
  autoSuggestUnknownWords: true,
  learningLanguageLevel: null,
  learningLanguageLevels: {},
  ...overrides,
});

function cacheTranslation(word: string, language: string, data: unknown): void {
  translationCache.set(`${language}::${word}`, { data });
}

function knownKey(word: string, language: string): string {
  return `${language}:hash:${word}`;
}

beforeEach(() => {
  translationCache.clear();
  warmTranslationCacheMock.mockReset();
  hashWordSyncMock.mockClear();
});

describe('shouldKeepSuggestion', () => {
  const ascendingDifficultyLanguage: LanguageData = {
    name: 'Ascending Difficulty Language',
    colour_codes: {},
    settings: { fixed: {} },
    frequencyLevels: {
      difficulty: 'higher-is-harder',
    },
  };
  const arabicScriptLanguage: LanguageData = {
    name: 'Arabic Script Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: {
        acceptedScripts: ['Arab'],
        wordScriptValidation: 'only-accepted',
      },
    },
  };
  const nestedDefinitionsLanguage = {
    name: 'Nested Definitions Language',
    colour_codes: {},
    settings: { fixed: {} },
    runtime: {
      nlp: {
        dictionary: {
          definitionsPath: ['glosses', 'english'],
        },
      },
    },
  } as unknown as LanguageData;

  it('returns false when auto-suggest is disabled', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestFlashcards: false }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns true when unknown words are allowed and no other filters apply', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('returns true for dictionary words when unknown words are disabled', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);

    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('returns true for dictionary words with package-declared definition paths', () => {
    cacheTranslation('你好', 'zh', [{ glosses: { english: ['hello'] } }]);

    const result = shouldKeepSuggestion(
      { word: '你好', language: 'zh' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
      null,
      null,
      nestedDefinitionsLanguage,
    );

    expect(result).toBe(true);
  });

  it('returns true for dictionary words resolved through word-form candidates', () => {
    cacheTranslation('كتب', 'ar', [{ definitions: ['to write'] }]);

    const result = shouldKeepSuggestion(
      { word: 'يكتب', language: 'ar' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
      null,
      null,
      null,
      { getWordForms: (word) => word === 'يكتب' ? ['كتب'] : [word] },
    );

    expect(result).toBe(true);
  });

  it('returns false for non-dictionary words when unknown words are disabled', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestUnknownWords: false }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns false when the suggestion level is below the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('returns false when the suggestion has no level but the user level is set', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('keeps off-list and beyond-exam suggestions when the target is the hardest displayable level', () => {
    const leveledLanguage: LanguageData = {
      name: 'Leveled Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '1': 'N1', '5': 'N5' },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    };

    expect(shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ learningLanguageLevels: { ja: 1 } }),
      new Set<string>(),
      undefined,
      undefined,
      leveledLanguage,
    )).toBe(true);
    expect(shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: -1 },
      settings({ learningLanguageLevels: { ja: 1 } }),
      new Set<string>(),
      undefined,
      undefined,
      leveledLanguage,
    )).toBe(true);
  });

  it('rejects off-list suggestions when the target is not the hardest displayable level', () => {
    const leveledLanguage: LanguageData = {
      name: 'Leveled Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '1': 'N1', '5': 'N5' },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    };

    expect(shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ learningLanguageLevels: { ja: 5 } }),
      new Set<string>(),
      undefined,
      undefined,
      leveledLanguage,
    )).toBe(false);
  });

  it('keeps a harder-than-target word that recurs in the current media (R21)', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2, mediaRecurrence: 2 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('keeps a recurring off-list word outside the frontier level with the stored coverage count', () => {
    const leveledLanguage: LanguageData = {
      name: 'Leveled Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '1': 'N1', '5': 'N5' },
      },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
        readingAnnotation: { type: 'none' },
      },
    };

    expect(shouldKeepSuggestion(
      { word: 'word', language: 'ja', mediaRecurrence: 5 },
      settings({ learningLanguageLevels: { ja: 5 } }),
      new Set<string>(),
      undefined,
      undefined,
      leveledLanguage,
    )).toBe(true);
  });

  it('still rejects a one-off off-list word (below the recurrence threshold)', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', mediaRecurrence: 1 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('never lets recurrence bypass the known-word check', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2, mediaRecurrence: 9 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set([knownKey('word', 'ja')]),
    );

    expect(result).toBe(false);
  });

  it('returns true when the suggestion level equals the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 3 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('returns true when the suggestion level exceeds the user level', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 5 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('uses language metadata for ascending difficulty level filters', () => {
    expect(shouldKeepSuggestion(
      { word: 'word', language: 'xx', level: 2 },
      settings({ learningLanguageLevels: { xx: 3 } }),
      new Set<string>(),
      undefined,
      undefined,
      ascendingDifficultyLanguage,
    )).toBe(true);
    expect(shouldKeepSuggestion(
      { word: 'word', language: 'xx', level: 4 },
      settings({ learningLanguageLevels: { xx: 3 } }),
      new Set<string>(),
      undefined,
      undefined,
      ascendingDifficultyLanguage,
    )).toBe(false);
  });

  it('skips the level check when userLevel is explicitly null', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: null },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
      null,
    );

    expect(result).toBe(true);
  });

  it('uses settings.learningLanguageLevels for the suggestion language when userLevel is undefined', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevels: { ja: 3 } }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('uses the per-language learning level instead of the legacy scalar setting', () => {
    expect(shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevel: 3, learningLanguageLevels: { ja: null } }),
      new Set<string>(),
    )).toBe(true);

    expect(shouldKeepSuggestion(
      { word: 'word', language: 'de', level: 4 },
      settings({ learningLanguageLevel: null, learningLanguageLevels: { de: 3 } }),
      new Set<string>(),
      undefined,
      undefined,
      ascendingDifficultyLanguage,
    )).toBe(false);
  });

  it('does not apply a legacy scalar level to another concrete language', () => {
    expect(shouldKeepSuggestion(
      { word: 'مرحبا', language: 'ar', level: 1 },
      settings({ learningLanguageLevel: 5 }),
      new Set<string>(),
      undefined,
      undefined,
      arabicScriptLanguage,
    )).toBe(true);
  });

  it('returns false when the word is in the known word set', () => {
    const known = new Set<string>([knownKey('word', 'ja')]);

    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      known,
    );

    expect(result).toBe(false);
  });

  it('returns false when any word-form candidate is in the known word set', () => {
    const known = new Set<string>([knownKey('идти', 'ru')]);

    const result = shouldKeepSuggestion(
      { word: 'идут', language: 'ru' },
      settings(),
      known,
      undefined,
      undefined,
      null,
      { getWordForms: (word) => word === 'идут' ? ['идти'] : [word] },
    );

    expect(result).toBe(false);
  });

  it('returns false when comprehensive status is known', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      'known',
    );

    expect(result).toBe(false);
  });

  it('returns true when comprehensive status is learning', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      'learning',
    );

    expect(result).toBe(true);
  });

  it('returns true when comprehensive status is unknown', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      'unknown',
    );

    expect(result).toBe(true);
  });

  it('returns true when comprehensive status is null', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
      undefined,
      null,
    );

    expect(result).toBe(true);
  });

  it('returns true when comprehensive status is undefined', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings(),
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('falls back to DEFAULT_SETTINGS when settings are undefined', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 5 },
      {} as unknown as ReturnType<typeof settings>,
      new Set<string>(),
    );

    expect(result).toBe(true);
  });

  it('prefers explicit userLevel over settings.learningLanguageLevel', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 2 },
      settings({ learningLanguageLevel: 3 }),
      new Set<string>(),
      1,
    );

    expect(result).toBe(true);
  });

  it('rejects unknown words when dictionary check fails even if level is ok', () => {
    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja', level: 5 },
      settings({ autoSuggestUnknownWords: false, learningLanguageLevel: 3 }),
      new Set<string>(),
    );

    expect(result).toBe(false);
  });

  it('rejects known words regardless of dictionary status', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);
    const known = new Set<string>([knownKey('word', 'ja')]);

    const result = shouldKeepSuggestion(
      { word: 'word', language: 'ja' },
      settings({ autoSuggestUnknownWords: false }),
      known,
    );

    expect(result).toBe(false);
  });

  it('rejects suggestions outside the language script when metadata is available', () => {
    expect(shouldKeepSuggestion(
      { word: 'hello', language: 'ar' },
      settings(),
      new Set<string>(),
      null,
      null,
      arabicScriptLanguage,
    )).toBe(false);

    expect(shouldKeepSuggestion(
      { word: 'سلام', language: 'ar' },
      settings(),
      new Set<string>(),
      null,
      null,
      arabicScriptLanguage,
    )).toBe(true);
  });
});

describe('filterSuggestedWords', () => {
  it('returns empty set when auto-suggest is disabled', async () => {
    const result = await filterSuggestedWords(['word'], 'ja', settings({ autoSuggestFlashcards: false }));

    expect(result).toEqual(new Set());
    expect(warmTranslationCache).not.toHaveBeenCalled();
  });

  it('returns all words when unknown words are allowed', async () => {
    const result = await filterSuggestedWords(['word', 'missing'], 'ja', settings({ autoSuggestUnknownWords: true }));

    expect(result).toEqual(new Set(['word', 'missing']));
    expect(warmTranslationCache).not.toHaveBeenCalled();
  });

  it('warms cache and returns only dictionary words when unknown words are disabled', async () => {
    warmTranslationCacheMock.mockImplementation(async (words: string[], _unusedA: unknown, _unusedB: unknown, language: string) => {
      for (const word of words) {
        if (word === 'known') {
          cacheTranslation(word, language, [{ definitions: ['definition'] }]);
        }
      }
    });

    const result = await filterSuggestedWords(['known', 'missing'], 'ja', settings({ autoSuggestUnknownWords: false }));

    expect(warmTranslationCache).toHaveBeenCalledWith(['known', 'missing'], undefined, undefined, 'ja');
    expect(result).toEqual(new Set(['known']));
  });

  it('warms candidate forms and keeps words whose canonical form has a dictionary entry', async () => {
    warmTranslationCacheMock.mockImplementation(async (words: string[], _unusedA: unknown, _unusedB: unknown, language: string) => {
      for (const word of words) {
        if (word === 'كتب') {
          cacheTranslation(word, language, [{ definitions: ['to write'] }]);
        }
      }
    });

    const result = await filterSuggestedWords(
      ['يكتب'],
      'ar',
      settings({ autoSuggestUnknownWords: false }),
      null,
      { getWordForms: (word) => word === 'يكتب' ? ['كتب'] : [word] },
    );

    expect(warmTranslationCache).toHaveBeenCalledWith(['يكتب', 'كتب'], undefined, undefined, 'ar');
    expect(result).toEqual(new Set(['يكتب']));
  });

  it('deduplicates input words', async () => {
    const result = await filterSuggestedWords([' word ', 'word', 'other', ''], 'ja', settings());

    expect(result).toEqual(new Set(['word', 'other']));
  });

  it('does not filter by learningLanguageLevel', async () => {
    const result = await filterSuggestedWords(['word'], 'ja', settings({ learningLanguageLevel: 5 }));

    expect(result).toEqual(new Set(['word']));
  });

  it('filters batch suggestions by language script when metadata is supplied', async () => {
    const arabicScriptLanguage: LanguageData = {
      name: 'Arabic Script Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Arab'],
          wordScriptValidation: 'only-accepted',
        },
      },
    };

    const result = await filterSuggestedWords(['سلام', 'hello'], 'ar', settings(), arabicScriptLanguage);

    expect(result).toEqual(new Set(['سلام']));
  });
});

describe('shouldCaptureSuggestedFlashcard', () => {
  it('returns false when auto-suggest is disabled', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ autoSuggestFlashcards: false }))).toBe(false);
  });

  it('captures any word when unknown words are allowed', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings())).toBe(true);
  });

  it('captures cached dictionary words when unknown words are disabled', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);

    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ autoSuggestUnknownWords: false }))).toBe(true);
  });

  it('rejects words without cached definitions when unknown words are disabled', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ autoSuggestUnknownWords: false }))).toBe(false);
  });

  it('rejects uncached words when unknown words are disabled', () => {
    expect(shouldCaptureSuggestedFlashcard('uncached', 'ja', settings({ autoSuggestUnknownWords: false }))).toBe(false);
  });

  it('ignores learningLanguageLevel', () => {
    expect(shouldCaptureSuggestedFlashcard('word', 'ja', settings({ learningLanguageLevel: 5 }))).toBe(true);
  });
});

describe('isWordInDictionary', () => {
  it('treats cached words with definitions as dictionary words', () => {
    cacheTranslation('word', 'ja', [{ definitions: ['definition'] }]);

    expect(isWordInDictionary('word', 'ja')).toBe(true);
  });

  it('treats words with dictionary definitions on a candidate form as dictionary words', () => {
    cacheTranslation('идти', 'ru', [{ definitions: ['to go'] }]);

    expect(isWordInDictionary('идут', 'ru', {
      getWordForms: (word) => word === 'идут' ? ['идти'] : [word],
    })).toBe(true);
  });

  it('treats uncached words as non-dictionary', () => {
    expect(isWordInDictionary('word', 'ja')).toBe(false);
  });

  it('treats cached words without definitions as non-dictionary', () => {
    cacheTranslation('word', 'ja', [{ reading: 'word' }]);

    expect(isWordInDictionary('word', 'ja')).toBe(false);
  });

  it('treats cached empty translations as non-dictionary', () => {
    cacheTranslation('word', 'ja', []);

    expect(isWordInDictionary('word', 'ja')).toBe(false);
  });

  it('treats uncached words as non-dictionary', () => {
    expect(isWordInDictionary('uncached-word', 'ja')).toBe(false);
  });
});

describe('planSubtitleCapture / recordCaptureAttempt (R21 producer lifecycle)', () => {
  const recurrence = (values: Record<string, number>) => new Map(Object.entries(values));
  const captureState = (): SubtitleCaptureState => ({
    seenWords: new Set<string>(),
    inFlight: new Set<string>(),
    attemptedRecurrence: new Map<string, number>(),
  });

  it('keeps a first sighting retryable until an attempt completes', () => {
    const state = captureState();
    const first = planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 1 }));
    expect(first.fresh.map((item) => item.word)).toEqual(['粉飾']);
    expect(first.retry).toEqual([]);

    // No completed attempt means capture may have been disabled or failed;
    // the same recurrence must remain retryable after availability changes.
    const second = planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 1 }));
    expect(second.fresh).toEqual([]);
    expect(second.retry.map((item) => item.word)).toEqual(['粉飾']);
    expect(state.seenWords.size).toBe(1);
  });

  it('deduplicates one planning batch and suppresses overlapping in-flight attempts', () => {
    const state = captureState();
    const first = planSubtitleCapture([{ word: '粉飾' }, { word: '粉飾' }], state, recurrence({ 粉飾: 1 }));
    expect(first.fresh.map((item) => item.word)).toEqual(['粉飾']);
    expect(first.retry).toEqual([]);

    state.inFlight.add('粉飾');
    const overlap = planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 2 }));
    expect(overlap).toEqual({ fresh: [], retry: [] });

    state.inFlight.delete('粉飾');
    expect(planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 2 })).retry)
      .toEqual([{ word: '粉飾' }]);
  });

  it('retries a rejected word when its recorded recurrence grows past the consumed count', () => {
    // The review-4 reproduction: the word appears once in each of two
    // successive subtitles. Run 1 is filtered out below MEDIA_MIN_ENCOUNTERS;
    // run 2 must re-attempt capture without remounting the route.
    const state = captureState();
    const run1 = planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 1 }));
    expect(run1.fresh).toHaveLength(1);
    state.inFlight.add('粉飾');
    recordCaptureAttempt(state, '粉飾', false, 1);
    expect(state.inFlight.has('粉飾')).toBe(false);

    const run2 = planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 2 }));
    expect(run2.fresh).toEqual([]);
    expect(run2.retry.map((item) => item.word)).toEqual(['粉飾']);

    // This time persistence succeeds: the capture records a terminal marker.
    state.inFlight.add('粉飾');
    recordCaptureAttempt(state, '粉飾', true, 2);
    expect(state.inFlight.has('粉飾')).toBe(false);
    expect(state.attemptedRecurrence.get('粉飾')).toBe(Number.POSITIVE_INFINITY);
    const run3 = planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 3 }));
    expect(run3.fresh).toEqual([]);
    expect(run3.retry).toEqual([]);
  });

  it('does not retry a rejected one-off whose recurrence has not grown', () => {
    const state = captureState();
    planSubtitleCapture([{ word: '難単語' }], state, recurrence({ 難単語: 1 }));
    recordCaptureAttempt(state, '難単語', false, 1);

    const again = planSubtitleCapture([{ word: '難単語' }], state, recurrence({ 難単語: 1 }));
    expect(again.retry).toEqual([]);
  });

  it('re-records the consumed recurrence when a retry is rejected again', () => {
    const state = captureState();
    planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 2 }));
    recordCaptureAttempt(state, '粉飾', false, 2);

    expect(planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 2 })).retry.map((item) => item.word)).toEqual([]);
    expect(planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 3 })).retry.map((item) => item.word)).toEqual(['粉飾']);
    recordCaptureAttempt(state, '粉飾', false, 3);
    // The one-off at 3 must not re-filter on every later subtitle.
    expect(planSubtitleCapture([{ word: '粉飾' }], state, recurrence({ 粉飾: 3 })).retry.map((item) => item.word)).toEqual([]);
  });

  it('keeps fresh and retry decisions independent per word', () => {
    const state = captureState();
    planSubtitleCapture([{ word: '既知' }], state, recurrence({ 既知: 1 }));
    recordCaptureAttempt(state, '既知', false, 1);

    const planned = planSubtitleCapture([{ word: '既知' }, { word: '新しい' }], state, recurrence({ 既知: 2, 新しい: 1 }));
    expect(planned.fresh.map((item) => item.word)).toEqual(['新しい']);
    expect(planned.retry.map((item) => item.word)).toEqual(['既知']);
    expect(state.seenWords).toEqual(new Set(['既知', '新しい']));
  });
});
