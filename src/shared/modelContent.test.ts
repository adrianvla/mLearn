import { describe, expect, it } from 'vitest';
import { sanitizeJournalMessageText, sanitizeModelSpeech } from './modelContent';

describe('sanitizeModelSpeech', () => {
  it('keeps plain speech untouched', () => {
    const speech = 'もちろん！一緒に考えましょう。まずは作業をリストアップしましょう。';
    expect(sanitizeModelSpeech(speech)).toBe(speech);
  });

  it('keeps ordinary sentences containing the word thinking', () => {
    const speech = "I was thinking we could split the work fairly. What do you think?";
    expect(sanitizeModelSpeech(speech)).toBe(speech);
  });

  it('strips the V05 reasoning-label leak and keeps resumed speech', () => {
    const leaked = 'もちろんです！一緒に考えましょう。'
      + '\n\n[thinking] The user is repeating the initial request. I should reiterate the list approach.'
      + '<channel|>そうですね。公平に分けるには、まず作業を書き出しましょう。';
    expect(sanitizeModelSpeech(leaked)).toBe(
      'もちろんです！一緒に考えましょう。\n\nそうですね。公平に分けるには、まず作業を書き出しましょう。',
    );
  });

  it('drops an unterminated reasoning label to the end', () => {
    const leaked = 'Previous speech. [Thinking] reasoning that never closes and must not display.';
    expect(sanitizeModelSpeech(leaked)).toBe('Previous speech.');
  });

  it('drops complete think-tag regions and surrounding reasoning-only output', () => {
    expect(sanitizeModelSpeech('<think>hidden plan</think>Visible answer.')).toBe('Visible answer.');
    expect(sanitizeModelSpeech('<think>only reasoning</think>')).toBe('');
  });

  it('drops an unterminated think region', () => {
    expect(sanitizeModelSpeech('Answer first. <think>cut off')).toBe('Answer first.');
  });

  it('deletes stray closing and channel tokens inside speech', () => {
    expect(sanitizeModelSpeech('Hello <|channel|> there <channel|> friend')).toBe('Hello  there  friend');
    expect(sanitizeModelSpeech('A </think> B')).toBe('A  B');
  });

  it('handles uppercase variants of the reasoning label', () => {
    expect(sanitizeModelSpeech('[THINKING] hidden <CHANNEL|> visible')).toBe('visible');
  });

  it('is idempotent', () => {
    const leaked = '[thinking] plan <channel|> speech';
    expect(sanitizeModelSpeech(sanitizeModelSpeech(leaked))).toBe(sanitizeModelSpeech(leaked));
  });

  describe('streaming', () => {
    it('withholds an open reasoning region until it closes', () => {
      expect(sanitizeModelSpeech('Speech. <think>hid', true)).toBe('Speech.');
      expect(sanitizeModelSpeech('Speech. <think>hidden</think> more speech', true)).toBe('Speech.  more speech');
    });

    it('withholds reasoning after a label until a channel marker resumes speech', () => {
      expect(sanitizeModelSpeech('Speech. [thinking] pl', true)).toBe('Speech.');
      expect(sanitizeModelSpeech('Speech. [thinking] plan <channel|> ans', true)).toBe('Speech.  ans');
    });

    it('withholds a trailing partial marker', () => {
      expect(sanitizeModelSpeech('Hello <thi', true)).toBe('Hello');
      expect(sanitizeModelSpeech('Hello [Thi', true)).toBe('Hello');
      expect(sanitizeModelSpeech('Hello <chan', true)).toBe('Hello');
      // Not a marker prefix: emitted.
      expect(sanitizeModelSpeech('2 + 2 < 5', true)).toBe('2 + 2 < 5');
    });

    it('emits held text once the next chunk disambiguates it', () => {
      expect(sanitizeModelSpeech('2 + 2 <', true)).toBe('2 + 2');
      expect(sanitizeModelSpeech('2 + 2 < 5', true)).toBe('2 + 2 < 5');
    });
  });
});

describe('sanitizeJournalMessageText', () => {
  it('sanitizes persisted character rows', () => {
    expect(sanitizeJournalMessageText('message.character', '[thinking] plan <channel|> speech')).toBe('speech');
  });

  it('never rewrites user rows', () => {
    const user = '[thinking] literally my words <channel|>';
    expect(sanitizeJournalMessageText('message.user', user)).toBe(user);
  });
});
