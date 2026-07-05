import type { LanguageData } from './types';

export const thirdPartyTokenizerLanguage = {
  name: 'Third-party tokenizer language',
  settings: { fixed: {} },
  runtime: {
    python: {
      packages: ['jieba>=0.42'],
      packagesByComponent: {
        segmentation: ['jieba-fast'],
      },
    },
    nlp: {
      tokenizer: {
        type: 'jieba',
        required: true,
        capabilities: ['segments', 'lemmas', 'partOfSpeech', 'morphology'],
        outputReadingNormalizer: ['lowercase-strip-diacritics'],
      },
    },
  },
} satisfies LanguageData;

export const thirdPartyDictionaryLanguage = {
  name: 'Third-party dictionary language',
  settings: { fixed: {} },
  runtime: {
    nlp: {
      dictionary: {
        type: 'http-json-dictionary',
        path: 'dictionaries/third-party/dictionary.db',
      },
    },
  },
} satisfies LanguageData;

export const thirdPartyTtsLanguage = {
  name: 'Third-party TTS language',
  settings: { fixed: {} },
  runtime: {
    adapter: {
      type: 'python-module',
      path: 'adapters/arabic_tts.py',
    },
    tts: {
      engine: 'arabic-tts-adapter',
      diagnosticText: 'مرحبا',
    },
  },
} satisfies LanguageData;

export const thirdPartyOcrLanguage = {
  name: 'Third-party OCR language',
  settings: { fixed: {} },
  runtime: {
    adapter: {
      type: 'python-module',
      path: 'adapters/custom_ocr.py',
    },
    ocr: {
      recognitionEngine: 'arabic-transformer-ocr',
      supportsVerticalText: false,
      supportsRamSaver: true,
    },
  },
} satisfies LanguageData;

export const thirdPartyPersianLikeLanguage = {
  name: 'Third-party Persian-like language',
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: {
      acceptedScripts: ['Arab'],
    },
    lexemeNormalization: {
      type: 'reading',
      surfaceScripts: ['Arab'],
      readingScripts: ['Arab'],
      readingNormalizer: ['remove-arabic-diacritics', 'remove-tatweel', 'persian-arabic'],
    },
  },
} satisfies LanguageData;

export const thirdPartyNormalizerPresetLanguage = {
  name: 'Third-party normalizer preset language',
  settings: { fixed: {} },
  runtime: {
    nlp: {
      tokenizer: {
        type: 'unicode-word',
        lemmaNormalizers: [
          { type: 'preset', name: 'third-party-transliteration-fold' },
        ],
      },
      dictionary: {
        lookup: {
          seedForms: ['surface', 'tokenizer-lemma', 'third-party-stem'],
          normalizers: [
            { type: 'preset', name: 'third-party-dictionary-fold' },
          ],
        },
      },
    },
  },
} satisfies LanguageData;

export const thirdPartyFullStackLanguage = {
  name: 'Third-party full-stack language',
  settings: { fixed: {} },
  typography: {
    textDirection: 'rtl',
    subtitleFontFamily: 'Noto Naskh Arabic, serif',
  },
  textProcessing: {
    scriptProfile: {
      acceptedScripts: ['Arab'],
      scriptRanges: {
        ThirdPartyScript: [[0xE000, 0xE07F]],
      },
      allowsRomanization: true,
    },
    tokenEstimation: {
      compactScripts: ['Arab'],
    },
    readingAnnotation: {
      type: 'script-reading',
      annotationScripts: ['Arab'],
      readingSeparator: ' ',
    },
    partOfSpeech: {
      translatable: ['NOUN', 'VERB', 'ADJ'],
      ignored: ['PUNCT'],
      aliases: {
        noun: 'NOUN',
      },
    },
  },
  prosody: {
    type: 'tone-contour',
    positionPath: ['tones', '*', 'number'],
    displayPath: ['tones', '*', 'label'],
    positionLabel: 'Tone position',
  },
  runtime: {
    adapter: {
      type: 'python-module',
      path: 'adapters/full_stack_language.py',
    },
    python: {
      packages: ['custom-tokenizer>=1.0'],
      packagesByComponent: {
        ocr: ['custom-ocr>=1.0'],
        voice: ['custom-tts>=1.0'],
      },
    },
    ocr: {
      recognitionEngine: 'custom-arab-ocr',
      supportsVerticalText: false,
      supportsRamSaver: true,
    },
    nlp: {
      tokenizer: {
        type: 'unicode-word',
        tokenCharacterClasses: ['letter', 'mark', 'number'],
        tokenCharacterScripts: ['Arab'],
        innerTokenCharacters: ['\u200c', "'", '-'],
        capabilities: ['segments', 'lemmas', 'partOfSpeech', 'readings', 'morphology'],
      },
      dictionary: {
        type: 'sqlite-zlib-json',
        schema: 'headword-reading-zlib-json',
        targetPathTemplate: 'dictionaries/{language}/{target}/dictionary.db',
        readingPath: ['pronunciations', '*', 'value'],
        definitionsPath: ['senses', '*', 'glosses'],
        defaultTargetLanguage: 'en',
        lookup: {
          seedForms: ['surface', 'tokenizer-lemma', 'third-party-root'],
          readingLookup: {
            scripts: ['Latn'],
          },
          readingRank: [
            'common',
            { type: 'script', scripts: ['Arab'] },
          ],
        },
      },
    },
    tts: {
      engine: 'custom-arab-tts',
      webSpeechLang: 'ar',
      diagnosticText: 'مرحبا',
    },
    stt: {
      whisperLanguage: 'ar',
      hallucinationPhrases: ['شكرا للمشاهدة'],
    },
  },
} satisfies LanguageData;
