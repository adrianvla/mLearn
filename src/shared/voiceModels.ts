/**
 * Voice model metadata for the Python-backed voice pipeline.
 *
 * STT: faster-whisper (whisper-small) — downloaded by HuggingFace cache on first use.
 * TTS: Kokoro-82M (local) or MOSS-TTS-Realtime (remote GPU server).
 * VAD: Silero VAD — loaded via torch.hub on first use.
 *
 * All models are managed by the Python backend; this file only exports
 * display metadata for the UI (model names, language support, etc.).
 */

// ============================================================================
// Supported language codes for Kokoro TTS
// ============================================================================

/**
 * Languages supported by Kokoro-82M TTS.
 * Mapping from app language code → Kokoro lang_code.
 */
export const KOKORO_LANGUAGES: Record<string, string> = {
  en: 'a',   // American English
  ja: 'j',   // Japanese
  zh: 'z',   // Chinese (Mandarin)
  ko: 'j',   // Korean (uses Japanese phonemizer)
  fr: 'f',   // French
  es: 'e',   // Spanish
  pt: 'p',   // Portuguese (Brazilian)
  hi: 'h',   // Hindi
  it: 'i',   // Italian
};

// ============================================================================
// Supported language codes for Qwen3-TTS
// ============================================================================

/**
 * Languages supported by Qwen3-TTS-1.7B.
 * Mapping from app language code → Qwen3 language code.
 */
export const QWEN3_TTS_LANGUAGES: Record<string, string> = {
  zh: 'zh',
  en: 'en',
  ja: 'ja',
  ko: 'ko',
  de: 'de',
  fr: 'fr',
  ru: 'ru',
  pt: 'pt',
  es: 'es',
  it: 'it',
};

/** Check if a language is supported by the selected local TTS engine */
export function isTTSLanguageSupported(language: string, provider: 'kokoro' | 'qwen3' = 'kokoro'): boolean {
  if (provider === 'qwen3') return language in QWEN3_TTS_LANGUAGES;
  return language in KOKORO_LANGUAGES;
}

/** Get the Kokoro language code for a given app language code */
export function getKokoroLanguageCode(language: string): string {
  return KOKORO_LANGUAGES[language] ?? 'a';
}

/** Get the Qwen3-TTS language code for a given app language code */
export function getQwen3LanguageCode(language: string): string {
  return QWEN3_TTS_LANGUAGES[language] ?? 'en';
}
