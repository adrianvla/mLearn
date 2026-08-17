import { describe, expect, it } from 'vitest';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';
import {
  applyAspectWrite,
  applyMeaningCascade,
  aspectSourceToDisplay,
  effectiveStatusFromStrength,
  getAspectStatusSync,
  getEffectiveKnowledge,
} from './aspectKnowledge';
import type { Flashcard, PassiveWordKnowledge } from '../../shared/types';
import type { WordStatus } from '../../shared/constants';

const langKey = (language: string, hash: string) => `${language}:${hash}`;
const hashWordSync = (word: string) => `h(${word})`;

function makeDeps(overrides: Partial<ComprehensiveKnowledgeDeps> = {}): ComprehensiveKnowledgeDeps {
  return {
    getCanonicalForm: (w) => w,
    getWordForms: (w) => [w],
    hashWordSync,
    langKey,
    language: 'ja',
    knownUntracked: {},
    ignoredWords: {},
    wordKnowledge: {},
    knownEaseThreshold: 1.8,
    learningThreshold: 1.55,
    getCardByWordSync: () => null as Flashcard | null,
    ankiStatus: null,
    sourceOrder: ['knownWordsList', 'ignoredWords', 'srs', 'anki', 'passiveTracking'],
    resolutionMode: 'order',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<PassiveWordKnowledge> = {}): PassiveWordKnowledge {
  return {
    ease: 1.3,
    lastSeen: 0,
    timesSeen: 0,
    timesHovered: 0,
    word: 'word',
    ...overrides,
  };
}

const easeFor = (status: WordStatus) => (status === 'known' ? 1.8 : status === 'learning' ? 1.55 : 1.3);
const ALL = ['meaning', 'reading', 'prosody'] as const;

describe('getAspectStatusSync', () => {
  it('meaning delegates to comprehensive resolution (passive tracking known)', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const deps = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42 }) },
    });
    const result = getAspectStatusSync('猫', 'meaning', deps);
    expect(result.status).toBe('known');
    expect(result.inherited).toBe(false);
  });

  it('reading falls back to resolved meaning with inherited semantics when absent', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const deps = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42 }) },
    });
    const result = getAspectStatusSync('猫', 'reading', deps);
    expect(result.status).toBe('known');
    expect(result.inherited).toBe(true);
  });

  it('reads a persisted aspect record instead of falling back', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const entry = makeEntry({ ease: 2.0 });
    entry.aspects = {
      reading: { status: 'learning', ease: 1.55, source: 'Manual', lastStatusChange: 5, updatedAt: 5 },
    };
    const deps = makeDeps({ wordKnowledge: { [lk]: entry } });
    const result = getAspectStatusSync('猫', 'reading', deps);
    expect(result.status).toBe('learning');
    expect(result.inherited).toBe(false);
    expect(result.source).toBe('Manual');
  });

  it('unifies across surface-form hashes, returning the best aspect record', () => {
    const forms = ['さすが', '流石'];
    const lkA = langKey('ja', hashWordSync('さすが'));
    const lkB = langKey('ja', hashWordSync('流石'));
    const entryB = makeEntry({ ease: 1.4 });
    entryB.aspects = {
      prosody: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 3, updatedAt: 3 },
    };
    const deps = makeDeps({
      getWordForms: () => forms,
      wordKnowledge: {
        [lkA]: makeEntry({ ease: 1.4 }),
        [lkB]: entryB,
      },
    });
    const result = getAspectStatusSync('さすが', 'prosody', deps);
    expect(result.status).toBe('known');
  });

  it('returns unknown inherited when nothing is known anywhere', () => {
    const deps = makeDeps();
    const result = getAspectStatusSync('猫', 'prosody', deps);
    expect(result.status).toBe('unknown');
    expect(result.inherited).toBe(true);
  });
});

describe('getEffectiveKnowledge', () => {
  it('other profile reduces to meaning status', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const deps = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 5 }) },
    });
    const result = getEffectiveKnowledge('猫', 'other', deps, ['meaning', 'reading', 'prosody']);
    expect(result.strength).toBe(1);
    expect(result.status).toBe('known');
  });

  it('video profile blends aspect strengths over available aspects', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const entry = makeEntry({ ease: 2.0, timesSeen: 5 });
    entry.aspects = {
      reading: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    const deps = makeDeps({ wordKnowledge: { [lk]: entry } });
    const result = getEffectiveKnowledge('猫', 'video', deps, ['meaning', 'reading', 'prosody']);
    // meaning strength 1 (status anchor), reading/prosody ease 1.3 → normalized 0
    expect(result.strength).toBeCloseTo(0.5 / 1.0, 5);
    expect(result.status).toBe('learning');
  });

  it('excludes unavailable aspects from the denominator', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const entry = makeEntry({ ease: 2.0, timesSeen: 5 });
    entry.aspects = {
      reading: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    const deps = makeDeps({ wordKnowledge: { [lk]: entry } });
    const withAll = getEffectiveKnowledge('猫', 'video', deps, ['meaning', 'reading', 'prosody']);
    const meaningOnly = getEffectiveKnowledge('猫', 'video', deps, ['meaning']);
    expect(meaningOnly.strength).toBe(1);
    expect(meaningOnly.status).toBe('known');
    // Inherited-known prosody no longer drags the blend down (domain-correct ×1000 scaling).
    expect(withAll.strength).toBeLessThan(1);
  });

  it('maps strength back to status at 0.5/1.0 boundaries', () => {
    expect(effectiveStatusFromStrength(0)).toBe('unknown');
    expect(effectiveStatusFromStrength(0.49)).toBe('unknown');
    expect(effectiveStatusFromStrength(0.5)).toBe('learning');
    expect(effectiveStatusFromStrength(0.99)).toBe('learning');
    expect(effectiveStatusFromStrength(1)).toBe('known');
  });

  it('reader profile ignores prosody: meaning+reading known with prosody unknown stays known', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const entry = makeEntry({ ease: 2.0, timesSeen: 5 });
    entry.aspects = {
      reading: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    const deps = makeDeps({ wordKnowledge: { [lk]: entry } });

    expect(getEffectiveKnowledge('猫', 'reader', deps, ['meaning', 'reading', 'prosody']).status).toBe('known');
    // Video weights prosody: the same state is not fully known there.
    expect(getEffectiveKnowledge('猫', 'video', deps, ['meaning', 'reading', 'prosody']).status).toBe('learning');
  });
});

describe('applyAspectWrite', () => {
  const base = { source: 'Manual' as const, now: 100 };

  it('writes the aspect record and clears inherited', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1, inherited: true },
    };
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base }, easeFor, ALL);
    expect(entry.aspects.reading?.status).toBe('learning');
    expect(entry.aspects.reading?.inherited).toBeUndefined();
  });

  it('down-squashes prosody when reading is downgraded', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base }, easeFor, ALL);
    expect(entry.aspects?.prosody?.status).toBe('learning');
    expect(entry.aspects?.prosody?.ease).toBe(1.55);
  });

  it('does not squash prosody on a reading upgrade', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'learning', ease: 1.55, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyAspectWrite(entry, { aspect: 'reading', status: 'known', ease: 1.8, ...base }, easeFor, ALL);
    expect(entry.aspects.prosody?.status).toBe('unknown');
  });

  it('down-inits prosody when it has no record', () => {
    const entry = makeEntry();
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base }, easeFor, ALL);
    expect(entry.aspects?.prosody?.status).toBe('learning');
    expect(entry.aspects?.prosody?.inherited).toBe(true);
  });

  it('finer aspects rebuild independently after a squash', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyAspectWrite(entry, { aspect: 'reading', status: 'unknown', ease: 1.3, ...base }, easeFor, ALL);
    expect(entry.aspects.prosody?.status).toBe('unknown');
    applyAspectWrite(entry, { aspect: 'prosody', status: 'known', ease: 1.9, ...base }, easeFor, ALL);
    expect(entry.aspects.prosody?.status).toBe('known');
    expect(entry.aspects.reading?.status).toBe('unknown');
  });

  it('cascades only to aspects the language makes available', () => {
    // A language with reading but no prosody: no phantom prosody records.
    const noProsody = ['meaning', 'reading'] as const;
    const entry = makeEntry();
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base }, easeFor, noProsody);
    expect(entry.aspects?.prosody).toBeUndefined();
  });
});

describe('applyMeaningCascade', () => {
  it('down-inits reading and prosody inherited from meaning', () => {
    const entry = makeEntry();
    applyMeaningCascade(entry, 'known', 100, 'Manual', easeFor, undefined, ALL);
    expect(entry.aspects?.reading?.status).toBe('known');
    expect(entry.aspects?.reading?.inherited).toBe(true);
    expect(entry.aspects?.prosody?.status).toBe('known');
    expect(entry.aspects?.prosody?.inherited).toBe(true);
  });

  it('squashes existing aspect records on a meaning downgrade', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyMeaningCascade(entry, 'learning', 100, 'Manual', easeFor, 'known', ALL);
    expect(entry.aspects.reading?.status).toBe('learning');
    expect(entry.aspects.prosody?.status).toBe('learning');
  });

  it('leaves existing aspect records untouched when meaning is not downgraded', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyMeaningCascade(entry, 'known', 100, 'Manual', easeFor, 'learning', ALL);
    expect(entry.aspects.reading?.status).toBe('unknown');
    expect(entry.aspects.prosody?.status).toBe('known');
    expect(entry.aspects.prosody?.inherited).toBe(true);
  });
});

describe('aspectSourceToDisplay', () => {
  it('maps raw sources to display names', () => {
    expect(aspectSourceToDisplay('passiveTracking')).toBe('PassiveTracking');
    expect(aspectSourceToDisplay('manual')).toBe('Manual');
  });
});
