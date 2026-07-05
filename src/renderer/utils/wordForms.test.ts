import { describe, expect, it } from 'vitest';
import { getTokenLookupWord, getTokenWordFormCandidates, getWordFormCandidates } from './wordForms';

describe('getWordFormCandidates', () => {
  it('prefers language-provided variants when available', () => {
    expect(
      getWordFormCandidates(
        'おしいれ',
        (word) => word === 'おしいれ' ? '押し入れ' : word,
        () => ['押し入れ', '押入れ', 'おしいれ'],
      ),
    ).toEqual(['押し入れ', '押入れ', 'おしいれ']);
  });

  it('falls back to canonical plus original word without variants', () => {
    expect(
      getWordFormCandidates('おしいれ', (word) => word === 'おしいれ' ? '押し入れ' : word),
    ).toEqual(['押し入れ', 'おしいれ']);
  });

  it('adds language metadata dictionary normalizer candidates', () => {
    expect(
      getWordFormCandidates(
        'Straße',
        (word) => word,
        undefined,
        {
          languageData: {
            name: 'German',
            targetLanguage: 'de',
            runtime: {
              nlp: {
                dictionary: {
                  lookup: {
                    normalizers: ['casefold'],
                  },
                },
              },
            },
          },
        },
      ),
    ).toEqual(['Straße', 'strasse']);
  });

  it('keeps reading-script lookups before canonical surface forms', () => {
    expect(
      getWordFormCandidates(
        'ひらく',
        (word) => word === 'ひらく' ? '開く' : word,
        undefined,
        {
          languageData: {
            name: 'Japanese',
            textProcessing: {
              scriptProfile: { acceptedScripts: ['Han', 'Hira', 'Kana'] },
              lexemeNormalization: {
                type: 'surface-reading',
                surfaceScripts: ['Han'],
                readingScripts: ['Hira', 'Kana'],
                readingNormalizer: 'kana-to-hiragana',
              },
            },
          },
        },
      ),
    ).toEqual(['ひらく', '開く']);
  });

  it('still uses canonical-first lookup for surface-script words', () => {
    expect(
      getWordFormCandidates(
        '開く',
        (word) => word,
        () => ['開く', 'あく', 'ひらく'],
        {
          languageData: {
            name: 'Japanese',
            textProcessing: {
              scriptProfile: { acceptedScripts: ['Han', 'Hira', 'Kana'] },
              lexemeNormalization: {
                type: 'surface-reading',
                surfaceScripts: ['Han'],
                readingScripts: ['Hira', 'Kana'],
                readingNormalizer: 'kana-to-hiragana',
              },
            },
          },
        },
      ),
    ).toEqual(['開く', 'あく', 'ひらく']);
  });
});

describe('getTokenWordFormCandidates', () => {
  it('uses tokenizer lemmas for lookup when tokenizer metadata says they are reliable', () => {
    expect(
      getTokenLookupWord(
        { word: 'идёт', surface: 'идёт', actual_word: 'идти' },
        { providesLemmas: true },
      ),
    ).toBe('идти');
  });

  it('prefers visible surface forms over fake rough-tokenizer lemmas', () => {
    expect(
      getTokenLookupWord(
        { word: 'STOP', surface: 'STOP', actual_word: 'stop' },
        { providesLemmas: false },
      ),
    ).toBe('STOP');
  });

  it('combines lemma, surface, raw word, variants, and canonical forms', () => {
    const variants = (word: string) => {
      if (word === 'иду') return ['идти', 'пойти'];
      if (word === 'идёт') return ['идти'];
      return [];
    };

    expect(
      getTokenWordFormCandidates(
        { word: 'идёт', surface: 'идёт', actual_word: 'иду' },
        (word) => word === 'идёт' ? 'идти' : word,
        variants,
      ),
    ).toEqual(['идти', 'пойти', 'иду', 'идёт']);
  });

  it('does not treat rough-tokenizer actual_word as a lemma candidate', () => {
    expect(
      getTokenWordFormCandidates(
        { word: 'STOP', surface: 'STOP', actual_word: 'stop' },
        (word) => word.toLocaleLowerCase(),
        undefined,
        { tokenizerCapabilities: { providesLemmas: false } },
      ),
    ).toEqual(['stop', 'STOP']);
  });

  it('can include reading or transliteration when a caller explicitly asks for it', () => {
    expect(
      getTokenWordFormCandidates(
        { word: '你好', surface: '你好', actual_word: '你好', reading: 'ni hao' },
        (word) => word,
        undefined,
        { includeReading: true },
      ),
    ).toEqual(['你好', 'ni hao']);
  });

  it('does not include reading or transliteration by default', () => {
    expect(
      getTokenWordFormCandidates(
        { word: '你好', surface: '你好', actual_word: '你好', reading: 'ni hao' },
        (word) => word,
      ),
    ).toEqual(['你好']);
  });

  it('uses language metadata normalizers for token lookup candidates', () => {
    expect(
      getTokenWordFormCandidates(
        { word: 'كِتــاب', surface: 'كِتــاب', actual_word: 'كِتــاب' },
        (word) => word,
        undefined,
        {
          languageData: {
            name: 'Persian',
            targetLanguage: 'fa',
            textProcessing: {
              scriptProfile: { acceptedScripts: ['Arab'] },
              lexemeNormalization: {
                type: 'surface',
                surfaceScripts: ['Arab'],
                surfaceNormalizers: ['persian-arabic'],
              },
            },
          },
        },
      ),
    ).toEqual(['كِتــاب', 'كِتاب', 'كتاب', 'کتاب']);
  });
});
