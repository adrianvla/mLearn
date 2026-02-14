/**
 * Language-to-model mapping for sherpa-onnx voice models.
 * Maps language codes to download URLs for STT, TTS, and VAD models.
 *
 * Model sources:
 * - STT: https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models
 * - TTS: https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
 * - VAD: Silero VAD (shared across all languages)
 */

const SHERPA_RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

// ============================================================================
// VAD Model (shared across all languages)
// ============================================================================

export const VAD_MODEL = {
  url: `${SHERPA_RELEASES}/asr-models/silero_vad.onnx`,
  filename: 'silero_vad.onnx',
} as const;

// ============================================================================
// STT Model Definitions
// ============================================================================

export interface STTModelConfig {
  /** Archive/model download URL */
  url: string;
  /** Directory name after extraction (for tar archives) or filename */
  dirName: string;
  /** File paths relative to dirName */
  files: {
    encoder: string;
    decoder: string;
    joiner: string;
    tokens: string;
  };
  /** Whether this is a tar.bz2 archive that needs extraction */
  isArchive: boolean;
}

const STT_MODELS: Record<string, STTModelConfig> = {
  // Bilingual Chinese+English streaming model
  'zh': {
    url: `${SHERPA_RELEASES}/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2`,
    dirName: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
    isArchive: true,
  },
  // English streaming model
  'en': {
    url: `${SHERPA_RELEASES}/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2`,
    dirName: 'sherpa-onnx-streaming-zipformer-en-2023-06-26',
    files: {
      encoder: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1-chunk-16-left-128.onnx',
      joiner: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
      tokens: 'tokens.txt',
    },
    isArchive: true,
  },
  // Japanese — use bilingual zh-en model which handles ja reasonably,
  // or a multilingual model. Using the multilingual model for broader coverage.
  'ja': {
    url: `${SHERPA_RELEASES}/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2`,
    dirName: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
    isArchive: true,
  },
  // Korean — use bilingual zh-en as fallback
  'ko': {
    url: `${SHERPA_RELEASES}/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2`,
    dirName: 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20',
    files: {
      encoder: 'encoder-epoch-99-avg-1.int8.onnx',
      decoder: 'decoder-epoch-99-avg-1.onnx',
      joiner: 'joiner-epoch-99-avg-1.int8.onnx',
      tokens: 'tokens.txt',
    },
    isArchive: true,
  },
};

// Fallback: use English model for unsupported languages
const DEFAULT_STT_MODEL = STT_MODELS['en'];

// ============================================================================
// TTS Model Definitions
// ============================================================================

export interface TTSModelConfig {
  /** Model type: 'kokoro' for Kokoro ONNX, 'vits' for Piper VITS */
  type: 'kokoro' | 'vits';
  /** Archive/model download URL */
  url: string;
  /** Directory name after extraction */
  dirName: string;
  /** File paths relative to dirName */
  files: {
    model: string;
    tokens: string;
    voices?: string;
    dataDir?: string;
    lexicon?: string;
  };
  /** Whether this is a tar.bz2 archive that needs extraction */
  isArchive: boolean;
  /** Default speaker ID */
  speakerId: number;
  /** Language code for Kokoro multilingual models (e.g. 'en', 'ja', 'zh') */
  kokoroLang?: string;
}

const TTS_MODELS: Record<string, TTSModelConfig> = {
  // Kokoro multilingual — covers en, zh, ja, ko, fr, de, es, etc.
  'en': {
    type: 'kokoro',
    url: `${SHERPA_RELEASES}/tts-models/kokoro-multi-lang-v1_1.tar.bz2`,
    dirName: 'kokoro-multi-lang-v1_1',
    files: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
      voices: 'voices.bin',
      dataDir: 'espeak-ng-data',
    },
    isArchive: true,
    speakerId: 0,
    kokoroLang: 'en',
  },
  'zh': {
    type: 'kokoro',
    url: `${SHERPA_RELEASES}/tts-models/kokoro-multi-lang-v1_1.tar.bz2`,
    dirName: 'kokoro-multi-lang-v1_1',
    files: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
      voices: 'voices.bin',
      dataDir: 'espeak-ng-data',
    },
    isArchive: true,
    speakerId: 50,
    kokoroLang: 'zh',
  },
  'ja': {
    type: 'kokoro',
    url: `${SHERPA_RELEASES}/tts-models/kokoro-multi-lang-v1_1.tar.bz2`,
    dirName: 'kokoro-multi-lang-v1_1',
    files: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
      voices: 'voices.bin',
      dataDir: 'espeak-ng-data',
    },
    isArchive: true,
    speakerId: 58,
    kokoroLang: 'ja',
  },
  'ko': {
    type: 'kokoro',
    url: `${SHERPA_RELEASES}/tts-models/kokoro-multi-lang-v1_1.tar.bz2`,
    dirName: 'kokoro-multi-lang-v1_1',
    files: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
      voices: 'voices.bin',
      dataDir: 'espeak-ng-data',
    },
    isArchive: true,
    speakerId: 59,
    kokoroLang: 'ko',
  },
  'fr': {
    type: 'kokoro',
    url: `${SHERPA_RELEASES}/tts-models/kokoro-multi-lang-v1_1.tar.bz2`,
    dirName: 'kokoro-multi-lang-v1_1',
    files: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
      voices: 'voices.bin',
      dataDir: 'espeak-ng-data',
    },
    isArchive: true,
    speakerId: 21,
    kokoroLang: 'fr',
  },
  'de': {
    type: 'kokoro',
    url: `${SHERPA_RELEASES}/tts-models/kokoro-multi-lang-v1_1.tar.bz2`,
    dirName: 'kokoro-multi-lang-v1_1',
    files: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
      voices: 'voices.bin',
      dataDir: 'espeak-ng-data',
    },
    isArchive: true,
    speakerId: 44,
    kokoroLang: 'de',
  },
  'es': {
    type: 'kokoro',
    url: `${SHERPA_RELEASES}/tts-models/kokoro-multi-lang-v1_1.tar.bz2`,
    dirName: 'kokoro-multi-lang-v1_1',
    files: {
      model: 'model.onnx',
      tokens: 'tokens.txt',
      voices: 'voices.bin',
      dataDir: 'espeak-ng-data',
    },
    isArchive: true,
    speakerId: 45,
    kokoroLang: 'es',
  },
};

const DEFAULT_TTS_MODEL = TTS_MODELS['en'];

// ============================================================================
// Public API
// ============================================================================

export function getSTTModel(language: string): STTModelConfig {
  return STT_MODELS[language] ?? DEFAULT_STT_MODEL;
}

export function getTTSModel(language: string): TTSModelConfig {
  return TTS_MODELS[language] ?? DEFAULT_TTS_MODEL;
}

/** All unique model URLs needed for a given language */
export function getRequiredModelURLs(language: string): string[] {
  const urls = new Set<string>();
  urls.add(VAD_MODEL.url);
  urls.add(getSTTModel(language).url);
  urls.add(getTTSModel(language).url);
  return [...urls];
}
