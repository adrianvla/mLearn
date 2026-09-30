import type { FlashcardAudioPreset, TTSProvider } from '../types';

/** Fast reuses the local voice-call engine; high quality keeps the chosen provider. */
export function flashcardAudioProvider(preset: FlashcardAudioPreset, provider: TTSProvider): TTSProvider {
  return preset === 'fast' ? 'qwen3' : provider;
}
