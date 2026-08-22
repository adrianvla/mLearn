import { describe, expect, it } from 'vitest';
import type { Flashcard, IgnoredWordEntry, PassiveWordKnowledge } from '../../shared/types';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';
import { getComprehensiveWordStatusWithSource, toSelectionBlockingStatus } from './comprehensiveKnowledge';

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

  it('passive-only ease growth caps at learning with PassiveTracking source', () => {
    // No lastStatusChange: pure exposure above the known threshold — familiarity
    // alone must not establish Known (Q1b). The PassiveTracking source attribution
    // stays honest either way.
    const deps = makeDeps({
      wordKnowledge: {
        'ru:hash:слово': { ease: 1.9, timesSeen: 50 } as PassiveWordKnowledge,
      },
    });

    expect(getComprehensiveWordStatusWithSource('слово', deps)).toEqual({
      status: 'learning',
      source: 'PassiveTracking',
      timesSeen: 50,
      matchedWord: 'слово',
      ease: 1.9,
    });

    // The same ease with an explicit rating marker reads as known under Manual.
    const rated = makeDeps({
      wordKnowledge: {
        'ru:hash:слово': { ease: 1.9, timesSeen: 50, lastStatusChange: 123 } as PassiveWordKnowledge,
      },
    });
    expect(getComprehensiveWordStatusWithSource('слово', rated).status).toBe('known');
    expect(getComprehensiveWordStatusWithSource('слово', rated).source).toBe('Manual');
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

    // Exclusion is teaching policy, not knowledge: honest unknown + excluded flag.
    expect(getComprehensiveWordStatusWithSource('おしいれ', deps)).toEqual({
      status: 'unknown',
      source: 'IgnoredWords',
      timesSeen: 0,
      matchedWord: '押し入れ',
      excluded: true,
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

describe('exclusion vs knowledge (Tier-2 semantics)', () => {
  it('ignored words resolve honestly: unknown status + excluded flag, never known', () => {
    const deps = makeDeps({
      ignoredWords: { 'ru:hash:слово': {} as IgnoredWordEntry },
    });

    expect(getComprehensiveWordStatusWithSource('слово', deps)).toEqual({
      status: 'unknown',
      source: 'IgnoredWords',
      timesSeen: 0,
      matchedWord: 'слово',
      excluded: true,
    });
  });

  it('evidence outranks exclusion under highest resolution', () => {
    const card = { id: 'c1', state: 'review', ease: 2.5 } as unknown as Flashcard;
    const deps = makeDeps({
      ignoredWords: { 'ru:hash:слово': {} as IgnoredWordEntry },
      getCardByWordSync: (word) => (word === 'слово' ? card : null),
    });

    const resolved = getComprehensiveWordStatusWithSource('слово', deps);
    expect(resolved.status).toBe('known');
    expect(resolved.source).toBe('Srs');
    expect(resolved.excluded).toBeUndefined();
  });

  it('explicit user claims (knownUntracked) stay a distinct evidence-backed source', () => {
    const deps = makeDeps({
      knownUntracked: { 'ru:hash:слово': true },
      ignoredWords: {},
    });

    expect(getComprehensiveWordStatusWithSource('слово', deps)).toMatchObject({
      status: 'known',
      source: 'KnownWordsList',
    });
  });
});

describe('toSelectionBlockingStatus', () => {
  it('blocks suggestions on passive familiarity at/above the known band without claiming knowledge', () => {
    const resolved = getComprehensiveWordStatusWithSource('слово', makeDeps({
      wordKnowledge: { 'ru:hash:слово': { ease: 2.0, timesSeen: 50 } as PassiveWordKnowledge },
    }));
    expect(resolved.status).toBe('learning');
    expect(toSelectionBlockingStatus(resolved, 1.8)).toBe('known');
  });

  it('leaves genuine statuses untouched', () => {
    const deps = makeDeps();
    expect(toSelectionBlockingStatus(getComprehensiveWordStatusWithSource('x', deps), 1.8)).toBe('unknown');
    const learning = getComprehensiveWordStatusWithSource('слово', makeDeps({
      wordKnowledge: { 'ru:hash:слово': { ease: 1.6, timesSeen: 3 } as PassiveWordKnowledge },
    }));
    expect(toSelectionBlockingStatus(learning, 1.8)).toBe('learning');
  });
});
