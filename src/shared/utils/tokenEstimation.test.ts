import { describe, it, expect } from 'vitest'
import { estimateTokens, estimateMessagesTokens } from '@shared/utils/tokenEstimation'
import type { LanguageData } from '@shared/types'

// ============================================================================
// estimateTokens
// ============================================================================

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('estimates ~25 tokens for ~100 ASCII characters', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25)
  })

  it('estimates ~20 tokens for ~30 CJK characters', () => {
    expect(estimateTokens('あ'.repeat(30))).toBe(20)
  })

  it('uses dense-script estimation for Bopomofo phonetic text', () => {
    expect(estimateTokens('ㄅ'.repeat(30))).toBe(20)
  })

  it('estimates 1 token for a single ASCII character', () => {
    expect(estimateTokens('a')).toBe(1)
  })

  it('estimates 1 token for a single CJK character', () => {
    expect(estimateTokens('字')).toBe(1)
  })

  it('returns appropriate blend for mixed ASCII and CJK', () => {
    expect(estimateTokens('abc世界')).toBe(3)
  })

  it('returns appropriate blend for ASCII with katakana', () => {
    expect(estimateTokens('helloアイウ')).toBe(4)
  })

  it('returns appropriate blend for ASCII with hangul', () => {
    expect(estimateTokens('test안녕')).toBe(3)
  })

  it('counts each surrogate-pair emoji as 2 tokens', () => {
    expect(estimateTokens('😀')).toBe(2)
  })

  it('counts multiple emoji correctly', () => {
    expect(estimateTokens('😀🎉🔥')).toBe(6)
  })

  it('counts emoji mixed with text correctly', () => {
    expect(estimateTokens('hi😀!')).toBe(3)
  })

  it('handles BMP-range emoji (Misc Symbols)', () => {
    expect(estimateTokens('☺')).toBe(2)
  })

  it('handles a large ASCII string proportionally', () => {
    expect(estimateTokens('b'.repeat(500))).toBe(125)
  })

  it('handles a large CJK string proportionally', () => {
    expect(estimateTokens('漢'.repeat(150))).toBe(100)
  })

  it('handles mixed CJK, ASCII, and emoji together', () => {
    expect(estimateTokens('hello世界😀🔥')).toBe(7)
  })

  it('uses language metadata to estimate compact text for package-defined scripts', () => {
    const languageData: LanguageData = {
      name: 'Georgian compact test',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Geor'] },
        wordIndexStrategy: {
          type: 'character-containment',
        },
      },
    }

    expect(estimateTokens('ა'.repeat(15), {
      language: 'ka',
      languageData,
    })).toBe(10)
  })

  it('uses explicit token-estimation scripts independently of word index strategy', () => {
    const languageData: LanguageData = {
      name: 'Compact Georgian prompt language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Geor'] },
        wordIndexStrategy: {
          type: 'whole-expression',
        },
        tokenEstimation: {
          compactScripts: ['Geor'],
        },
      },
    }

    expect(estimateTokens('ა'.repeat(15), {
      language: 'ka',
      languageData,
    })).toBe(10)
  })

  it('allows token-estimation metadata to opt out of character-containment density inference', () => {
    const languageData: LanguageData = {
      name: 'Character index but spaced prompt language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Geor'] },
        wordIndexStrategy: {
          type: 'character-containment',
        },
        tokenEstimation: {
          compactScripts: [],
        },
      },
    }

    expect(estimateTokens('ა'.repeat(15), {
      language: 'ka',
      languageData,
    })).toBe(8)
  })
})

// ============================================================================
// estimateMessagesTokens
// ============================================================================

describe('estimateMessagesTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0)
  })

  it('estimates tokens for a single message', () => {
    expect(estimateMessagesTokens([{ content: 'hello' }])).toBe(2)
  })

  it('sums tokens across multiple messages', () => {
    expect(estimateMessagesTokens([
      { content: 'hello' },
      { content: 'world' },
    ])).toBe(4)
  })

  it('handles messages with CJK content', () => {
    expect(estimateMessagesTokens([
      { content: 'こんにちは' },
      { content: '世界' },
    ])).toBe(6)
  })

  it('handles messages with mixed content types', () => {
    expect(estimateMessagesTokens([
      { content: 'hello world' },
      { content: '今日は' },
      { content: '😀' },
    ])).toBe(7)
  })

  it('handles empty content strings in messages', () => {
    expect(estimateMessagesTokens([
      { content: '' },
      { content: 'a' },
    ])).toBe(1)
  })

  it('handles a realistic chat message array', () => {
    const messages = [
      { content: 'You are a helpful assistant.' },
      { content: 'What is the capital of France?' },
      { content: 'The capital of France is Paris.' },
    ]
    expect(estimateMessagesTokens(messages)).toBe(23)
  })
})
