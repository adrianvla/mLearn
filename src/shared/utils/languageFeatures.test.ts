import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type LanguageData, type WordFrequencyMap } from '../types';
import { getWordIndexText, languageUsesSegmentlessText } from '../languageScriptProfile';
import {
  adjustReadingAnnotationForSurfaceSuffix,
  buildLexemeIndex,
  createProsodyForPosition,
  createProsodyRawPayloadForPosition,
  createRoughTokenizerTokens,
  extractStudyCharacters,
  extractUniqueStudyCharacters,
  getCanonicalLexeme,
  getDictionaryLookupCandidates,
  getContentFontFamily,
  getCharacterStudyScripts,
  getFrequencyLevelsAtOrEasierThanTarget,
  getFrequencyLevelVisualRank,
  getGrammarLevelVisualRank,
  getLanguagePythonImportChecksForInstall,
  getLanguagePythonRequirementsForInstall,
  getLanguageFeatureFlags,
  getLanguageFixedSettings,
  getLanguageTextDirection,
  getLanguagePromptName,
  getLanguageProsodyType,
  getFrequencyForLexeme,
  getFrequencyLevelLabel,
  getLexemeVariants,
  getLearningLanguageLevelForLanguage,
  getGrammarLevelLabel,
  getProsodyPositionLabel,
  getProsodyPositionPlaceholder,
  getProsodyPositionFromContent,
  getProsodyPositionFromOverride,
  getReaderCollatePagesForLanguage,
  getReaderFirstPageSingleForLanguage,
  getReaderPageModeForLanguage,
  getReaderSpreadDirectionForLanguage,
  getProsodyToggleDescription,
  getProsodyToggleLabel,
  getSubtitleFontFamily,
  getOcrRuntimeConfig,
  getPartOfSpeechColor,
  getReadingJoinSeparator,
  getCanonicalPartOfSpeech,
  getTranslatablePartOfSpeechTypes,
  getTokenJoinSeparator,
  getTokenizerCapabilities,
  getTokenizerRuntimeConfig,
  grammarPointMatchesTokens,
  isTranslatablePartOfSpeech,
  isTranslatableToken,
  isSettingFixedByLanguage,
  languageSupportsCharacterNamePrefixes,
  languageSupportsDeferentialRegister,
  languageSupportsProsody,
  ocrRuntimeSupportsVerticalText,
  prosodyPartOfSpeechCanTakeParticleBox,
  readingUsesDistinctScriptFromWord,
  resolveCloudOcrEngine,
  resolveLanguageFrequencyPayload,
  isReadingScriptText,
  isFrequencyLevelHarderThanTarget,
  selectHarderFrequencyLevel,
  shouldIncludeProsodyParticleBoxForContext,
  shouldTokenizeTextForLanguage,
  sortFrequencyLevelsByDifficulty,
  sortFrequencyLevelsForDisplay,
  sortGrammarLevelsByDifficulty,
  sortGrammarLevelsForDisplay,
  tokenizerAllowsFallback,
  tokensToReadingText,
  tokensToPlainText,
  ocrRuntimeSupportsRamSaver,
  wordNeedsReadingAnnotation,
} from '../languageFeatures';

describe('language feature bricks', () => {
  const surfaceReadingLanguage: LanguageData = {
    name: 'Surface Reading Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
      lexemeNormalization: {
        type: 'surface-reading',
        surfaceScripts: ['Han'],
        readingScripts: ['Hira', 'Kana'],
        readingNormalizer: 'kana-to-hiragana',
        preserveNonPrimaryReadingScript: true,
      },
      wordIndexStrategy: {
        type: 'character-containment',
      },
      readingAnnotation: {
        type: 'script-reading',
        annotationScripts: ['Han'],
        surfaceSuffixScripts: ['Hira', 'Kana'],
      },
    },
  };

  const latinLanguage: LanguageData = {
    name: 'Latin Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Latn'] },
      lexemeNormalization: {
        type: 'identity',
      },
      wordIndexStrategy: {
        type: 'whole-expression',
      },
    },
  };

  const hanPinyinLanguage: LanguageData = {
    name: 'Han Pinyin Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: {
        acceptedScripts: ['Han'],
        allowsRomanization: true,
      },
      lexemeNormalization: {
        type: 'reading',
        surfaceScripts: ['Han'],
        readingScripts: ['Latn'],
        readingNormalizer: 'lowercase-strip-diacritics',
      },
      readingAnnotation: {
        type: 'script-reading',
        annotationScripts: ['Han'],
      },
    },
  };

  it('uses explicit character-study scripts and does not infer them from legacy reading metadata', () => {
    expect(getCharacterStudyScripts({
      name: 'Legacy Reading Language',
      colour_codes: {},
      settings: { fixed: {} },
    })).toEqual([]);

    expect(getCharacterStudyScripts({
      name: 'Han Character Study Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
      characterStudy: {
        enabled: true,
        scripts: ['Han'],
      },
    })).toEqual(['Han']);
  });

  it('extracts study characters from configured scripts without hardcoding Han', () => {
    expect(extractStudyCharacters('سَلَام', ['Arab'])).toEqual(['س', 'ل', 'ا', 'م']);
    expect(extractUniqueStudyCharacters('سلام سلام', ['Arab'])).toEqual(['س', 'ل', 'ا', 'م']);
    expect(extractStudyCharacters('خانه', ['Arab'])).toEqual(['خ', 'ا', 'ن', 'ه']);
    expect(extractStudyCharacters('дом', ['Cyrl'])).toEqual(['д', 'о', 'м']);
    expect(extractStudyCharacters('漢あ字', ['Han'])).toEqual(['漢', '字']);
  });

  it('resolves subtitle font family from metadata before script defaults', () => {
    expect(getSubtitleFontFamily({
      name: 'Custom Font Language',
      colour_codes: {},
      settings: { fixed: {} },
      typography: {
        subtitleFontFamily: '"Readable Custom"',
      },
    })).toBe('"Readable Custom"');
  });

  it('resolves subtitle font family from language scripts', () => {
    expect(getSubtitleFontFamily(latinLanguage)).toBe('var(--font-family-subtitle)');
    expect(getSubtitleFontFamily({
      name: 'Arabic',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
    })).toBe('var(--font-family-arabic)');
    expect(getSubtitleFontFamily({
      name: 'Cyrillic',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
      },
    })).toBe('var(--font-family-cyrillic)');
    expect(getSubtitleFontFamily(surfaceReadingLanguage)).toBe('var(--font-family-compact-script)');
  });

  it('resolves content font family from metadata before script defaults', () => {
    const language = {
      name: 'Custom Content Font Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
      typography: {
        contentFontFamily: '"Readable Content"',
        contentFontOptions: [{ id: 'ponomar', name: 'Ponomar', fontFamily: 'Ponomar' }],
      },
    };
    expect(getContentFontFamily(language)).toBe('"Readable Content"');
    expect(getContentFontFamily(language, 'ponomar')).toBe('Ponomar');
    expect(getContentFontFamily(language, '__proto__')).toBe('"Readable Content"');
  });

  it('resolves content font family from language scripts', () => {
    expect(getContentFontFamily(latinLanguage)).toBe('var(--font-family-content)');
    expect(getContentFontFamily({
      name: 'Arabic',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
    })).toBe('var(--font-family-arabic)');
    expect(getContentFontFamily(surfaceReadingLanguage)).toBe('var(--font-family-compact-script)');
  });

  it('distinguishes logographic scripts from phonetic dense scripts', () => {
    expect(getLanguageFeatureFlags('zh', {
      name: 'Han Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
    }).isLogographic).toBe(true);

    for (const script of ['Hang', 'Hira', 'Kana', 'Bopo']) {
      expect(getLanguageFeatureFlags(script.toLowerCase(), {
        name: `${script} Language`,
        colour_codes: {},
        settings: { fixed: {} },
        textProcessing: {
          scriptProfile: { acceptedScripts: [script] },
        },
      }).isLogographic).toBe(false);
    }
  });

  it('normalizes package-declared script aliases before deriving feature flags', () => {
    expect(getLanguageFeatureFlags('x-syriac', {
      name: 'Lowercase Syriac',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['syrc'] },
      },
    })).toMatchObject({
      isRTL: true,
      textDirection: 'rtl',
      usesLatinScript: false,
    });

    expect(getLanguageFeatureFlags('x-latin', {
      name: 'Lowercase Latin',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['latn'] },
      },
    })).toMatchObject({
      isRTL: false,
      textDirection: 'ltr',
      usesLatinScript: true,
    });
  });

  it('uses package-declared script ranges for scripts not built into the app', () => {
    const osageWord = String.fromCodePoint(0x104B0, 0x104D8);
    const osageLanguage: LanguageData = {
      name: 'Osage',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Osge'],
          scriptRanges: {
            Osge: [[0x104B0, 0x104FF]],
          },
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
    };

    expect(shouldTokenizeTextForLanguage(osageWord, 'osg', osageLanguage)).toBe(true);
    expect(createRoughTokenizerTokens(osageWord, osageLanguage)).toEqual([
      {
        word: osageWord,
        actual_word: osageWord,
        type: 'WORD',
        surface: osageWord,
      },
    ]);
  });

  it('resolves text direction from typography metadata before script defaults', () => {
    expect(getLanguageTextDirection({
      name: 'Arabic',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
    })).toBe('rtl');

    expect(getLanguageTextDirection({
      name: 'Arabic transliteration package',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
      },
      typography: {
        textDirection: 'ltr',
      },
    })).toBe('ltr');

    expect(getLanguageTextDirection({
      name: 'Mixed script package',
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab', 'Latn'] },
      },
      typography: {
        textDirection: 'auto',
      },
    })).toBe('auto');
  });

  it('uses explicit subtitle/register metadata instead of inferring feature support from unrelated metadata', () => {
    const unconfiguredLanguage: LanguageData = {
      ...latinLanguage,
    };
    const configuredLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        scriptProfile: { acceptedScripts: ['latn'] },
        ...latinLanguage.textProcessing,
        subtitle: {
          characterNamePrefix: {
            enabled: true,
            bracketPairs: [['（', '）']],
          },
        },
      },
      conversation: {
        register: {
          hasDeferentialForms: true,
        },
      },
    };

    expect(languageSupportsCharacterNamePrefixes(null)).toBe(false);
    expect(languageSupportsCharacterNamePrefixes(unconfiguredLanguage)).toBe(false);
    expect(languageSupportsDeferentialRegister(unconfiguredLanguage)).toBe(false);
    expect(languageSupportsCharacterNamePrefixes(configuredLanguage)).toBe(true);
    expect(languageSupportsDeferentialRegister(configuredLanguage)).toBe(true);
  });

  const freq: [string, string][] = [
    ['赤い', 'あかい'],
    ['明い', 'あかい'],
  ];
  const wordFrequency: WordFrequencyMap = {
    '赤い': {
      reading: 'あかい',
      level: 'Level 5',
      raw_level: 5,
    },
    '明い': {
      reading: 'あかい',
      level: 'Level 4',
      raw_level: 4,
    },
  };

  const hanPinyinFreq: [string, string][] = [
    ['你好', 'nǐ hǎo'],
    ['妳好', 'nǐ hǎo'],
  ];
  const hanPinyinWordFrequency: WordFrequencyMap = {
    '你好': {
      reading: 'nǐ hǎo',
      level: 'Level 5',
      raw_level: 5,
    },
    '妳好': {
      reading: 'nǐ hǎo',
      level: 'Level 4',
      raw_level: 4,
    },
  };

  const persianArabicLanguage: LanguageData = {
    name: 'Persian Arabic Variant Language',
    colour_codes: {},
    settings: { fixed: {} },
    textProcessing: {
      scriptProfile: { acceptedScripts: ['Arab'] },
      lexemeNormalization: {
        type: 'surface',
        surfaceScripts: ['Arab'],
        surfaceNormalizers: ['persian-arabic'],
      },
    },
  };

  const persianFreq: [string, string][] = [
    ['کتاب', 'ketab'],
    ['کمی', 'kami'],
  ];

  const persianWordFrequency: WordFrequencyMap = {
    'کتاب': {
      reading: 'ketab',
      level: 'Level 1',
      raw_level: 1,
    },
    'کمی': {
      reading: 'kami',
      level: 'Level 2',
      raw_level: 2,
    },
  };

  it('normalizes reading-script words only when the language opts into that model', () => {
    const index = buildLexemeIndex(freq, surfaceReadingLanguage);
    expect(getCanonicalLexeme('あかい', wordFrequency, index, surfaceReadingLanguage)).toBe('赤い');
    expect(getFrequencyForLexeme('あかい', wordFrequency, index, surfaceReadingLanguage)?.raw_level).toBe(5);
    expect(getLexemeVariants('あかい', wordFrequency, index, surfaceReadingLanguage)).toEqual(['あかい', '赤い', '明い']);
  });

  it('keeps identity-normalized languages from using reading fallback', () => {
    const index = buildLexemeIndex(freq, latinLanguage);
    expect(getCanonicalLexeme('あかい', wordFrequency, index, latinLanguage)).toBe('あかい');
    expect(getFrequencyForLexeme('あかい', wordFrequency, index, latinLanguage)).toBeNull();
  });

  it('supports non-Japanese reading-based lexeme lookup', () => {
    const index = buildLexemeIndex(hanPinyinFreq, hanPinyinLanguage);
    expect(getCanonicalLexeme('Ni Hao', hanPinyinWordFrequency, index, hanPinyinLanguage)).toBe('你好');
    expect(getFrequencyForLexeme('nǐ hǎo', hanPinyinWordFrequency, index, hanPinyinLanguage)?.raw_level).toBe(5);
    expect(getLexemeVariants('ni hao', hanPinyinWordFrequency, index, hanPinyinLanguage)).toEqual(['ni hao', '你好', '妳好']);
  });

  it('uses Arabic-script reading normalizers for reading-based lexeme lookup', () => {
    const arabicReadingLanguage: LanguageData = {
      name: 'Arabic Reading Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Arab'],
          readingScripts: ['Arab'],
          readingNormalizer: ['remove-arabic-diacritics', 'remove-tatweel', 'persian-arabic'],
        },
      },
    };
    const arabicFreq: [string, string][] = [['کتاب', 'كِتــاب']];
    const arabicWordFrequency: WordFrequencyMap = {
      'کتاب': { reading: 'كِتــاب', level: 'Level 1', raw_level: 1 },
    };

    const index = buildLexemeIndex(arabicFreq, arabicReadingLanguage);

    expect(getCanonicalLexeme('كِتــاب', arabicWordFrequency, index, arabicReadingLanguage)).toBe('کتاب');
    expect(getFrequencyForLexeme('كِتَاب', arabicWordFrequency, index, arabicReadingLanguage)?.raw_level).toBe(1);
  });

  it('supports metadata-driven surface normalization for Arabic-script variants', () => {
    const index = buildLexemeIndex(persianFreq, persianArabicLanguage);
    expect(getCanonicalLexeme('كِتــاب', persianWordFrequency, index, persianArabicLanguage)).toBe('کتاب');
    expect(getFrequencyForLexeme('كِتــاب', persianWordFrequency, index, persianArabicLanguage)?.raw_level).toBe(1);
    expect(getLexemeVariants('كِمی', persianWordFrequency, index, persianArabicLanguage)).toEqual(['كِمی', 'کمی']);
  });

  it('uses surface normalizers for canonical lookup even without frequency rows', () => {
    const index = buildLexemeIndex(undefined, persianArabicLanguage);
    expect(getCanonicalLexeme('كِتــاب', {}, index, persianArabicLanguage)).toBe('کتاب');
    expect(getLexemeVariants('كِمی', {}, index, persianArabicLanguage)).toEqual(['كِمی', 'کمی']);
  });

  it('builds dictionary lookup candidates from metadata normalizers', () => {
    expect(getDictionaryLookupCandidates('Straße', {
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
    })).toEqual(['Straße', 'strasse']);

    expect(getDictionaryLookupCandidates('كِتــاب', persianArabicLanguage)).toEqual([
      'كِتــاب',
      'كِتاب',
      'كتاب',
      'کتاب',
    ]);
  });

  it('expands package-defined dictionary normalizer presets', () => {
    const language: LanguageData = {
      name: 'Custom Preset Language',
      targetLanguage: 'xx',
      textProcessing: {
        normalizerPresets: {
          'latin-display-fold': [
            'casefold',
            'strip-diacritics',
            { type: 'replace-characters', map: { 'ø': 'o' } },
          ],
        },
      },
      runtime: {
        nlp: {
          dictionary: {
            lookup: {
              normalizers: [{ type: 'preset', name: 'latin-display-fold' }],
            },
          },
        },
      },
    };

    expect(getDictionaryLookupCandidates('CAFÉØ', language)).toEqual([
      'CAFÉØ',
      'caféø',
      'cafeø',
      'cafeo',
    ]);
  });

  it('does not use rough-tokenizer lemma normalizers as dictionary lookup normalizers', () => {
    expect(getDictionaryLookupCandidates('CAFÉ', {
      name: 'Tokenizer Normalizer Language',
      targetLanguage: 'xx',
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lemmaNormalizers: ['casefold', 'strip-diacritics'],
          },
        },
      },
    })).toEqual(['CAFÉ']);
  });

  it('branches dictionary lookup normalizers across orthographic variants', () => {
    const language: LanguageData = {
      name: 'Branching',
      targetLanguage: 'xx',
      runtime: {
        nlp: {
          dictionary: {
            lookup: {
              normalizerMode: 'branching',
              normalizers: [
                { type: 'replace-characters', map: { a: 'b' } },
                { type: 'replace-characters', map: { b: 'c' } },
              ],
            },
          },
        },
      },
    };

    expect(getDictionaryLookupCandidates('ab', language)).toEqual(['ab', 'bb', 'ac', 'cc']);
  });

  it('supports metadata-declared prefix and suffix rewrites for dictionary lookup candidates', () => {
    const language: LanguageData = {
      name: 'Affix lookup',
      targetLanguage: 'xx',
      runtime: {
        nlp: {
          dictionary: {
            lookup: {
              normalizerMode: 'branching',
              normalizers: [
                { type: 'replace-prefix', from: 'ال' },
                { type: 'replace-suffix', from: 'у', to: 'а' },
              ],
            },
          },
        },
      },
    };

    expect(getDictionaryLookupCandidates('الكتاب', language)).toEqual(['الكتاب', 'كتاب']);
    expect(getDictionaryLookupCandidates('книгу', language)).toEqual(['книгу', 'книга']);
  });

  it('ignores top-level POS translatability in favor of the partOfSpeech metadata brick', () => {
    expect(isTranslatablePartOfSpeech('名詞', {
      ...surfaceReadingLanguage,
      translatable: ['名詞', '動詞'],
    } as unknown as LanguageData)).toBe(true);
    expect(isTranslatablePartOfSpeech('助詞', {
      ...surfaceReadingLanguage,
      translatable: ['名詞', '動詞'],
    } as unknown as LanguageData)).toBe(true);
    expect(isTranslatablePartOfSpeech('noun', {
      ...latinLanguage,
    })).toBe(true);
  });

  it('defaults POS labels to translatable only when no allow-list is configured', () => {
    const noPosPolicy = latinLanguage;

    expect(getTranslatablePartOfSpeechTypes(noPosPolicy)).toEqual([]);
    expect(isTranslatablePartOfSpeech('noun', noPosPolicy)).toBe(true);
  });

  it('matches POS labels case-insensitively by default for tokenizer interoperability', () => {
    const uposLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          translatable: ['noun', 'verb'],
        },
      },
    };

    expect(isTranslatablePartOfSpeech('NOUN', uposLanguage)).toBe(true);
    expect(isTranslatablePartOfSpeech('ADP', uposLanguage)).toBe(false);
  });

  it('maps tokenizer-specific POS aliases to canonical POS categories', () => {
    const aliasedPosLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          translatable: ['content-word'],
          aliases: {
            NOUN: 'content-word',
            VERB: 'content-word',
            ADP: 'function-word',
          },
        },
      },
    };

    expect(getTranslatablePartOfSpeechTypes(aliasedPosLanguage)).toEqual(['content-word']);
    expect(getCanonicalPartOfSpeech('NOUN', aliasedPosLanguage)).toBe('content-word');
    expect(isTranslatablePartOfSpeech('VERB', aliasedPosLanguage)).toBe(true);
    expect(isTranslatablePartOfSpeech('ADP', aliasedPosLanguage)).toBe(false);
    expect(getPartOfSpeechColor('NOUN', { 'content-word': '#336699' }, aliasedPosLanguage)).toBe('#336699');
  });

  it('uses POS policy for tokens only when tokenizer POS is reliable', () => {
    const aliasedPosLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          translatable: ['content-word'],
          aliases: {
            NOUN: 'content-word',
            ADP: 'function-word',
          },
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            capabilities: ['segments', 'partOfSpeech'],
          },
        },
      },
    };

    expect(isTranslatableToken({ word: 'house', actual_word: 'house', type: 'NOUN' }, aliasedPosLanguage)).toBe(true);
    expect(isTranslatableToken({ word: 'to', actual_word: 'to', type: 'ADP' }, aliasedPosLanguage)).toBe(false);
  });

  it('does not let rough tokenizer WORD tags block dictionary lookup', () => {
    const roughLanguageWithPosPolicy: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          translatable: ['noun', 'verb'],
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
          },
        },
      },
    };

    expect(isTranslatablePartOfSpeech('WORD', roughLanguageWithPosPolicy)).toBe(false);
    expect(isTranslatableToken({ word: 'Houses', actual_word: 'houses', type: 'WORD' }, roughLanguageWithPosPolicy)).toBe(true);
  });

  it('rejects rough tokenizer metadata for segmentless scripts unless explicitly allowed', () => {
    const unsafeRoughLanguage: LanguageData = {
      ...hanPinyinLanguage,
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
    };

    expect(getTokenizerRuntimeConfig(unsafeRoughLanguage)).toEqual({
      type: 'none',
      required: true,
      fallback: 'none',
    });
    expect(getTokenizerCapabilities(unsafeRoughLanguage)).toEqual({
      segmentsText: false,
      segmentationQuality: 'none',
      providesLemmas: false,
      providesPartOfSpeech: false,
      providesReadings: false,
      providesMorphology: false,
      allowsRoughFallback: false,
    });
    expect(tokenizerAllowsFallback(unsafeRoughLanguage)).toBe(false);
    expect(createRoughTokenizerTokens('中文', unsafeRoughLanguage)).toEqual([]);
  });

  it('uses script profile metadata for rough tokenizer safety', () => {
    const scriptProfileOnlyHanLanguage: LanguageData = {
      name: 'Script Profile Han Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: {
          acceptedScripts: ['Han'],
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
    };

    expect(getTokenizerRuntimeConfig(scriptProfileOnlyHanLanguage)).toEqual({
      type: 'none',
      required: true,
      fallback: 'none',
    });
    expect(createRoughTokenizerTokens('中文学习', scriptProfileOnlyHanLanguage)).toEqual([]);
    expect(getTokenizerRuntimeConfig({
      ...scriptProfileOnlyHanLanguage,
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            allowRoughSegmentationForSegmentlessScripts: true,
          },
        },
      },
    }).type).toBe('unicode-word');
  });

  it('allows explicitly degraded rough segmentation for segmentless scripts', () => {
    const explicitlyDegradedLanguage: LanguageData = {
      ...hanPinyinLanguage,
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            allowRoughSegmentationForSegmentlessScripts: true,
          },
        },
      },
    };

    expect(getTokenizerRuntimeConfig(explicitlyDegradedLanguage).type).toBe('unicode-word');
    expect(tokenizerAllowsFallback(explicitlyDegradedLanguage)).toBe(true);
    expect(createRoughTokenizerTokens('中文', explicitlyDegradedLanguage)).toEqual([
      { actual_word: '中文', word: '中文', type: 'WORD', surface: '中文' },
    ]);
  });

  it('restricts rough tokenizer letters to the language script profile by default', () => {
    const germanRoughLanguage: LanguageData = {
      ...latinLanguage,
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
          },
        },
      },
    };

    expect(createRoughTokenizerTokens('Haus 中文 Привет', germanRoughLanguage)).toEqual([
      { actual_word: 'haus', word: 'Haus', type: 'WORD', surface: 'Haus' },
    ]);
  });

  it('lets rough tokenizer metadata include romanized input or explicit token scripts', () => {
    const romanizedChinese: LanguageData = {
      ...hanPinyinLanguage,
      textProcessing: {
        ...hanPinyinLanguage.textProcessing,
        scriptProfile: {
          acceptedScripts: ['Han'],
          allowsRomanization: true,
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            allowRoughSegmentationForSegmentlessScripts: true,
            acceptsRomanizedInput: true,
            extraTokenCharacters: [],
            innerTokenCharacters: ['-'],
          },
        },
      },
    };

    expect(createRoughTokenizerTokens('你好 ni-hao سلام', romanizedChinese)).toEqual([
      { actual_word: '你好', word: '你好', type: 'WORD', surface: '你好' },
      { actual_word: 'ni-hao', word: 'ni-hao', type: 'WORD', surface: 'ni-hao' },
    ]);

    expect(createRoughTokenizerTokens('слово word', {
      ...latinLanguage,
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            tokenCharacterScripts: ['Cyrl'],
          },
        },
      },
    })).toEqual([
      { actual_word: 'слово', word: 'слово', type: 'WORD', surface: 'слово' },
    ]);
  });

  it('allows rough unicode-word tokenization for Hangul text with word spaces', () => {
    const koreanRoughLanguage: LanguageData = {
      ...latinLanguage,
      name: 'Korean rough tokenizer language',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hang'] },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
    };

    expect(getTokenizerRuntimeConfig(koreanRoughLanguage).type).toBe('unicode-word');
    expect(tokenizerAllowsFallback(koreanRoughLanguage)).toBe(true);
    expect(createRoughTokenizerTokens('한국어 공부', koreanRoughLanguage)).toEqual([
      { actual_word: '한국어', word: '한국어', type: 'WORD', surface: '한국어' },
      { actual_word: '공부', word: '공부', type: 'WORD', surface: '공부' },
    ]);
  });

  it('allows rough unicode-word tokenization for composite Korean script metadata', () => {
    const koreanCompositeLanguage: LanguageData = {
      ...latinLanguage,
      name: 'Korean composite script tokenizer language',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Kore'] },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
    };

    expect(getTokenizerRuntimeConfig(koreanCompositeLanguage).type).toBe('unicode-word');
    expect(createRoughTokenizerTokens('韓國語 공부', koreanCompositeLanguage)).toEqual([
      { actual_word: '韓國語', word: '韓國語', type: 'WORD', surface: '韓國語' },
      { actual_word: '공부', word: '공부', type: 'WORD', surface: '공부' },
    ]);
  });

  it('resolves POS colors case-insensitively without aliases', () => {
    const uposLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          translatable: ['noun'],
        },
      },
    };

    expect(getPartOfSpeechColor('NOUN', { noun: '#123456' }, uposLanguage)).toBe('#123456');
    expect(getPartOfSpeechColor('NOUN', { VERB: '#654321' }, uposLanguage)).toBeUndefined();
  });

  it('resolves package POS colors from the part-of-speech metadata brick', () => {
    const coloredPosLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          aliases: {
            NOUN: 'content-word',
          },
          colors: {
            'content-word': '#336699',
          },
        },
      },
    };

    expect(getPartOfSpeechColor('NOUN', undefined, coloredPosLanguage)).toBe('#336699');
    expect(getPartOfSpeechColor('NOUN', { 'content-word': '#ff00aa' }, coloredPosLanguage)).toBe('#ff00aa');
    expect(getPartOfSpeechColor('VERB', undefined, coloredPosLanguage)).toBeUndefined();
  });

  it('resolves POS colors for tokenizer subtype labels without substring steals', () => {
    const subtypePosLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          colors: {
            'verb': '#verb',
            'auxiliary': '#auxiliary',
            'noun': '#noun',
          },
        },
      },
    };

    expect(getPartOfSpeechColor('noun:proper', undefined, subtypePosLanguage)).toBe('#noun');
    expect(getPartOfSpeechColor('auxiliary:copula', undefined, subtypePosLanguage)).toBe('#auxiliary');
    expect(getPartOfSpeechColor('punctuation:period', undefined, subtypePosLanguage)).toBeUndefined();
    expect(getPartOfSpeechColor('auxiliary:copula', { 'verb': '#override-verb' }, subtypePosLanguage)).toBe('#auxiliary');
  });

  it('resolves package-forced settings from the settings metadata brick', () => {
    const fixedSettingsLanguage: LanguageData = {
      ...latinLanguage,
      settings: {
        fixed: {
          showReadingAnnotations: false,
        },
      },
    };

    expect(getLanguageFixedSettings(fixedSettingsLanguage)).toEqual({
      showReadingAnnotations: false,
    });
    expect(isSettingFixedByLanguage(fixedSettingsLanguage, 'showReadingAnnotations')).toBe(true);
    expect(isSettingFixedByLanguage(fixedSettingsLanguage, 'theme')).toBe(false);
  });

  it('lets language metadata mark POS categories as ignored even without an allow-list', () => {
    const ignoredPosLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          ignored: ['punct', 'space'],
        },
      },
    };

    expect(isTranslatablePartOfSpeech('PUNCT', ignoredPosLanguage)).toBe(false);
    expect(isTranslatablePartOfSpeech('NOUN', ignoredPosLanguage)).toBe(true);
  });

  it('matches legacy grammar points through reconstructed text', () => {
    expect(grammarPointMatchesTokens(
      { pattern: 'てしまう', meaning: 'completion', level: 3 },
      [
        { word: '食べ', actual_word: '食べる', type: '動詞' },
        { word: 'てしまう', actual_word: 'てしまう', type: '助動詞' },
      ],
      surfaceReadingLanguage,
    )).toBe(true);
  });

  it('matches grammar points through token lemma sequences for inflected languages', () => {
    const russianLanguage: LanguageData = {
      ...latinLanguage,
      name: 'Russian',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
        ...latinLanguage.textProcessing,
        tokenJoinSeparator: ' ',
        partOfSpeech: {
          aliases: {
            VERB: 'verb',
            NOUN: 'noun',
          },
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            capabilities: ['segments', 'lemmas', 'partOfSpeech'],
          },
        },
      },
    };

    expect(grammarPointMatchesTokens(
      {
        pattern: 'motion verb + accusative',
        meaning: 'movement toward a destination',
        level: 2,
        match: {
          type: 'token-sequence',
          tokens: [
            { field: 'actual_word', equals: 'идти' },
            { canonicalPartOfSpeech: 'noun' },
          ],
        },
      },
      [
        { word: 'иду', actual_word: 'идти', type: 'VERB' },
        { word: 'школу', actual_word: 'школа', type: 'NOUN' },
      ],
      russianLanguage,
    )).toBe(true);
  });

  it('matches grammar points through token morphology features for case-heavy languages', () => {
    const russianLanguage: LanguageData = {
      ...latinLanguage,
      name: 'Russian',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
        ...latinLanguage.textProcessing,
        tokenJoinSeparator: ' ',
        partOfSpeech: {
          aliases: {
            VERB: 'verb',
            NOUN: 'noun',
          },
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            capabilities: ['segments', 'lemmas', 'partOfSpeech', 'morphology'],
          },
        },
      },
    };

    expect(grammarPointMatchesTokens(
      {
        pattern: 'motion verb + accusative',
        meaning: 'movement toward a destination',
        level: 2,
        match: {
          type: 'token-sequence',
          tokens: [
            { field: 'actual_word', equals: 'идти' },
            { canonicalPartOfSpeech: 'noun', features: { Case: 'Acc' } },
          ],
        },
      },
      [
        { word: 'иду', actual_word: 'идти', type: 'VERB', features: { Mood: 'Ind', Number: 'Sing' } },
        { word: 'школу', actual_word: 'школа', type: 'NOUN', features: { Case: 'Acc', Number: 'Sing' } },
      ],
      russianLanguage,
    )).toBe(true);
  });

  it('does not match morphology feature grammar when the tokenizer does not provide morphology', () => {
    const tokenizerWithoutMorphology: LanguageData = {
      ...latinLanguage,
      name: 'Russian',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
        ...latinLanguage.textProcessing,
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            capabilities: ['segments', 'lemmas', 'partOfSpeech'],
          },
        },
      },
    };

    expect(grammarPointMatchesTokens(
      {
        pattern: 'accusative object',
        meaning: 'direct object marked with accusative',
        level: 2,
        match: {
          type: 'token-sequence',
          tokens: [
            { canonicalPartOfSpeech: 'noun', features: { Case: 'Acc' } },
          ],
        },
      },
      [
        { word: 'школу', actual_word: 'школа', type: 'NOUN', features: { Case: 'Acc' } },
      ],
      tokenizerWithoutMorphology,
    )).toBe(false);
  });

  it('does not match morphology-sensitive grammar with a rough tokenizer', () => {
    const roughRussianLanguage: LanguageData = {
      ...latinLanguage,
      name: 'Russian',
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
        ...latinLanguage.textProcessing,
        tokenJoinSeparator: ' ',
        partOfSpeech: {
          aliases: {
            VERB: 'verb',
            NOUN: 'noun',
          },
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
          },
        },
      },
    };

    expect(grammarPointMatchesTokens(
      {
        pattern: 'motion verb + accusative',
        meaning: 'movement toward a destination',
        level: 2,
        match: {
          type: 'token-sequence',
          tokens: [
            { field: 'actual_word', equals: 'идти' },
            { canonicalPartOfSpeech: 'noun' },
          ],
        },
      },
      [
        { word: 'иду', actual_word: 'идти', type: 'VERB' },
        { word: 'школу', actual_word: 'школа', type: 'NOUN' },
      ],
      roughRussianLanguage,
    )).toBe(false);
  });

  it('detects reading-script text from language metadata', () => {
    expect(isReadingScriptText('あかい', surfaceReadingLanguage)).toBe(true);
    expect(isReadingScriptText('赤い', surfaceReadingLanguage)).toBe(false);
    expect(isReadingScriptText('nǐ hǎo 3', hanPinyinLanguage)).toBe(true);
    expect(isReadingScriptText('你好', hanPinyinLanguage)).toBe(false);
  });

  it('detects reading-script text with declared reading extra characters', () => {
    const arabicRomanizationLanguage: LanguageData = {
      name: 'Arabic Romanization Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Arab'],
          readingScripts: ['Latn'],
          readingExtraCharacters: ['ʿ', 'ʾ'],
        },
      },
    };

    expect(isReadingScriptText('al-ʿarabiyya', arabicRomanizationLanguage)).toBe(true);
    expect(isReadingScriptText('ʿʾ', arabicRomanizationLanguage)).toBe(false);
    expect(isReadingScriptText('al-ʿarabiyya', {
      ...arabicRomanizationLanguage,
      textProcessing: {
        lexemeNormalization: {
          type: 'reading',
          surfaceScripts: ['Arab'],
          readingScripts: ['Latn'],
        },
      },
    })).toBe(false);
  });

  it('chooses a compact reading join separator for kana-style readings', () => {
    expect(getReadingJoinSeparator(surfaceReadingLanguage)).toBe('');
  });

  it('chooses a spaced reading join separator for romanized readings', () => {
    expect(getReadingJoinSeparator(hanPinyinLanguage)).toBe(' ');
  });

  it('lets language metadata override the reading join separator', () => {
    expect(getReadingJoinSeparator({
      ...hanPinyinLanguage,
      textProcessing: {
        ...hanPinyinLanguage.textProcessing,
        readingAnnotation: {
          ...hanPinyinLanguage.textProcessing?.readingAnnotation,
          readingSeparator: ' / ',
        },
      },
    })).toBe(' / ');
  });

  it('joins token readings using language-specific reading separators', () => {
    expect(tokensToReadingText([
      { word: '日本', reading: 'にほん' },
      { word: '語', reading: 'ご' },
      { word: 'を', reading: 'を' },
    ], surfaceReadingLanguage)).toBe('にほんごを');

    expect(tokensToReadingText([
      { word: '你', reading: 'ni' },
      { word: '好', reading: 'hao' },
    ], hanPinyinLanguage)).toBe('ni hao');
  });

  it('uses compact token joins before language metadata is available', () => {
    expect(getTokenJoinSeparator()).toBe('');
    expect(tokensToPlainText([
      { word: '赤い' },
      { word: 'バラ' },
    ])).toBe('赤いバラ');
  });

  it('joins plain token text using language-specific token separators', () => {
    expect(getTokenJoinSeparator(surfaceReadingLanguage)).toBe('');
    expect(tokensToPlainText([
      { word: '日本' },
      { word: '語' },
      { word: 'を' },
    ], surfaceReadingLanguage)).toBe('日本語を');

    expect(getTokenJoinSeparator(latinLanguage)).toBe(' ');
    expect(tokensToPlainText([
      { word: 'hello' },
      { word: 'world' },
    ], latinLanguage)).toBe('hello world');

    expect(getTokenJoinSeparator(hanPinyinLanguage)).toBe('');
    expect(tokensToPlainText([
      { word: '你' },
      { word: '好' },
    ], hanPinyinLanguage)).toBe('你好');
  });

  it('does not treat Hangul-only Korean text as segmentless by default', () => {
    const koreanLanguage: LanguageData = {
      ...latinLanguage,
      name: 'Korean',
          };

    expect(getTokenJoinSeparator(koreanLanguage)).toBe(' ');
    expect(tokensToPlainText([
      { word: '한국어' },
      { word: '공부' },
    ], koreanLanguage)).toBe('한국어 공부');
    expect(getWordIndexText('한국어 공부', 'ko', koreanLanguage)).toBe('한국어 공부');
  });

  it('does not let auxiliary Hanja make locale-derived Korean segmentless', () => {
    expect(languageUsesSegmentlessText('ko')).toBe(false);
    expect(getWordIndexText('한국어 공부', 'ko')).toBe('한국어 공부');
  });

  it('lets language metadata override the plain token join separator', () => {
    const slashSeparatedLanguage: LanguageData = {
      ...latinLanguage,
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hang'] },
        ...latinLanguage.textProcessing,
        tokenJoinSeparator: ' / ',
      },
    };

    expect(getTokenJoinSeparator(slashSeparatedLanguage)).toBe(' / ');
    expect(tokensToPlainText([
      { word: 'one' },
      { word: 'two' },
    ], slashSeparatedLanguage)).toBe('one / two');
  });

  it('detects saved readings written in a distinct language script', () => {
    expect(readingUsesDistinctScriptFromWord('将来', 'しょうらい', surfaceReadingLanguage)).toBe(true);
    expect(readingUsesDistinctScriptFromWord('你好', 'nǐ hǎo', hanPinyinLanguage)).toBe(true);
    expect(readingUsesDistinctScriptFromWord('Haus', 'haʊs', latinLanguage)).toBe(false);
  });

  it('uses metadata-driven card indexing strategies', () => {
    expect(getWordIndexText('赤い rose', 'x-kana-kanji', surfaceReadingLanguage)).toBe('赤い');
    expect(getWordIndexText('Haus der Wörter', 'de', latinLanguage)).toBe('Haus der Wörter');
  });

  it('defaults segmentless card indexing to accepted scripts instead of all non-ASCII characters', () => {
    expect(getWordIndexText('你好 nǐ hǎo', 'zh', hanPinyinLanguage)).toBe('你好');
  });

  it('uses prosody metadata as the generic prosody capability source', () => {
    expect(languageSupportsProsody({
      name: 'Prosody Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: { type: 'japanese-pitch-accent' },
    })).toBe(true);
    expect(languageSupportsProsody({
      name: 'Legacy Pitch Language',
      colour_codes: {},
      settings: { fixed: {} },
    })).toBe(false);
    expect(languageSupportsProsody({
      name: 'Disabled Prosody Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: { type: 'none' },
    })).toBe(false);
  });

  it('uses installed language names in LLM prompts instead of raw language codes', () => {
    expect(getLanguagePromptName('ar', {
      name: 'Arabic',
      name_translated: 'العربية',
      colour_codes: {},
      settings: { fixed: {} },
    })).toBe('Arabic (العربية)');
    expect(getLanguagePromptName('zh', {
      name: 'Chinese',
      colour_codes: {},
      settings: { fixed: {} },
    })).toBe('Chinese');
    expect(getLanguagePromptName('xx', null)).toBe('xx');
  });

  it('separates generic prosody support from Japanese pitch accent rendering', () => {
    const toneLanguage: LanguageData = {
      name: 'Tone Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: { type: 'tone-contour' },
    };

    expect(languageSupportsProsody(toneLanguage)).toBe(true);
    expect(languageSupportsProsody({
      ...toneLanguage,
      prosody: { type: 'none' },
    })).toBe(false);
    expect(getLanguageProsodyType(toneLanguage)).toBe('tone-contour');
    expect(getLanguageProsodyType({ ...toneLanguage, prosody: { type: 'none' } })).toBeUndefined();
  });

  it('resolves and creates Japanese pitch-accent prosody through one metadata seam', () => {
    const japanesePitchLanguage: LanguageData = {
      ...surfaceReadingLanguage,
      prosody: { type: 'japanese-pitch-accent' },
    };

    expect(getProsodyPositionFromContent({
      type: 'word',
      front: '雨',
      back: 'rain',
      prosody: {
        type: 'japanese-pitch-accent',
        position: 2,
      },
    }, japanesePitchLanguage)).toBe(2);
    expect(getProsodyPositionFromOverride(null, {
      type: 'japanese-pitch-accent',
      position: 2,
    })).toBe(2);
    expect(createProsodyRawPayloadForPosition('japanese-pitch-accent', 3, japanesePitchLanguage)).toEqual({
      type: 'japanese-pitch-accent',
      position: 3,
    });
    expect(createProsodyForPosition('japanese-pitch-accent', 3, {
      type: 'japanese-pitch-accent',
      raw: { pitches: [{ position: 1 }] },
    })).toEqual({
      type: 'japanese-pitch-accent',
      position: 3,
      raw: { pitches: [{ position: 1 }] },
    });
  });

  it('resolves and creates package-defined prosody without Japanese pitch fields', () => {
    const toneLanguage: LanguageData = {
      name: 'Tone Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: { type: 'tone-contour' },
    };

    expect(getProsodyPositionFromContent({
      type: 'word',
      front: '妈',
      back: 'mother',
      prosody: {
        type: 'tone-contour',
        position: 4,
      },
    }, toneLanguage)).toBe(4);
    expect(getProsodyPositionFromOverride(2, {
      type: 'tone-contour',
      position: 4,
    })).toBe(2);
    expect(createProsodyRawPayloadForPosition('tone-contour', 4, toneLanguage)).toEqual({
      type: 'tone-contour',
      position: 4,
    });
    expect(createProsodyForPosition('tone-contour', 4, {
      type: 'tone-contour',
      raw: { contours: [{ syllable: 'ma', tone: 'falling' }] },
    })).toEqual({
      type: 'tone-contour',
      position: 4,
      raw: { contours: [{ syllable: 'ma', tone: 'falling' }] },
    });
    expect(createProsodyForPosition(undefined, 4)).toBeUndefined();
  });

  it('creates raw prosody override payloads from package-declared position paths', () => {
    const stressLanguage: LanguageData = {
      name: 'Stress Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: {
        type: 'stress-position',
        positionPath: ['stress', 'index'],
      },
    };

    expect(createProsodyRawPayloadForPosition('stress-position', 2, stressLanguage)).toEqual({
      type: 'stress-position',
      stress: { index: 2 },
    });
    expect(createProsodyForPosition('stress-position', 2, undefined, undefined, stressLanguage)).toEqual({
      type: 'stress-position',
      position: 2,
      raw: {
        type: 'stress-position',
        stress: { index: 2 },
      },
    });
  });

  it('reads prosody editor text from language metadata', () => {
    const stressLanguage: LanguageData = {
      name: 'Stress Language',
      colour_codes: {},
      settings: { fixed: {} },
      prosody: {
        type: 'stress-position',
        positionLabel: 'Stress position',
        positionPlaceholder: '1, 2, 3...',
        toggleLabel: 'Show stress marks',
        toggleDescription: 'Display lexical stress marks for words',
      },
    };

    expect(getProsodyPositionLabel(stressLanguage)).toBe('Stress position');
    expect(getProsodyPositionPlaceholder(stressLanguage)).toBe('1, 2, 3...');
    expect(getProsodyToggleLabel(stressLanguage)).toBe('Show stress marks');
    expect(getProsodyToggleDescription(stressLanguage)).toBe('Display lexical stress marks for words');
    expect(getProsodyPositionLabel({
      ...stressLanguage,
      prosody: { ...stressLanguage.prosody, positionLabel: '   ' },
    })).toBeUndefined();
  });

  it('uses prosody POS exclusions with legacy Japanese substring matching', () => {
    const japanesePitchLanguage: LanguageData = {
      ...surfaceReadingLanguage,
      prosody: {
        type: 'japanese-pitch-accent',
        particleBoxExcludedPos: ['動詞', '助動詞'],
      },
    };

    expect(prosodyPartOfSpeechCanTakeParticleBox('名詞', japanesePitchLanguage)).toBe(true);
    expect(prosodyPartOfSpeechCanTakeParticleBox('動詞-一般', japanesePitchLanguage)).toBe(false);
    expect(shouldIncludeProsodyParticleBoxForContext('動詞-一般', '助動詞', japanesePitchLanguage)).toBe(false);
    expect(shouldIncludeProsodyParticleBoxForContext('名詞', '助詞', japanesePitchLanguage)).toBe(true);
  });

  it('uses canonical POS aliases for prosody particle-box exclusions', () => {
    const aliasedProsodyLanguage: LanguageData = {
      ...latinLanguage,
      prosody: {
        type: 'japanese-pitch-accent',
        particleBoxExcludedPos: ['verb'],
      },
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          aliases: {
            NOUN: 'noun',
            VERB: 'verb',
          },
        },
      },
    };

    expect(prosodyPartOfSpeechCanTakeParticleBox('NOUN', aliasedProsodyLanguage)).toBe(true);
    expect(prosodyPartOfSpeechCanTakeParticleBox('VERB', aliasedProsodyLanguage)).toBe(false);
    expect(shouldIncludeProsodyParticleBoxForContext('VERB', 'NOUN', aliasedProsodyLanguage)).toBe(false);
  });

  it('lets packages use exact POS matching for prosody exclusions', () => {
    const exactProsodyLanguage: LanguageData = {
      ...latinLanguage,
      prosody: {
        type: 'stress-accent',
        particleBoxExcludedPos: ['verb'],
        particleBoxExcludedPosMatch: 'exact',
      },
      textProcessing: {
        ...latinLanguage.textProcessing,
        partOfSpeech: {
          aliases: {
            VERB: 'verb',
            ADV: 'adverb',
          },
        },
      },
    };

    expect(prosodyPartOfSpeechCanTakeParticleBox('VERB', exactProsodyLanguage)).toBe(false);
    expect(prosodyPartOfSpeechCanTakeParticleBox('ADV', exactProsodyLanguage)).toBe(true);
    expect(prosodyPartOfSpeechCanTakeParticleBox('adverb', exactProsodyLanguage)).toBe(true);
  });

  it('uses metadata-driven reading annotation rules', () => {
    expect(wordNeedsReadingAnnotation('赤い', 'あかい', surfaceReadingLanguage)).toBe(true);
    expect(wordNeedsReadingAnnotation('あかい', 'あかい', surfaceReadingLanguage)).toBe(false);
    expect(wordNeedsReadingAnnotation('Haus', 'haus', latinLanguage)).toBe(false);
    expect(wordNeedsReadingAnnotation('赤い', '赤い', surfaceReadingLanguage)).toBe(false);
    expect(wordNeedsReadingAnnotation('あかい', 'あかい', surfaceReadingLanguage, { force: true })).toBe(false);
    expect(wordNeedsReadingAnnotation('Haus', 'haʊs', latinLanguage, { force: true })).toBe(true);
  });

  it('normalizes rough-tokenizer lemmas through metadata-declared normalizers', () => {
    const language: LanguageData = {
      name: 'German',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lemmaNormalizers: ['casefold', 'strip-diacritics'],
          },
        },
      },
    };

    expect(createRoughTokenizerTokens('Straße CAFÉ', language).map((token) => token.actual_word)).toEqual([
      'strasse',
      'cafe',
    ]);
  });

  it('normalizes Arabic-script rough-tokenizer lemmas with metadata-declared normalizers', () => {
    const language = {
      name: 'Persian',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            tokenCharacterClasses: ['letter', 'mark'],
            lemmaNormalizers: [
              'remove-tatweel',
              'remove-arabic-diacritics',
              {
                type: 'replace-characters',
                map: {
                  'ك': 'ک',
                  'ي': 'ی',
                },
              },
            ],
          },
        },
      },
    } as LanguageData;

    expect(createRoughTokenizerTokens('كِتــاب', language).map((token) => token.actual_word)).toEqual([
      'کتاب',
    ]);
  });

  it('expands tokenizer lemma normalizer presets for Persian Arabic-script variants', () => {
    const language = {
      name: 'Persian',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            tokenCharacterClasses: ['letter', 'mark'],
            lemmaNormalizers: ['persian-arabic'],
          },
        },
      },
    } as LanguageData;

    expect(createRoughTokenizerTokens('كِتــاب يار', language).map((token) => token.actual_word)).toEqual([
      'کتاب',
      'یار',
    ]);
  });

  it('expands object-form tokenizer lemma normalizer presets', () => {
    const language = {
      name: 'Arabic',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            tokenCharacterClasses: ['letter', 'mark'],
            lemmaNormalizers: [{ type: 'preset', name: 'arabic-script' }],
          },
        },
      },
    } as LanguageData;

    expect(createRoughTokenizerTokens('سَلَامــ', language).map((token) => token.actual_word)).toEqual([
      'سلام',
    ]);
  });

  it('expands package-defined tokenizer lemma normalizer presets', () => {
    const language: LanguageData = {
      name: 'Custom Lemma Preset Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        normalizerPresets: {
          'latin-display-fold': [
            'casefold',
            'strip-diacritics',
            { type: 'replace-characters', map: { 'ø': 'o' } },
          ],
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lemmaNormalizers: [{ type: 'preset', name: 'latin-display-fold' }],
          },
        },
      },
    };

    expect(createRoughTokenizerTokens('CAFÉØ', language).map((token) => token.actual_word)).toEqual([
      'cafeo',
    ]);
  });

  it('uses language-level surface normalizers for rough-tokenizer lemmas by default', () => {
    const language = {
      name: 'Persian',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        lexemeNormalization: {
          type: 'surface',
          surfaceScripts: ['Arab'],
          surfaceNormalizers: ['persian-arabic'],
        },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            tokenCharacterClasses: ['letter', 'mark'],
          },
        },
      },
    } as LanguageData;

    expect(createRoughTokenizerTokens('كِتــاب يار', language).map((token) => token.actual_word)).toEqual([
      'کتاب',
      'یار',
    ]);
  });

  it('preserves configured reading suffix scripts in annotation display', () => {
    expect(adjustReadingAnnotationForSurfaceSuffix('赤い', 'あさ', surfaceReadingLanguage)).toBe('あい');
    expect(adjustReadingAnnotationForSurfaceSuffix('赤字', 'あかじ', surfaceReadingLanguage)).toBe('あかじ');
    expect(adjustReadingAnnotationForSurfaceSuffix('Haus', 'haus', latinLanguage)).toBe('haus');
  });

  it('keeps lower-number-is-harder level semantics as the default', () => {
    const levels = { '1': 'N1', '2': 'N2', '3': 'N3', '4': 'N4', '5': 'N5' };
    expect(sortFrequencyLevelsForDisplay([1, 2, 3, 4, 5])).toEqual([5, 4, 3, 2, 1]);
    expect(sortFrequencyLevelsByDifficulty([1, 2, 3, 4, 5])).toEqual([5, 4, 3, 2, 1]);
    expect(getFrequencyLevelsAtOrEasierThanTarget(levels, 2)).toEqual([5, 4, 3, 2]);
    expect(isFrequencyLevelHarderThanTarget(1, 2)).toBe(true);
    expect(selectHarderFrequencyLevel(1, 5)).toBe(1);
    expect(selectHarderFrequencyLevel(5, 1)).toBe(1);
    expect(getFrequencyLevelVisualRank(1, levels)).toBe(1);
    expect(getFrequencyLevelVisualRank(2, levels)).toBe(2);
    expect(getFrequencyLevelVisualRank(3, levels)).toBe(3);
    expect(getFrequencyLevelVisualRank(4, levels)).toBe(4);
    expect(getFrequencyLevelVisualRank(5, levels)).toBe(5);
  });

  it('supports languages whose numeric levels get harder as they increase', () => {
    const ascendingDifficultyLanguage: LanguageData = {
      name: 'Ascending Difficulty Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        difficulty: 'higher-is-harder',
      },
    };
    const levels = { '1': 'A1', '2': 'A2', '3': 'B1', '4': 'B2' };

    expect(sortFrequencyLevelsForDisplay([1, 2, 3, 4], ascendingDifficultyLanguage)).toEqual([1, 2, 3, 4]);
    expect(sortFrequencyLevelsByDifficulty([1, 2, 3, 4], ascendingDifficultyLanguage)).toEqual([1, 2, 3, 4]);
    expect(getFrequencyLevelsAtOrEasierThanTarget(levels, 2, ascendingDifficultyLanguage)).toEqual([1, 2]);
    expect(isFrequencyLevelHarderThanTarget(3, 2, ascendingDifficultyLanguage)).toBe(true);
    expect(selectHarderFrequencyLevel(4, 1, ascendingDifficultyLanguage)).toBe(4);
    expect(selectHarderFrequencyLevel(1, 4, ascendingDifficultyLanguage)).toBe(4);
    expect(getFrequencyLevelVisualRank(4, levels, ascendingDifficultyLanguage)).toBe(1);
    expect(getFrequencyLevelVisualRank(1, levels, ascendingDifficultyLanguage)).toBe(4);
  });

  it('keeps explicit zero-based level maps available for visual rank metadata', () => {
    const zeroBasedLevels: Record<string, string> = {
      '0': 'Beginner',
      '1': 'Elementary',
      '2': 'Intermediate',
      '3': 'Advanced',
      '4': 'Expert',
    };
    const higherIsHarderLanguage: LanguageData = {
      name: 'Zero Based Levels',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        difficulty: 'higher-is-harder',
      },
    };

    expect(getFrequencyLevelVisualRank(0, zeroBasedLevels, higherIsHarderLanguage)).toBe(5);
    expect(getFrequencyLevelVisualRank(4, zeroBasedLevels, higherIsHarderLanguage)).toBe(1);
  });

  it('treats undeclared zero targets as legacy no-limit values', () => {
    const languageWithoutZero: LanguageData = {
      name: 'Legacy Zero Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '1': 'A1', '2': 'A2' },
        difficulty: 'higher-is-harder',
      },
    };

    expect(getFrequencyLevelsAtOrEasierThanTarget({ '1': 'A1', '2': 'A2' }, 0, languageWithoutZero)).toEqual([1, 2]);
    expect(isFrequencyLevelHarderThanTarget(2, 0, languageWithoutZero)).toBe(false);
  });

  it('treats declared zero targets as real frequency levels', () => {
    const zeroBasedLevels: Record<string, string> = {
      '0': 'Starter',
      '1': 'A1',
      '2': 'A2',
    };
    const zeroBasedLanguage: LanguageData = {
      name: 'Zero Based Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: zeroBasedLevels,
        difficulty: 'higher-is-harder',
        displayOrder: 'ascending',
      },
    };

    expect(getFrequencyLevelsAtOrEasierThanTarget(zeroBasedLevels, 0, zeroBasedLanguage)).toEqual([0]);
    expect(getFrequencyLevelsAtOrEasierThanTarget(zeroBasedLevels, 1, zeroBasedLanguage)).toEqual([0, 1]);
    expect(isFrequencyLevelHarderThanTarget(1, 0, zeroBasedLanguage)).toBe(true);
  });

  it('normalizes packaged frequency payloads into rows and effective level metadata', () => {
    const packagedLanguage = {
      name: 'Packaged frequency language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '1': 'Old' },
        rowLevelIndex: 2,
      },
      freq: {
        freq: [
          ['会う', 'あう', 5],
          ['払う', 'はらう', 4],
        ],
        frequencyLevels: {
          names: { '5': 'N5', '4': 'N4' },
          rowLevelIndex: 2,
          difficulty: 'lower-is-harder',
        },
      },
    } as unknown as LanguageData;

    const resolved = resolveLanguageFrequencyPayload(packagedLanguage);

    expect(resolved.rows).toEqual([
      ['会う', 'あう', 5],
      ['払う', 'はらう', 4],
    ]);
    expect(resolved.languageData?.freq).toEqual(resolved.rows);
    expect(resolved.languageData?.frequencyLevels).toEqual({
      names: { '5': 'N5', '4': 'N4' },
      rowLevelIndex: 2,
      difficulty: 'lower-is-harder',
    });
  });

  it('selects a frequency provider and one of its level systems', () => {
    const language = {
      name: 'Multi-provider language',
      defaultFrequencyProvider: 'corpus',
      frequencyProviders: {
        corpus: {
          name: 'Corpus',
          freq: [['частый', 'ча́стый', 1]],
          frequencyLevels: {
            names: { '1': 'Common' },
            rowLevelIndex: 2,
          },
        },
        smartool: {
          name: 'SMARTool',
          freq: [['слово', 'слово', 3]],
          defaultLevelSystem: 'cefr',
          levelSystems: {
            cefr: {
              name: 'CEFR',
              frequencyLevels: { names: { '3': 'B1' }, rowLevelIndex: 2 },
            },
            trki: {
              name: 'ТРКИ',
              frequencyLevels: { names: { '3': 'ТРКИ-1' }, rowLevelIndex: 2 },
            },
          },
        },
      },
    } as LanguageData;

    const defaultResolved = resolveLanguageFrequencyPayload(language);
    expect(defaultResolved.rows).toEqual([['частый', 'ча́стый', 1]]);
    expect(defaultResolved.providerId).toBe('corpus');

    const invalidResolved = resolveLanguageFrequencyPayload(language, '__proto__', 'constructor');
    expect(invalidResolved.providerId).toBe('corpus');
    expect(invalidResolved.rows).toEqual([['частый', 'ча́стый', 1]]);

    const smartoolResolved = resolveLanguageFrequencyPayload(language, 'smartool', 'trki');
    expect(smartoolResolved.rows).toEqual([['слово', 'слово', 3]]);
    expect(smartoolResolved.providerId).toBe('smartool');
    expect(smartoolResolved.levelSystemId).toBe('trki');
    expect(smartoolResolved.languageData?.frequencyLevels?.names).toEqual({ '3': 'ТРКИ-1' });
    expect(smartoolResolved.languageData?.activeFrequencyProvider).toBe('smartool');
    expect(smartoolResolved.languageData?.activeFrequencyLevelSystem).toBe('trki');
  });

  it('excludes sentinel frequency levels from target-derived level lists', () => {
    const levels = { '-1': 'Not in list', '1': 'N1', '5': 'N5' };

    expect(getFrequencyLevelsAtOrEasierThanTarget(levels, 5)).toEqual([5]);
    expect(isFrequencyLevelHarderThanTarget(-1, 5)).toBe(false);
  });

  it('labels unnamed frequency and grammar levels from language fallback templates', () => {
    const templatedLanguage: LanguageData = {
      name: 'Templated Level Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        fallbackLabelTemplate: 'Band {level}',
      },
      grammarLevels: {
        fallbackLabelTemplate: 'Pattern {level}',
      },
    };

    expect(getFrequencyLevelLabel(3, {}, templatedLanguage)).toBe('Band 3');
    expect(getFrequencyLevelLabel(3, { 3: 'Named Band' }, templatedLanguage)).toBe('Named Band');
    expect(getGrammarLevelLabel(4, {}, templatedLanguage)).toBe('Pattern 4');
    expect(getGrammarLevelLabel(4, { 4: 'Named Pattern' }, templatedLanguage)).toBe('Named Pattern');
  });

  it('does not turn sentinel or undeclared zero frequency levels into user-facing labels', () => {
    const templatedLanguage: LanguageData = {
      name: 'Templated Level Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        fallbackLabelTemplate: 'Band {level}',
      },
    };

    expect(getFrequencyLevelLabel(-1, {}, templatedLanguage)).toBe('');
    expect(getFrequencyLevelLabel(Number.NaN, {}, templatedLanguage)).toBe('');
    expect(getFrequencyLevelLabel(0, {}, templatedLanguage)).toBe('');
    expect(getFrequencyLevelLabel(0, { 0: 'Starter' }, templatedLanguage)).toBe('Starter');
  });

  it('uses nested level metadata names instead of top-level level-name maps', () => {
    const namedLevelLanguage = {
      name: 'Named Level Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        names: { '1': 'A1', '2': 'A2' },
        fallbackLabelTemplate: 'Band {level}',
      },
      grammarLevels: {
        names: { '1': 'Grammar A1', '2': 'Grammar A2' },
        fallbackLabelTemplate: 'Pattern {level}',
      },
    } as unknown as LanguageData;

    expect(getFrequencyLevelLabel(1, {}, namedLevelLanguage)).toBe('A1');
    expect(getFrequencyLevelLabel(3, {}, namedLevelLanguage)).toBe('Band 3');
    expect(getGrammarLevelLabel(2, {}, namedLevelLanguage)).toBe('Grammar A2');
    expect(getGrammarLevelLabel(3, {}, namedLevelLanguage)).toBe('Pattern 3');
  });

  it('lets grammar level labels reuse the frequency fallback template when grammar has none', () => {
    const frequencyOnlyTemplateLanguage: LanguageData = {
      name: 'Shared Level Template Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        fallbackLabelTemplate: 'Stage {level}',
      },
    };

    expect(getGrammarLevelLabel(2, {}, frequencyOnlyTemplateLanguage)).toBe('Stage 2');
    expect(getFrequencyLevelLabel(2, {}, null)).toBe('Level 2');
    expect(getGrammarLevelLabel(2, {}, null)).toBe('Level 2');
  });

  it('maps dense language-specific level scales onto the bounded visual palette', () => {
    const denseLevels = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [String(index + 1), `L${index + 1}`]),
    );

    expect(getFrequencyLevelVisualRank(1, denseLevels)).toBe(1);
    expect(getFrequencyLevelVisualRank(5, denseLevels)).toBe(4);
    expect(getFrequencyLevelVisualRank(10, denseLevels)).toBe(7);
    expect(getFrequencyLevelVisualRank(30, { '10': 'A', '20': 'B', '30': 'C' })).toBe(3);
    expect(getFrequencyLevelVisualRank(42, denseLevels)).toBe(7);
  });

  it('supports grammar levels with language-specific ordering', () => {
    const cefrGrammarLanguage: LanguageData = {
      name: 'CEFR Grammar Language',
      colour_codes: {},
      settings: { fixed: {} },
      grammarLevels: {
        difficulty: 'higher-is-harder',
      },
    };

    expect(sortGrammarLevelsForDisplay([1, 2, 3, 4], cefrGrammarLanguage)).toEqual([1, 2, 3, 4]);
    expect(sortGrammarLevelsByDifficulty([1, 2, 3, 4], cefrGrammarLanguage)).toEqual([1, 2, 3, 4]);
    expect(sortGrammarLevelsForDisplay([1, 2, 3, 4])).toEqual([4, 3, 2, 1]);
    expect(sortGrammarLevelsByDifficulty([1, 2, 3, 4])).toEqual([4, 3, 2, 1]);
  });

  it('maps grammar levels onto visual ranks using grammar difficulty metadata', () => {
    const cefrGrammarLanguage: LanguageData = {
      name: 'CEFR Grammar Language',
      colour_codes: {},
      settings: { fixed: {} },
      frequencyLevels: {
        difficulty: 'lower-is-harder',
      },
      grammarLevels: {
        difficulty: 'higher-is-harder',
      },
    };
    const grammarLevels = { '1': 'A1', '2': 'A2', '3': 'B1', '4': 'B2' };

    expect(getGrammarLevelVisualRank(4, grammarLevels, cefrGrammarLanguage)).toBe(1);
    expect(getGrammarLevelVisualRank(1, grammarLevels, cefrGrammarLanguage)).toBe(4);
    expect(getFrequencyLevelVisualRank(4, grammarLevels, cefrGrammarLanguage)).toBe(4);
  });

  it('uses tokenizer metadata to decide whether renderer fallback tokens are allowed', () => {
    expect(tokenizerAllowsFallback(null)).toBe(false);
    expect(tokenizerAllowsFallback({
      name: 'Optional Tokenizer Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            fallback: 'unicode-word',
          },
        },
      },
    })).toBe(true);
    expect(tokenizerAllowsFallback({
      name: 'Optional Tokenizer Without Explicit Fallback',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
          },
        },
      },
    })).toBe(false);
    expect(tokenizerAllowsFallback({
      name: 'Required Tokenizer Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'sudachi',
            required: true,
          },
        },
      },
    })).toBe(false);
    expect(tokenizerAllowsFallback({
      name: 'No Fallback Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            fallback: 'none',
          },
        },
      },
    })).toBe(false);
    expect(tokenizerAllowsFallback({
      name: 'Legacy Kana Kanji Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
      },
    })).toBe(false);
    expect(tokenizerAllowsFallback({
      name: 'Unconfigured Chinese Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
    })).toBe(false);
    expect(tokenizerAllowsFallback({
      name: 'Chinese with missing linguistic tokenizer fallback',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            fallback: 'unicode-word',
          },
        },
      },
    })).toBe(false);
    expect(tokenizerAllowsFallback({
      name: 'Chinese with explicit degraded tokenizer fallback',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            fallback: 'unicode-word',
            allowRoughSegmentationForSegmentlessScripts: true,
          },
        },
      },
    })).toBe(true);
  });

  it('separates rough unicode-word segmentation from morphological tokenizer capabilities', () => {
    expect(getTokenizerCapabilities({
      name: 'German with unicode-word segmenter',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
          },
        },
      },
    })).toEqual({
      segmentsText: true,
      segmentationQuality: 'rough',
      providesLemmas: false,
      providesPartOfSpeech: false,
      providesReadings: false,
      providesMorphology: false,
      allowsRoughFallback: true,
    });

    expect(getTokenizerCapabilities({
      name: 'German with spaCy tokenizer',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            model: 'de_core_news_sm',
          },
        },
      },
    })).toEqual({
      segmentsText: true,
      segmentationQuality: 'linguistic',
      providesLemmas: true,
      providesPartOfSpeech: true,
      providesReadings: false,
      providesMorphology: true,
      allowsRoughFallback: false,
    });

    expect(getTokenizerCapabilities({
      name: 'Japanese with Sudachi tokenizer',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'sudachi',
          },
        },
      },
    })).toEqual({
      segmentsText: true,
      segmentationQuality: 'linguistic',
      providesLemmas: true,
      providesPartOfSpeech: true,
      providesReadings: true,
      providesMorphology: false,
      allowsRoughFallback: false,
    });

    expect(getTokenizerCapabilities({
      name: 'Analyzer without segmentation',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            capabilities: ['lemmas', 'partOfSpeech'],
          },
        },
      },
    })).toEqual({
      segmentsText: false,
      segmentationQuality: 'none',
      providesLemmas: true,
      providesPartOfSpeech: true,
      providesReadings: false,
      providesMorphology: false,
      allowsRoughFallback: false,
    });

    expect(getTokenizerCapabilities({
      name: 'Custom Chinese tokenizer',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'third-party-word-segmenter',
            capabilities: ['segments', 'readings'],
            fallback: 'unicode-word',
          },
        },
      },
    })).toEqual({
      segmentsText: true,
      segmentationQuality: 'linguistic',
      providesLemmas: false,
      providesPartOfSpeech: false,
      providesReadings: true,
      providesMorphology: false,
      allowsRoughFallback: true,
    });

    expect(getTokenizerCapabilities({
      name: 'Opaque custom tokenizer',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unknown-tokenizer',
          },
        },
      },
    })).toEqual({
      segmentsText: false,
      segmentationQuality: 'none',
      providesLemmas: false,
      providesPartOfSpeech: false,
      providesReadings: false,
      providesMorphology: false,
      allowsRoughFallback: false,
    });

    expect(getTokenizerCapabilities({
      name: 'Unconfigured Language',
      colour_codes: {},
      settings: { fixed: {} },
    })).toEqual({
      segmentsText: false,
      segmentationQuality: 'none',
      providesLemmas: false,
      providesPartOfSpeech: false,
      providesReadings: false,
      providesMorphology: false,
      allowsRoughFallback: false,
    });
  });

  it('does not infer Sudachi from legacy kana-kanji metadata', () => {
    const legacyKanaKanjiLanguage: LanguageData = {
      name: 'Legacy Kana Kanji Language',
      colour_codes: {},
      settings: { fixed: {} },
          };

    expect(getTokenizerRuntimeConfig(legacyKanaKanjiLanguage)).toEqual({
      type: 'none',
      required: true,
      fallback: 'none',
    });
  });

  it('requires explicit tokenizer metadata for languages where rough segmentation is unsafe', () => {
    expect(getTokenizerRuntimeConfig({
      name: 'Chinese',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
    })).toEqual({
      type: 'none',
      required: true,
      fallback: 'none',
    });

    expect(getTokenizerRuntimeConfig({
      name: 'Thai',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Thai'] },
      },
    })).toEqual({
      type: 'none',
      required: true,
      fallback: 'none',
    });

    expect(tokenizerAllowsFallback({
      name: 'German without tokenizer metadata',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
    })).toBe(false);

    expect(tokenizerAllowsFallback({
      name: 'German with explicit unicode-word segmenter',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
          },
        },
      },
    })).toBe(true);

    expect(getTokenizerRuntimeConfig({
      name: 'Chinese with rough fallback behind missing analyzer',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Han'] },
      },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            fallback: 'unicode-word',
          },
        },
      },
    })).toEqual({
      type: 'spacy',
      fallback: 'none',
    });
  });

  it('creates metadata-driven rough tokenizer tokens', () => {
    const englishLike: LanguageData = {
      name: 'English-like',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
            innerTokenCharacters: ["'"],
          },
        },
      },
    };

    expect(createRoughTokenizerTokens("Don't STOP.", englishLike)).toEqual([
      { word: "Don't", actual_word: "don't", type: 'WORD', surface: "Don't" },
      { word: 'STOP', actual_word: 'stop', type: 'WORD', surface: 'STOP' },
    ]);

    expect(createRoughTokenizerTokens("'Don't'", englishLike).map((token) => token.word)).toEqual([
      "Don't",
    ]);
  });

  it('does not assume apostrophes are word characters without tokenizer metadata', () => {
    const language: LanguageData = {
      name: 'Plain rough tokenizer',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            lowercaseLemma: true,
          },
        },
      },
    };

    expect(createRoughTokenizerTokens("'Don't'", language).map((token) => token.word)).toEqual([
      'Don',
      't',
    ]);
  });

  it('supports rough tokenizer extra token characters from metadata', () => {
    const persianLike: LanguageData = {
      name: 'Persian-like',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            extraTokenCharacters: ['\u200c'],
          },
        },
      },
    };

    expect(createRoughTokenizerTokens('می‌روم خانه', persianLike).map((token) => token.word)).toEqual([
      'می‌روم',
      'خانه',
    ]);
  });

  it('keeps metadata inner token characters only inside rough tokens', () => {
    const language: LanguageData = {
      name: 'Inner joiners',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'unicode-word',
            innerTokenCharacters: ["'", '-', '\u200c'],
          },
        },
      },
    };

    expect(createRoughTokenizerTokens("'quoted' می\u200cروم state-of-the-art - loose", language).map((token) => token.word)).toEqual([
      'quoted',
      'می\u200cروم',
      'state-of-the-art',
      'loose',
    ]);
  });

  it('does not normalize deprecated rough tokenizer aliases', () => {
    const deprecatedAliasLanguage = {
      name: 'Deprecated Rough Alias',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        nlp: {
          tokenizer: {
            type: 'regex',
            fallback: 'basic',
          },
        },
      },
    } as LanguageData;

    expect(getTokenizerRuntimeConfig(deprecatedAliasLanguage)).toMatchObject({
      type: 'regex',
      fallback: 'basic',
    });
    expect(getTokenizerCapabilities(deprecatedAliasLanguage)).toMatchObject({
      segmentsText: false,
      segmentationQuality: 'none',
      providesLemmas: false,
      providesPartOfSpeech: false,
      providesReadings: false,
      providesMorphology: false,
    });
    expect(tokenizerAllowsFallback(deprecatedAliasLanguage)).toBe(false);
  });

  it('uses explicit OCR runtime metadata for ram-saver support', () => {
    const runtimeOcrLanguage: LanguageData = {
      name: 'Runtime OCR Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'paddleocr',
          paddleLang: 'ch',
          supportsRamSaver: true,
        },
      },
    };

    expect(getOcrRuntimeConfig(runtimeOcrLanguage)).toEqual({
      recognitionEngine: 'paddleocr',
      paddleLang: 'ch',
      supportsRamSaver: true,
    });
    expect(ocrRuntimeSupportsRamSaver(runtimeOcrLanguage)).toBe(true);
    expect(ocrRuntimeSupportsRamSaver({
      name: 'Manga OCR With Explicitly Disabled Ram Saver',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'mangaocr',
          supportsRamSaver: false,
        },
      },
    })).toBe(false);
    expect(ocrRuntimeSupportsRamSaver({
      name: 'Manga OCR Without Ram Saver Metadata',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'mangaocr',
        },
      },
    })).toBe(false);
  });

  it('collects Python requirements declared by installed language runtime components', () => {
    const languageData = {
      ja: {
        name: 'Japanese',
        colour_codes: {},
        settings: { fixed: {} },
        runtime: {
          python: {
            packages: ['ja-required-extra'],
            packagesByComponent: {
              voice: ['misaki', 'fugashi[unidic-lite]', 'jaconv', 'pyopenjtalk', 'mojimoji'],
              ocr: ['language-specific-ocr-extra'],
              segmentation: ['sudachi-runtime-extra'],
            },
          },
        },
      },
      de: {
        name: 'German',
        colour_codes: {},
        settings: { fixed: {} },
        runtime: {
          python: {
            packagesByComponent: {
              voice: ['de-tts-extra', 'misaki'],
              llm: ['de-llm-extra'],
              morphology: ['spacy-de-extra'],
            },
          },
        },
      },
    };

    expect(getLanguagePythonRequirementsForInstall(languageData, {
      includeLLM: false,
      includeOCR: false,
      includeVoice: true,
    })).toEqual(['de-tts-extra', 'fugashi[unidic-lite]', 'ja-required-extra', 'jaconv', 'misaki', 'mojimoji', 'pyopenjtalk', 'spacy-de-extra', 'sudachi-runtime-extra']);

    expect(getLanguagePythonRequirementsForInstall(languageData, {
      includeLLM: false,
      includeOCR: true,
      includeVoice: false,
    })).toEqual(['ja-required-extra', 'language-specific-ocr-extra', 'spacy-de-extra', 'sudachi-runtime-extra']);
  });

  it('collects Python import checks declared by installed language runtime components', () => {
    const languageData = {
      ja: {
        name: 'Japanese',
        runtime: {
          python: {
            importChecksByComponent: {
              core: ['sudachipy'],
              ocr: ['manga_ocr', 'paddleocr'],
              voice: ['misaki'],
              segmentation: ['sudachi_runtime'],
            },
          },
        },
      },
      de: {
        name: 'German',
        runtime: {
          python: {
            importChecksByComponent: {
              morphology: ['spacy'],
            },
          },
        },
      },
    };

    expect(getLanguagePythonImportChecksForInstall(languageData, {
      includeLLM: false,
      includeOCR: true,
      includeVoice: false,
    })).toEqual(['manga_ocr', 'paddleocr', 'spacy', 'sudachi_runtime', 'sudachipy']);

    expect(getLanguagePythonImportChecksForInstall(languageData, {
      includeLLM: false,
      includeOCR: false,
      includeVoice: true,
    })).toEqual(['misaki', 'spacy', 'sudachi_runtime', 'sudachipy']);
  });

  it('uses OCR runtime metadata for vertical text support', () => {
    expect(ocrRuntimeSupportsVerticalText({
      name: 'Runtime Vertical OCR',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          supportsVerticalText: true,
        },
      },
    })).toBe(true);
    expect(ocrRuntimeSupportsVerticalText({
      name: 'Runtime Disabled Vertical OCR',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          supportsVerticalText: false,
        },
      },
    })).toBe(false);
    expect(ocrRuntimeSupportsVerticalText({
      name: 'Unconfigured Vertical OCR',
      colour_codes: {},
      settings: { fixed: {} },
    })).toBe(false);
  });

  it('resolves learning language level from the per-language map without leaking legacy scalar fallback', () => {
    expect(getLearningLanguageLevelForLanguage({
      learningLanguageLevel: 3,
      learningLanguageLevels: { ja: 2, de: null },
    }, 'ja')).toBe(2);
    expect(getLearningLanguageLevelForLanguage({
      learningLanguageLevel: 3,
      learningLanguageLevels: { ja: 2, de: null },
    }, 'de')).toBeNull();
    expect(getLearningLanguageLevelForLanguage({
      learningLanguageLevel: 3,
      learningLanguageLevels: { ja: 2 },
    }, 'fr')).toBeNull();
    // @ts-expect-error Legacy scalar fallback options must not be accepted for concrete languages.
    expect(getLearningLanguageLevelForLanguage({
      learningLanguageLevel: 3,
      learningLanguageLevels: { ja: 2 },
    }, 'fr', { legacyFallbackLanguage: 'fr' })).toBeNull();
  });

  it('uses language reader defaults while app settings are still at their global defaults', () => {
    const language: LanguageData = {
      name: 'Left-to-right Reader Language',
      reader: {
        pageMode: 'single',
        spreadDirection: 'left-to-right',
        firstPageSingle: false,
        collatePages: true,
      },
    };

    expect(getReaderPageModeForLanguage(DEFAULT_SETTINGS, language)).toBe('single');
    expect(getReaderSpreadDirectionForLanguage(DEFAULT_SETTINGS, language)).toBe('left-to-right');
    expect(getReaderFirstPageSingleForLanguage(DEFAULT_SETTINGS, language)).toBe(false);
    expect(getReaderCollatePagesForLanguage(DEFAULT_SETTINGS, language)).toBe(true);
  });

  it('keeps explicit reader settings over language reader defaults', () => {
    const language: LanguageData = {
      name: 'Opposite Reader Language',
      reader: {
        pageMode: 'double',
        spreadDirection: 'right-to-left',
        firstPageSingle: true,
        collatePages: false,
      },
    };
    const explicitSettings = {
      ...DEFAULT_SETTINGS,
      readerPageMode: 'single' as const,
      readerSpreadDirection: 'left-to-right' as const,
      readerFirstPageSingle: false,
      readerCollatePages: true,
    };

    expect(getReaderPageModeForLanguage(explicitSettings, language)).toBe('single');
    expect(getReaderSpreadDirectionForLanguage(explicitSettings, language)).toBe('left-to-right');
    expect(getReaderFirstPageSingleForLanguage(explicitSettings, language)).toBe(false);
    expect(getReaderCollatePagesForLanguage(explicitSettings, language)).toBe(true);
  });

  it('does not infer MangaOCR without OCR runtime metadata', () => {
    const unconfiguredOcrLanguage: LanguageData = {
      name: 'Unconfigured OCR Language',
      colour_codes: {},
      settings: { fixed: {} },
    };

    expect(getOcrRuntimeConfig(unconfiguredOcrLanguage)).toEqual({});
    expect(ocrRuntimeSupportsRamSaver(unconfiguredOcrLanguage)).toBe(false);
  });

  it('resolves cloud OCR engine from language OCR runtime metadata', () => {
    const mangaLanguage: LanguageData = {
      name: 'Manga OCR Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'mangaocr',
        },
      },
    };
    const rapidLanguage: LanguageData = {
      name: 'Rapid OCR Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'rapidocr',
        },
      },
    };
    const genericLanguage: LanguageData = {
      name: 'Generic OCR Language',
      colour_codes: {},
      settings: { fixed: {} },
    };
    const customRuntimeLanguage: LanguageData = {
      name: 'Custom OCR Runtime Language',
      colour_codes: {},
      settings: { fixed: {} },
      runtime: {
        ocr: {
          recognitionEngine: 'arabic-transformer-ocr',
        },
      },
    };

    expect(resolveCloudOcrEngine(mangaLanguage, true)).toBe('manga-ocr');
    expect(resolveCloudOcrEngine(mangaLanguage, false)).toBe('manga-ocr');
    expect(resolveCloudOcrEngine({ ...mangaLanguage, runtime: undefined }, true)).toBeUndefined();
    expect(resolveCloudOcrEngine(rapidLanguage, false)).toBe('rapid');
    expect(resolveCloudOcrEngine(customRuntimeLanguage, true)).toBe('arabic-transformer-ocr');
    expect(resolveCloudOcrEngine(genericLanguage, true)).toBeUndefined();
    expect(resolveCloudOcrEngine(genericLanguage, false)).toBeUndefined();
  });

  it('uses tokenizer metadata to decide whether romanized input should be tokenized', () => {
    const nonLatinLanguage: LanguageData = {
      name: 'Non Latin Language',
      colour_codes: {},
      settings: { fixed: {} },
          };
    const pinyinAwareLanguage: LanguageData = {
      ...nonLatinLanguage,
      runtime: {
        nlp: {
          tokenizer: {
            type: 'spacy',
            acceptsRomanizedInput: true,
          },
        },
      },
    };
    const latinLanguage: LanguageData = {
      name: 'Latin Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
    };

    expect(shouldTokenizeTextForLanguage('ni hao', 'zh', nonLatinLanguage)).toBe(false);
    expect(shouldTokenizeTextForLanguage('ni hao', 'zh', pinyinAwareLanguage)).toBe(true);
    expect(shouldTokenizeTextForLanguage('你好 ni hao', 'zh', nonLatinLanguage)).toBe(true);
    expect(shouldTokenizeTextForLanguage('привет', 'zh', nonLatinLanguage)).toBe(false);
    expect(shouldTokenizeTextForLanguage('مرحبا', 'zh', nonLatinLanguage)).toBe(false);
    expect(shouldTokenizeTextForLanguage('hello', 'en', latinLanguage)).toBe(true);
    expect(shouldTokenizeTextForLanguage('12345', 'en', latinLanguage)).toBe(false);
    expect(shouldTokenizeTextForLanguage('   ', 'zh', pinyinAwareLanguage)).toBe(false);
  });
});
