/**
 * Voice model metadata for the Python-backed voice pipeline.
 *
 * STT: faster-whisper (whisper-small) — downloaded by HuggingFace cache on first use.
 * TTS: Chatterbox-Multilingual — downloaded by HuggingFace cache on first use.
 * VAD: Silero VAD — loaded via torch.hub on first use.
 *
 * All models are managed by the Python backend; this file only exports
 * display metadata for the UI (model names, language support, etc.).
 */

// ============================================================================
// Supported language codes for Chatterbox TTS
// ============================================================================

/**
 * Languages supported by Chatterbox-Multilingual TTS.
 * Mapping from app language code → Chatterbox language_id.
 */
export const CHATTERBOX_LANGUAGES: Record<string, string> = {
  en: 'en',
  zh: 'zh',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  pt: 'pt',
  it: 'it',
  ru: 'ru',
  ar: 'ar',
  hi: 'hi',
  nl: 'nl',
  pl: 'pl',
  sv: 'sv',
  tr: 'tr',
  vi: 'vi',
  th: 'th',
  id: 'id',
  cs: 'cs',
  uk: 'uk',
  ro: 'ro',
  hu: 'hu',
};

/** Check if a language is supported by Chatterbox TTS */
export function isTTSLanguageSupported(language: string): boolean {
  return language in CHATTERBOX_LANGUAGES;
}

/** Get the Chatterbox language ID for a given app language code */
export function getChatterboxLanguageId(language: string): string {
  return CHATTERBOX_LANGUAGES[language] ?? 'en';
}
