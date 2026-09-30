import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../types';
import { flashcardAudioProvider } from './flashcardAudioPreset';

describe('flashcard audio presets', () => {
  it('defaults creation to high quality and regeneration to fast', () => {
    expect(DEFAULT_SETTINGS.flashcardCreationAudioPreset).toBe('high-quality');
    expect(DEFAULT_SETTINGS.flashcardRegenerationAudioPreset).toBe('fast');
  });
  it.each(['kokoro', 'qwen3', 'cloud'] as const)('preserves %s for high quality and uses the local call engine for fast', (provider) => {
    expect(flashcardAudioProvider('high-quality', provider)).toBe(provider);
    expect(flashcardAudioProvider('fast', provider)).toBe('qwen3');
  });
});
