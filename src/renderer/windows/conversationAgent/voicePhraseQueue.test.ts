import { describe, expect, it } from 'vitest';
import { drainSpeakablePhrases } from './voicePhraseQueue';

describe('drainSpeakablePhrases', () => {
  it('drains only complete phrases and leaves the trailing partial text', () => {
    expect(drainSpeakablePhrases('Hello there. How are', 0)).toEqual({
      phrases: ['Hello there.'],
      nextIndex: 13,
    });
  });

  it('continues from the previous drain index without repeating spoken text', () => {
    expect(drainSpeakablePhrases('Hello there. How are you?', 13)).toEqual({
      phrases: ['How are you?'],
      nextIndex: 25,
    });
  });

  it('supports common non-latin sentence punctuation', () => {
    expect(drainSpeakablePhrases('こんにちは。元気？ هنوز هستم', 0)).toEqual({
      phrases: ['こんにちは。', '元気？'],
      nextIndex: 10,
    });
  });

  it('flushes the final tail when forced at stream completion', () => {
    expect(drainSpeakablePhrases('Hello there. Final tail', 13, true)).toEqual({
      phrases: ['Final tail'],
      nextIndex: 23,
    });
  });
});
