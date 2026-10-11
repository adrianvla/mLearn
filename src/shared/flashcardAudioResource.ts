import { hashWordSync } from './utils/wordHash';

/** Identity of generated audio as material, never as learner evidence. */
export interface FlashcardAudioResourceIdentity {
  language: string;
  textHash: string;
  provider: string;
  preset: string;
  voiceSampleId?: string;
}

/** Content/configuration identity prevents another reading or voice from being reused. */
export function flashcardAudioResourceKey(identity: FlashcardAudioResourceIdentity): string {
  return hashWordSync(JSON.stringify({ protocol: 'flashcard-audio-resource@1', ...identity,
    voiceSampleId: identity.voiceSampleId ?? null }));
}
