import { describe, expect, it } from 'vitest';
import { detectGrammarOccurrences } from './occurrences';
import type { Token } from '../types';

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

  it('resolves a ja て-form and a conditional to distinct persistent construction identities', () => {
    // 食べていれば = 食べ + て + いれ(ば): ている (ongoing, いる in 仮定形) + ば (conditional).
    const jaTokens: Token[] = [
      { word: '食べ', actual_word: '食べる', type: 'VERB', partOfSpeech: '動詞', features: { VerbForm: 'Te' } },
      { word: 'て', actual_word: 'て', type: 'PART', partOfSpeech: '助詞' },
      { word: 'いれ', actual_word: 'いる', type: 'VERB', partOfSpeech: '動詞', features: { Form: '仮定形' } },
      { word: 'ば', actual_word: 'ば', type: 'PART', partOfSpeech: '助詞' },
    ];
    const jaLanguageData: LanguageData = {
      name: 'Japanese',
      textProcessing: { tokenJoinSeparator: '' },
      runtime: { nlp: { tokenizer: { type: 'spacy', capabilities: ['segments', 'lemmas', 'partOfSpeech', 'morphology'] } } },
    };
    const grammar = [
      { pattern: 'ている', meaning: 'ongoing action / state', level: 5, match: { type: 'token-sequence' as const, tokens: [{ equals: 'て' }, { field: 'lemma' as const, equals: 'いる', features: { Form: '仮定形' } }] } },
      { pattern: 'ば', meaning: 'if (conditional)', level: 4 },
    ];

    const result = detectGrammarOccurrences({ language: 'ja', grammar, tokens: jaTokens, languageData: jaLanguageData });

    expect(result.map((item) => item.patternId)).toEqual(['ている', 'ば']);

    const ongoing = result[0];
    expect(ongoing.patternId).toBe('ている');
    expect(ongoing.targetRef).toEqual({ kind: 'grammar-pattern', id: 'ja:grammar:ている', capability: 'grammar-recognition' });
    expect(ongoing.sentenceSpan).toEqual({ start: 1, end: 3 });
    expect(ongoing.realizedForm).toBe('ていれ');
    expect(ongoing.confidence).toBe(0.95);
    expect(ongoing.provenance).toBe('morphological');
    expect(ongoing.tokenEvidence).toEqual([
      { tokenIndex: 1, matcher: 'morphological', fields: ['word', 'lemma', 'features'] },
      { tokenIndex: 2, matcher: 'morphological', fields: ['word', 'lemma', 'features'] },
    ]);

    const conditional = result[1];
    expect(conditional.patternId).toBe('ば');
    expect(conditional.targetRef).toEqual({ kind: 'grammar-pattern', id: 'ja:grammar:ば', capability: 'grammar-recognition' });
    expect(conditional.sentenceSpan).toEqual({ start: 3, end: 4 });
    expect(conditional.realizedForm).toBe('ば');
    expect(conditional.confidence).toBe(0.65);
    expect(conditional.provenance).toBe('literal');
  });

  it('keeps ja construction identities pattern-scoped (same span, different patterns)', () => {
    const jaTokens: Token[] = [
      { word: '食べ', actual_word: '食べる', type: 'VERB', partOfSpeech: '動詞' },
      { word: 'て', actual_word: 'て', type: 'PART', partOfSpeech: '助詞' },
      { word: 'しまう', actual_word: 'しまう', type: 'VERB', partOfSpeech: '動詞' },
    ];
    const jaLanguageData: LanguageData = {
      name: 'Japanese',
      textProcessing: { tokenJoinSeparator: '' },
      runtime: { nlp: { tokenizer: { type: 'spacy', capabilities: ['segments', 'lemmas', 'partOfSpeech', 'morphology'] } } },
    };
    const grammar = [
      { pattern: 'てしまう', meaning: 'completion / regret', level: 3, match: { type: 'token-sequence' as const, tokens: [{ equals: 'て' }, { field: 'lemma' as const, equals: 'しまう' }] } },
      { pattern: 'て', meaning: 'te-form connector', level: 3, match: { type: 'token-sequence' as const, tokens: [{ equals: 'て' }] } },
    ];

    const result = detectGrammarOccurrences({ language: 'ja', grammar, tokens: jaTokens, languageData: jaLanguageData });

    expect(result.map((item) => item.patternId)).toEqual(['てしまう', 'て']);
    expect(result[0].sentenceSpan).toEqual({ start: 1, end: 3 });
    expect(result[1].sentenceSpan).toEqual({ start: 1, end: 2 });
    expect(new Set(result.map((item) => item.targetRef.id))).toEqual(new Set(['ja:grammar:てしまう', 'ja:grammar:て']));
  });
});
