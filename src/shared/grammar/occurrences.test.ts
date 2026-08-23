import { describe, expect, it } from 'vitest';
import { detectGrammarOccurrences } from './occurrences';
import type { LanguageData } from '../types';

const tokens = [
  { word: 'went', actual_word: 'go', type: 'VERB', partOfSpeech: 'VERB', features: { Tense: 'Past' } },
  { word: 'home', actual_word: 'home', type: 'NOUN', partOfSpeech: 'NOUN' },
];

const languageData: LanguageData = { name: 'Example', runtime: { nlp: { tokenizer: { type: 'spacy', capabilities: ['segments', 'lemmas', 'partOfSpeech', 'morphology'] } } } };

describe('detectGrammarOccurrences', () => {
  it('returns morphology-backed occurrences without creating learner evidence', () => {
    const grammar = [{ pattern: 'past-go', meaning: 'went', level: 1, match: { type: 'token-sequence' as const, tokens: [{ field: 'lemma' as const, equals: 'go', canonicalPartOfSpeech: 'VERB', features: { Tense: 'Past' } }] } }];
    const result = detectGrammarOccurrences({ language: 'example', grammar, tokens, languageData });
    expect(result).toMatchObject([{ patternId: 'past-go', sentenceSpan: { start: 0, end: 1 }, confidence: 0.95, provenance: 'morphological' }]);
    expect(result[0].targetRef.capability).toBe('grammar-recognition');
  });

  it('uses a lower-confidence literal fallback and rejects incomplete token matches', () => {
    const grammar = [{ pattern: 'went home', meaning: 'return', level: 1 }, { pattern: 'incomplete', meaning: 'partial', level: 1, match: { type: 'token-sequence' as const, tokens: [{ equals: 'went' }, { equals: 'home' }, { equals: 'now' }] } }];
    const result = detectGrammarOccurrences({ language: 'example', grammar, tokens, languageData });
    expect(result.map((item) => item.patternId)).toEqual(['went home']);
    expect(result[0].confidence).toBe(0.65);
  });
});
