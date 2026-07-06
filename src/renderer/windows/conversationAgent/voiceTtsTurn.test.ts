import { describe, expect, it } from 'vitest';
import {
  abortVoiceTtsTurn,
  createVoiceTtsTurnState,
  enqueueVoiceTtsPhrasesForMessage,
  finishVoiceTtsPhraseRequest,
  resetVoiceTtsTurnState,
  takeNextVoiceTtsPhrase,
} from './voiceTtsTurn';

describe('voice TTS turn phrase orchestration', () => {
  it('queues speakable phrases incrementally without repeating streamed text', () => {
    const state = createVoiceTtsTurnState();

    expect(enqueueVoiceTtsPhrasesForMessage(state, 0, 'Hello there. How', true)).toEqual([
      'Hello there.',
    ]);
    expect(state.drainIndex).toBe(13);
    expect(state.pendingPhrases).toEqual(['Hello there.']);

    expect(enqueueVoiceTtsPhrasesForMessage(state, 0, 'Hello there. How are you?', true)).toEqual([
      'How are you?',
    ]);
    expect(state.pendingPhrases).toEqual(['Hello there.', 'How are you?']);
    expect(state.sentenceTexts).toEqual(['Hello there.', 'How are you?']);
  });

  it('flushes the final tail when LLM streaming finishes', () => {
    const state = createVoiceTtsTurnState();

    enqueueVoiceTtsPhrasesForMessage(state, 0, 'Hello there. Final tail', true);
    expect(state.pendingPhrases).toEqual(['Hello there.']);

    expect(enqueueVoiceTtsPhrasesForMessage(state, 0, 'Hello there. Final tail', false)).toEqual([
      'Final tail',
    ]);
    expect(state.pendingPhrases).toEqual(['Hello there.', 'Final tail']);
  });

  it('serializes local TTS phrase requests until the active request finishes', () => {
    const state = createVoiceTtsTurnState();
    enqueueVoiceTtsPhrasesForMessage(state, 0, 'One. Two.', false);

    expect(takeNextVoiceTtsPhrase(state)).toEqual({ phrase: 'One.', phraseIndex: 0 });
    expect(takeNextVoiceTtsPhrase(state)).toBeNull();
    expect(state.pendingPhrases).toEqual(['Two.']);

    finishVoiceTtsPhraseRequest(state);

    expect(takeNextVoiceTtsPhrase(state)).toEqual({ phrase: 'Two.', phraseIndex: 1 });
    expect(state.pendingPhrases).toEqual([]);
  });

  it('resets per assistant message and abort clears only pending/request state', () => {
    const state = createVoiceTtsTurnState();
    enqueueVoiceTtsPhrasesForMessage(state, 0, 'Old message.', false);
    expect(takeNextVoiceTtsPhrase(state)).toEqual({ phrase: 'Old message.', phraseIndex: 0 });

    resetVoiceTtsTurnState(state, 1);
    expect(state).toMatchObject({
      messageIndex: 1,
      drainIndex: 0,
      pendingPhrases: [],
      requestActive: false,
      nextPhraseIndex: 0,
      activePhraseIndex: -1,
      sentenceTexts: [],
    });

    enqueueVoiceTtsPhrasesForMessage(state, 1, 'New one. New two.', false);
    expect(takeNextVoiceTtsPhrase(state)).toEqual({ phrase: 'New one.', phraseIndex: 0 });
    abortVoiceTtsTurn(state);

    expect(state.pendingPhrases).toEqual([]);
    expect(state.requestActive).toBe(false);
    expect(state.activePhraseIndex).toBe(-1);
    expect(state.sentenceTexts).toEqual(['New one.', 'New two.']);
  });
});
