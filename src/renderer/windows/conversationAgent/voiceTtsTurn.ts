import { drainSpeakablePhrases } from './voicePhraseQueue';
import { stripBracketedTtsAnnotations } from '../../../shared/utils/textUtils';

export interface VoiceTtsPhraseRequest {
  phrase: string;
  phraseIndex: number;
}

export interface VoiceTtsTurnState {
  messageIndex: number;
  drainIndex: number;
  pendingPhrases: string[];
  requestActive: boolean;
  nextPhraseIndex: number;
  activePhraseIndex: number;
  sentenceTexts: string[];
}

export function createVoiceTtsTurnState(): VoiceTtsTurnState {
  return {
    messageIndex: -1,
    drainIndex: 0,
    pendingPhrases: [],
    requestActive: false,
    nextPhraseIndex: 0,
    activePhraseIndex: -1,
    sentenceTexts: [],
  };
}

export function resetVoiceTtsTurnState(state: VoiceTtsTurnState, messageIndex: number): void {
  state.messageIndex = messageIndex;
  state.drainIndex = 0;
  state.pendingPhrases = [];
  state.requestActive = false;
  state.nextPhraseIndex = 0;
  state.activePhraseIndex = -1;
  state.sentenceTexts = [];
}

export function enqueueVoiceTtsPhrasesForMessage(
  state: VoiceTtsTurnState,
  messageIndex: number,
  text: string,
  isStreaming: boolean,
): string[] {
  if (state.messageIndex !== messageIndex) {
    resetVoiceTtsTurnState(state, messageIndex);
  }

  const drained = drainSpeakablePhrases(text, state.drainIndex, !isStreaming);
  if (drained.phrases.length === 0) return [];

  state.drainIndex = drained.nextIndex;
  const speakable = drained.phrases
    .map((phrase) => stripBracketedTtsAnnotations(phrase))
    .filter(Boolean);
  state.pendingPhrases.push(...speakable);
  state.sentenceTexts.push(...speakable);
  return speakable;
}

export function takeNextVoiceTtsPhrase(state: VoiceTtsTurnState): VoiceTtsPhraseRequest | null {
  if (state.requestActive) return null;
  const phrase = state.pendingPhrases.shift();
  if (!phrase) return null;

  const phraseIndex = state.nextPhraseIndex++;
  state.requestActive = true;
  state.activePhraseIndex = phraseIndex;
  return { phrase, phraseIndex };
}

export function finishVoiceTtsPhraseRequest(state: VoiceTtsTurnState): void {
  state.requestActive = false;
  state.activePhraseIndex = -1;
}

export function abortVoiceTtsTurn(state: VoiceTtsTurnState): void {
  state.pendingPhrases = [];
  state.requestActive = false;
  state.activePhraseIndex = -1;
}
