import { describe, expect, it } from 'vitest';
import { flashcardAudioResourceKey } from './flashcardAudioResource';

describe('flashcardAudioResourceKey', () => {
  it('is stable for an exact audio identity and changes with content or provider settings', () => {
    const identity = { language: 'lang-x', textHash: 'a'.repeat(64), provider: 'local-a', preset: 'fast', voiceSampleId: 'voice-a' };
    expect(flashcardAudioResourceKey(identity)).toBe(flashcardAudioResourceKey({ ...identity }));
    expect(flashcardAudioResourceKey({ ...identity, textHash: 'b'.repeat(64) })).not.toBe(flashcardAudioResourceKey(identity));
    expect(flashcardAudioResourceKey({ ...identity, language: 'lang-y' })).not.toBe(flashcardAudioResourceKey(identity));
    expect(flashcardAudioResourceKey({ ...identity, provider: 'local-b' })).not.toBe(flashcardAudioResourceKey(identity));
    expect(flashcardAudioResourceKey({ ...identity, voiceSampleId: 'voice-b' })).not.toBe(flashcardAudioResourceKey(identity));
  });
});
