import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearMappingTables, registerMappingTable } from '../languageFeatures';
import { buildLanguageFrequencyState, createWordFormDeriver } from './wordForms';
import type { LanguageData } from '../types';

// These tests exercise the REAL shared pipeline (createWordFormDeriver over
// real getLexemeVariants/getCanonicalLexeme), NOT the canonical-first mock
// variants used in FlashcardContext tests. They pin the production ordering:
// the metadata-aware canonical form is the primary (persisted) form.
describe('shared primary word-form derivation (real pipeline ordering)', () => {
  beforeEach(() => {
    clearMappingTables();
  });
  afterEach(() => {
    clearMappingTables();
  });

  it('resolves a surface-normalized canonical as the primary form', () => {
    const persian: LanguageData = {
      name: 'Persian probe',
      textProcessing: {
        lexemeNormalization: {
          type: 'surface',
          surfaceScripts: ['Arab'],
          surfaceNormalizers: [
            'unicode-nfc',
            'remove-tatweel',
            'remove-arabic-diacritics',
            { type: 'replace-characters', map: { 'ك': 'ک', 'ي': 'ی', 'ى': 'ی' } },
          ],
        },
      },
      freq: [['کتاب', '', 1]],
    };
    const deriver = createWordFormDeriver(persian, 'fa');
    // Raw decorated surface resolves to the package-normalized headword.
    expect(deriver('كِتــاب')).toBe('کتاب');
    // Headwords are their own primary form.
    expect(deriver('کتاب')).toBe('کتاب');
  });

  it('promotes the reading-resolved canonical for reading-script input', () => {
    const japanese: LanguageData = {
      name: 'Reading probe',
      textProcessing: {
        lexemeNormalization: {
          type: 'surface-reading',
          surfaceScripts: ['Han'],
          readingScripts: ['Hira'],
          readingNormalizer: 'kana-to-hiragana',
        },
      },
      freq: [['赤い', 'あかい', 5], ['明い', 'あかい', 7]],
    };
    const deriver = createWordFormDeriver(japanese, 'ja');
    // Kana input keys under the frequency-resolved kanji headword, not the kana.
    expect(deriver('あかい')).toBe('赤い');
    expect(deriver('赤い')).toBe('赤い');
  });

  it('pins root-locale casing for package-declared casefold steps', () => {
    const casing: LanguageData = {
      name: 'Casing probe',
      textProcessing: {
        lexemeNormalization: {
          type: 'surface',
          surfaceScripts: ['Latn'],
          surfaceNormalizers: ['casefold'],
        },
      },
      freq: [['Izmir', '', 3]],
    };
    const deriver = createWordFormDeriver(casing, 'tst');
    // Frequency headwords keep their identity — even case variants resolve to
    // the declared headword through the normalized-surface index.
    expect(deriver('Izmir')).toBe('Izmir');
    expect(deriver('IZMIR')).toBe('Izmir');
    // Surfaces absent from the package normalize deterministically to the
    // root-locale casing.
    expect(deriver('Bonn')).toBe('bonn');
  });

  it('applies package mapping tables so one word identity spans scripts', () => {
    registerMappingTable('zh', { words: {}, chars: { '學': '学' } });
    const zh: LanguageData = {
      name: 'Mapping probe',
      textProcessing: {
        lexemeNormalization: {
          type: 'surface',
          surfaceScripts: ['Han'],
          mappingTableAsset: 'languages/zh.t2s.json',
          surfaceNormalizers: [{ type: 'mapping-table' }],
        },
      },
    };
    const deriver = createWordFormDeriver(zh, 'zh');
    expect(deriver('學')).toBe('学');
  });

  it('falls back to identity for languages without normalization config', () => {
    const bare: LanguageData = { name: 'Bare' };
    const deriver = createWordFormDeriver(bare, 'xx');
    expect(deriver('Merkwürdig')).toBe('Merkwürdig');
    expect(createWordFormDeriver(undefined, 'xx')('Haus')).toBe('Haus');
  });

  it('produces identical state through buildLanguageFrequencyState for the deriver path', () => {
    const persian: LanguageData = {
      name: 'Persian state probe',
      textProcessing: {
        lexemeNormalization: {
          type: 'surface',
          surfaceScripts: ['Arab'],
          surfaceNormalizers: ['remove-arabic-diacritics'],
        },
      },
      freq: [['کتاب', '', 1]],
    };
    const state = buildLanguageFrequencyState(persian, 'fa');
    expect(state.languageData?.activeFrequencyProvider).toBeUndefined();
    expect(Object.keys(state.frequency)).toEqual(['کتاب']);
  });
});
