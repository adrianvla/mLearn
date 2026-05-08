import { describe, expect, it, vi } from 'vitest';

import {
  getInitialState,
  processComputerTurn,
  validateUserWord,
  getLastKana,
  getFirstKana,
  endsWithN,
  normalizeForComparison,
  katakanaToHiragana,
  isKana,
  getComputerWord,
  type HostApi,
} from './game';

function createHost(overrides: Partial<HostApi> = {}): HostApi {
  return {
    kvGet: vi.fn(async (_key: string) => null),
    kvSet: vi.fn(async (_key: string, _value: string) => {}),
    closeWindow: vi.fn(() => {}),
    translate: vi.fn(async (_word: string) => ({ data: [] })),
    ...overrides,
  };
}

describe('shiritori game logic', () => {
  describe('getLastKana', () => {
    it('returns the last hiragana character', () => {
      expect(getLastKana('ねこ')).toBe('こ');
      expect(getLastKana('いぬ')).toBe('ぬ');
      expect(getLastKana('さかな')).toBe('な');
    });

    it('handles small kana correctly', () => {
      expect(getLastKana('きょうと')).toBe('と');
      expect(getLastKana('しょうがっこう')).toBe('う');
    });

    it('handles prolonged sound marks', () => {
      expect(getLastKana('テレビ')).toBe('び');
      expect(getLastKana('コンピューター')).toBe('た');
    });

    it('converts katakana to hiragana', () => {
      expect(getLastKana('カタカナ')).toBe('な');
      expect(getLastKana('アメリカ')).toBe('か');
    });

    it('returns null for empty strings', () => {
      expect(getLastKana('')).toBeNull();
      expect(getLastKana('   ')).toBeNull();
    });
  });

  describe('getFirstKana', () => {
    it('returns the first hiragana character', () => {
      expect(getFirstKana('ねこ')).toBe('ね');
      expect(getFirstKana('いぬ')).toBe('い');
    });

    it('handles small kana at the start', () => {
      expect(getFirstKana('きょうと')).toBe('きょ');
    });

    it('converts katakana to hiragana', () => {
      expect(getFirstKana('カタカナ')).toBe('か');
    });

    it('returns null for non-kana strings', () => {
      expect(getFirstKana('hello')).toBeNull();
      expect(getFirstKana('123')).toBeNull();
    });
  });

  describe('endsWithN', () => {
    it('returns true for words ending in ん', () => {
      expect(endsWithN('ほん')).toBe(true);
      expect(endsWithN('えん')).toBe(true);
      expect(endsWithN('りん')).toBe(true);
    });

    it('returns false for words not ending in ん', () => {
      expect(endsWithN('ねこ')).toBe(false);
      expect(endsWithN('いぬ')).toBe(false);
      expect(endsWithN('さかな')).toBe(false);
    });

    it('handles katakana', () => {
      expect(endsWithN('パソコン')).toBe(true);
      expect(endsWithN('テレビ')).toBe(false);
    });
  });

  describe('normalizeForComparison', () => {
    it('converts katakana to hiragana', () => {
      expect(normalizeForComparison('カタカナ')).toBe('かたかな');
    });

    it('removes spaces and prolonged sound marks', () => {
      expect(normalizeForComparison('コンピューター')).toBe('こんぴゅた');
    });
  });

  describe('katakanaToHiragana', () => {
    it('converts katakana to hiragana', () => {
      expect(katakanaToHiragana('アイウエオ')).toBe('あいうえお');
      expect(katakanaToHiragana('カキクケコ')).toBe('かきくけこ');
    });

    it('leaves hiragana unchanged', () => {
      expect(katakanaToHiragana('あいうえお')).toBe('あいうえお');
    });
  });

  describe('isKana', () => {
    it('returns true for hiragana', () => {
      expect(isKana('あ')).toBe(true);
      expect(isKana('ん')).toBe(true);
    });

    it('returns true for katakana', () => {
      expect(isKana('ア')).toBe(true);
      expect(isKana('ン')).toBe(true);
    });

    it('returns false for non-kana', () => {
      expect(isKana('a')).toBe(false);
      expect(isKana('1')).toBe(false);
    });
  });

  describe('getComputerWord', () => {
    it('returns a word starting with the required kana', () => {
      const result = getComputerWord('か', new Set());
      expect(result).not.toBeNull();
      expect(getFirstKana(result!.reading)).toBe('か');
    });

    it('does not return words ending in ん', () => {
      const result = getComputerWord('で', new Set());
      if (result) {
        expect(endsWithN(result.reading)).toBe(false);
      }
    });

    it('does not return already used words', () => {
      const usedWords = new Set(['かさ']);
      const result = getComputerWord('か', usedWords);
      if (result) {
        expect(normalizeForComparison(result.word)).not.toBe('かさ');
      }
    });

    it('returns null when no candidates exist', () => {
      const result = getComputerWord('ゑ', new Set());
      expect(result).toBeNull();
    });
  });

  describe('validateUserWord', () => {
    it('rejects empty words', async () => {
      const host = createHost();
      const result = await validateUserWord('', host, new Set(), null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Please enter a word.');
    });

    it('rejects duplicate words', async () => {
      const host = createHost();
      const usedWords = new Set(['ねこ']);
      const result = await validateUserWord('ねこ', host, usedWords, null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('You cannot use a word twice.');
    });

    it('rejects words not in dictionary', async () => {
      const host = createHost({
        translate: vi.fn(async () => ({ data: [] })),
      });
      const result = await validateUserWord('ぴよぴよ', host, new Set(), null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('That word was not found in the dictionary.');
    });

    it('rejects words with wrong starting kana', async () => {
      const host = createHost({
        translate: vi.fn(async () => ({
          data: [{ reading: 'ねこ', definitions: 'cat' }],
        })),
      });
      const result = await validateUserWord('ねこ', host, new Set(), 'か');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('か');
    });

    it('accepts valid words', async () => {
      const host = createHost({
        translate: vi.fn(async () => ({
          data: [{ reading: 'ねこ', definitions: 'cat' }],
        })),
      });
      const result = await validateUserWord('ねこ', host, new Set(), null);
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('rejects words ending in ん with special message', async () => {
      const host = createHost({
        translate: vi.fn(async () => ({
          data: [{ reading: 'ほん', definitions: 'book' }],
        })),
      });
      const result = await validateUserWord('本', host, new Set(), null);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Word ends in ん — you lose!');
    });
  });

  describe('processComputerTurn', () => {
    it('ends game when computer cannot find a word', async () => {
      const state = {
        ...getInitialState(),
        words: [{ word: 'かぜ', reading: 'かぜ', player: 'user' as const }],
        currentPlayer: 'computer' as const,
        lastKana: 'ぜ',
        gameOver: false,
      };

      const result = await processComputerTurn(state);
      expect(result.gameOver).toBe(true);
      expect(result.winner).toBe('user');
    });

    it('adds computer word and switches to user', async () => {
      const state = {
        ...getInitialState(),
        words: [],
        currentPlayer: 'computer' as const,
        lastKana: 'か',
        gameOver: false,
      };

      const result = await processComputerTurn(state);
      expect(result.words.length).toBe(1);
      expect(result.words[0].player).toBe('computer');
      expect(result.currentPlayer).toBe('user');
      expect(result.gameOver).toBe(false);
    });
  });

  describe('getInitialState', () => {
    it('returns a fresh game state', () => {
      const state = getInitialState();
      expect(state.words).toEqual([]);
      expect(state.currentPlayer).toBe('user');
      expect(state.gameOver).toBe(false);
      expect(state.winner).toBeNull();
      expect(state.lastKana).toBeNull();
      expect(state.errorMessage).toBeNull();
      expect(state.computerThinking).toBe(false);
    });
  });
});
