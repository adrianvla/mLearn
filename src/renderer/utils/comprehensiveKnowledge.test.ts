import { describe, expect, it } from 'vitest';
import type { Flashcard, IgnoredWordEntry, PassiveWordKnowledge } from '../../shared/types';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';
import { getComprehensiveWordStatusWithSource } from './comprehensiveKnowledge';

function makeDeps(overrides: Partial<ComprehensiveKnowledgeDeps> = {}): ComprehensiveKnowledgeDeps {
  return {
    getCanonicalForm: (word) => word,
    hashWordSync: (word) => `hash:${word}`,
    langKey: (language, hash) => `${language}:${hash}`,
    language: 'ru',
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {},
    knownEaseThreshold: 1.8,
    learningThreshold: 1.55,
    getCardByWordSync: () => null,
    ankiStatus: null,
    sourceOrder: ['knownWordsList', 'ignoredWords', 'srs', 'anki', 'passiveTracking'],
    resolutionMode: 'highest',
    ...overrides,
  };
}

describe('getComprehensiveWordStatusWithSource', () => {
  it('uses language-provided word forms for manually known words', () => {
    const deps = makeDeps({
      getWordForms: () => ['идти', 'иду'],
      knownUntracked: {
        'ru:hash:идти': true,
      },
    });

    expect(getComprehensiveWordStatusWithSource('иду', deps)).toEqual({
      status: 'known',
      source: 'KnownWordsList',
      timesSeen: 0,
      matchedWord: 'идти',
      ease: 1.8,
    });
  });

  it('uses language-provided word forms for passive knowledge status', () => {
    const deps = makeDeps({
      getWordForms: () => ['كتب', 'يكتب'],
      wordKnowledge: {
        'ru:hash:كتب': { ease: 1.6, timesSeen: 7 } as PassiveWordKnowledge,
      },
    });

    expect(getComprehensiveWordStatusWithSource('يكتب', deps)).toEqual({
      status: 'learning',
      source: 'PassiveTracking',
      timesSeen: 7,
      matchedWord: 'كتب',
      ease: 1.6,
    });
  });

  it('reports Manual source for passive entries that were explicitly rated via the status pill', () => {
    const deps = makeDeps({
      wordKnowledge: {
        'ru:hash:слово': { ease: 1.9, timesSeen: 10, lastStatusChange: 5000 } as PassiveWordKnowledge,
      },
    });

    expect(getComprehensiveWordStatusWithSource('слово', deps)).toEqual({
      status: 'known',
      source: 'Manual',
      timesSeen: 10,
      matchedWord: 'слово',
      ease: 1.9,
    });
  });

  it('reports Manual source for passive entries that were rated in Word Sync', () => {
    const deps = makeDeps({
      wordKnowledge: {
        'ru:hash:слово': { ease: 1.9, timesSeen: 10, wordSyncRatedAt: 5000 } as PassiveWordKnowledge,
      },
    });

    expect(getComprehensiveWordStatusWithSource('слово', deps)).toEqual({
      status: 'known',
      source: 'Manual',
      timesSeen: 10,
      matchedWord: 'слово',
      ease: 1.9,
    });
  });

  it('keeps PassiveTracking source for entries whose ease grew without explicit rating', () => {
    const deps = makeDeps({
      wordKnowledge: {
        'ru:hash:слово': { ease: 1.9, timesSeen: 50 } as PassiveWordKnowledge,
      },
    });

    expect(getComprehensiveWordStatusWithSource('слово', deps)).toEqual({
      status: 'known',
      source: 'PassiveTracking',
      timesSeen: 50,
      matchedWord: 'слово',
      ease: 1.9,
    });
  });

  it('uses language-provided word forms for SRS card status', () => {
    const reviewCard = { state: 'review', ease: 2.6 } as Flashcard;
    const deps = makeDeps({
      getWordForms: () => ['食べる', '食べた'],
      getCardByWordSync: (word) => word === '食べる' ? reviewCard : null,
    });

    expect(getComprehensiveWordStatusWithSource('食べた', deps)).toEqual({
      status: 'known',
      source: 'Srs',
      timesSeen: 0,
      matchedWord: '食べる',
      ease: 2.6,
    });
  });

  it('keeps the canonical-plus-original fallback for older callers', () => {
    const deps = makeDeps({
      getCanonicalForm: (word) => word === 'おしいれ' ? '押し入れ' : word,
      ignoredWords: {
        'ru:hash:押し入れ': {} as IgnoredWordEntry,
      },
    });

    expect(getComprehensiveWordStatusWithSource('おしいれ', deps)).toEqual({
      status: 'known',
      source: 'IgnoredWords',
      timesSeen: 0,
      matchedWord: '押し入れ',
      ease: 1.8,
    });
  });

  it('reports the matched canonical form for reading aliases', () => {
    const deps = makeDeps({
      language: 'ja',
      getWordForms: () => ['れんぞく', '連続'],
      knownUntracked: {
        'ja:hash:連続': true,
      },
    });

    expect(getComprehensiveWordStatusWithSource('れんぞく', deps)).toEqual({
      status: 'known',
      source: 'KnownWordsList',
      timesSeen: 0,
      matchedWord: '連続',
      ease: 1.8,
    });
  });
});
