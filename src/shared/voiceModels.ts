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

/** Check if a language is supported by the local TTS engine */
export function isTTSLanguageSupported(language: string): boolean {
  return language in KOKORO_LANGUAGES;
}

/** Get the Kokoro language code for a given app language code */
export function getKokoroLanguageCode(language: string): string {
  return KOKORO_LANGUAGES[language] ?? 'a';
}
