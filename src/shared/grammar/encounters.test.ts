import { describe, expect, it, vi } from 'vitest';
import { detectGrammarOccurrences } from './occurrences';
import { createGrammarEncounterRecorder, journalGrammarEncounters, journalGrammarEncountersForTokenGroups } from './encounters';
import type { GrammarEncounterTracker } from './encounters';
import type { LanguageData, Token } from '../types';

const languageData: LanguageData = {
  name: 'Japanese',
  textProcessing: { tokenJoinSeparator: '' },
  runtime: { nlp: { tokenizer: { type: 'spacy', capabilities: ['segments', 'lemmas', 'partOfSpeech', 'morphology'] } } },
};

const grammar = [
  { pattern: 'ば', meaning: 'if (conditional)', level: 4 },
  { pattern: 'ない', meaning: 'negative', level: 3 },
];
const tokens: Token[] = [
  { word: 'ば', actual_word: 'ば', type: 'PART', partOfSpeech: '助詞' },
  { word: 'ない', actual_word: 'ない', type: 'auxiliary', partOfSpeech: '助動詞' },
];

const detect = () => detectGrammarOccurrences({ language: 'ja', grammar, tokens, languageData });

const makeTracker = () => ({
  trackGrammarEncountered: vi.fn<GrammarEncounterTracker['trackGrammarEncountered']>(),
});

describe('createGrammarEncounterRecorder', () => {
  it('carries span, confidence, and detector provenance from the occurrence into the encounter', () => {
    const recorder = createGrammarEncounterRecorder('subtitle');
    const [encounter] = recorder.record('line-1', detect());

    expect(encounter).toEqual({
      pattern: 'ば',
      confidence: 0.65,
      span: { start: 0, end: 1 },
      origin: 'subtitle:literal',
    });
  });

  it('dedupes repeated detections of the same pattern within one surface display', () => {
    const tracker = makeTracker();
    const recorder = createGrammarEncounterRecorder('subtitle');
    const detected = detect();

    journalGrammarEncounters(tracker, recorder, 'line-1', detected);
    journalGrammarEncounters(tracker, recorder, 'line-1', detected);
    journalGrammarEncounters(tracker, recorder, 'line-1', detect());

    expect(tracker.trackGrammarEncountered).toHaveBeenCalledTimes(2); // ば + ない, once each
    expect(tracker.trackGrammarEncountered).toHaveBeenCalledWith('ば', {
      confidence: 0.65,
      span: { start: 0, end: 1 },
      origin: 'subtitle:literal',
    });
    expect(tracker.trackGrammarEncountered).toHaveBeenCalledWith('ない', {
      confidence: 0.65,
      span: { start: 1, end: 2 },
      origin: 'subtitle:literal',
    });
  });

  it('journals again when the same pattern is displayed in a later surface (exclusive mode)', () => {
    const tracker = makeTracker();
    const recorder = createGrammarEncounterRecorder('subtitle');
    const detected = detect();

    journalGrammarEncounters(tracker, recorder, 'line-1', detected);
    journalGrammarEncounters(tracker, recorder, 'line-2', detected); // different line clears state
    journalGrammarEncounters(tracker, recorder, 'line-1', detected); // re-shown line is a new display

    expect(tracker.trackGrammarEncountered).toHaveBeenCalledTimes(4); // 2 patterns × 2 displays
  });

  it('keeps per-surface state when surfaces are concurrent and reset starts a fresh pass', () => {
    const tracker = makeTracker();
    const recorder = createGrammarEncounterRecorder('reader-ocr', { exclusive: false });
    const detected = detect();

    journalGrammarEncounters(tracker, recorder, 'page-1', detected);
    journalGrammarEncounters(tracker, recorder, 'page-2', detected);
    journalGrammarEncounters(tracker, recorder, 'page-1', detected); // interleaved refire stays deduped
    expect(tracker.trackGrammarEncountered).toHaveBeenCalledTimes(4);

    recorder.reset('page-1'); // fresh OCR pass for page-1
    journalGrammarEncounters(tracker, recorder, 'page-1', detected);
    expect(tracker.trackGrammarEncountered).toHaveBeenCalledTimes(6);
  });
});

describe('grammar encounter journaling', () => {
  it('records reader-path token groups (paragraphs / OCR boxes) through the encounter API', () => {
    const tracker = makeTracker();
    const recorder = createGrammarEncounterRecorder('reader');
    const paragraphTokens: Token[][] = [
      [{ word: 'ば', actual_word: 'ば', type: 'PART', partOfSpeech: '助詞' }],
      [{ word: 'ない', actual_word: 'ない', type: 'auxiliary', partOfSpeech: '助動詞' }],
    ];

    const encounters = journalGrammarEncountersForTokenGroups(tracker, recorder, 'page-1', paragraphTokens, {
      language: 'ja',
      grammar,
      languageData,
    });

    expect(encounters.map((item) => item.pattern)).toEqual(['ば', 'ない']);
    expect(tracker.trackGrammarEncountered).toHaveBeenCalledTimes(2);
    expect(tracker.trackGrammarEncountered).toHaveBeenCalledWith('ない', {
      confidence: 0.65,
      span: { start: 0, end: 1 },
      origin: 'reader:literal',
    });

    // Same page re-tokenized: no new encounters.
    journalGrammarEncountersForTokenGroups(tracker, recorder, 'page-1', paragraphTokens, {
      language: 'ja',
      grammar,
      languageData,
    });
    expect(tracker.trackGrammarEncountered).toHaveBeenCalledTimes(2);
  });

  it('never creates mastery evidence — encounters are factual rollups only', () => {
    const trackGrammarEncountered = vi.fn<GrammarEncounterTracker['trackGrammarEncountered']>();
    const trackGrammarFailed = vi.fn();
    const setWordClaim = vi.fn();
    const restoreWordSyncRating = vi.fn();
    const tracker = { trackGrammarEncountered, trackGrammarFailed, setWordClaim, restoreWordSyncRating };
    const recorder = createGrammarEncounterRecorder('subtitle');

    const encounters = journalGrammarEncounters(tracker, recorder, 'line-1', detect());

    expect(encounters).toHaveLength(2);
    expect(trackGrammarEncountered).toHaveBeenCalledTimes(2);
    expect(trackGrammarFailed).not.toHaveBeenCalled();
    expect(setWordClaim).not.toHaveBeenCalled();
    expect(restoreWordSyncRating).not.toHaveBeenCalled();

    for (const call of trackGrammarEncountered.mock.calls) {
      expect(Object.keys(call[1] ?? {}).sort()).toEqual(['confidence', 'origin', 'span']);
      expect(call[1]).not.toHaveProperty('ease');
      expect(call[1]).not.toHaveProperty('rating');
    }
  });
});
