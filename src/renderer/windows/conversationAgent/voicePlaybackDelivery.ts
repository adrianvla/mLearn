import type { VoiceDeliveryPayload } from '../../../shared/world';

interface PlaybackChunk { startAt: number; duration: number; ended: boolean }
interface PlaybackPhrase { text: string; chunks: PlaybackChunk[]; generationComplete: boolean; systemComplete: boolean }

/** Audio scheduling is not playback. Only ended sources or system completion confirm a phrase. */
export class VoicePlaybackDelivery {
  private readonly phrases: PlaybackPhrase[];

  constructor(texts: readonly string[]) {
    this.phrases = texts.map(text => ({ text, chunks: [], generationComplete: false, systemComplete: false }));
  }

  schedule(phraseIndex: number, startAt: number, duration: number): () => void {
    const phrase = this.phrases[phraseIndex];
    const chunk: PlaybackChunk = { startAt, duration, ended: false };
    phrase?.chunks.push(chunk);
    return () => { chunk.ended = true; };
  }

  finishGeneration(phraseIndex: number, systemComplete: boolean): void {
    const phrase = this.phrases[phraseIndex];
    if (!phrase) return;
    phrase.generationComplete = true;
    phrase.systemComplete = systemComplete;
  }

  snapshot(currentTime: number): Pick<VoiceDeliveryPayload, 'spokenText' | 'confirmedText' | 'basis'> & { complete: boolean } {
    const confirmed: string[] = [];
    let partial = '';
    let system = false;
    for (const phrase of this.phrases) {
      const completed = phrase.generationComplete && (phrase.systemComplete
        || (phrase.chunks.length > 0 && phrase.chunks.every(chunk => chunk.ended)));
      if (completed) {
        confirmed.push(phrase.text);
        system ||= phrase.systemComplete;
        continue;
      }
      // Incomplete generation has no known total phrase duration. Never invent a word offset.
      if (phrase.generationComplete && phrase.chunks.length > 0) {
        const duration = phrase.chunks.reduce((total, chunk) => total + chunk.duration, 0);
        const elapsed = phrase.chunks.reduce((total, chunk) => total + (chunk.ended ? chunk.duration
          : Math.min(chunk.duration, Math.max(0, currentTime - chunk.startAt))), 0);
        const chars = Array.from(phrase.text);
        const count = duration > 0 ? Math.min(chars.length - 1, Math.floor(chars.length * elapsed / duration)) : 0;
        partial = chars.slice(0, Math.max(0, count)).join('');
      }
      break;
    }
    const confirmedText = confirmed.join(' ');
    return { confirmedText, spokenText: [...confirmed, partial].filter(Boolean).join(' '),
      basis: partial ? 'playback-estimate' : confirmedText ? system ? 'system-complete' : 'playback-complete' : 'unavailable',
      complete: confirmed.length === this.phrases.length && this.phrases.length > 0 };
  }
}
