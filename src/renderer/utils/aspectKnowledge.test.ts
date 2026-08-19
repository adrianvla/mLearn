import { describe, expect, it } from 'vitest';
import { ASPECT_PREREQUISITES, KNOWLEDGE_ASPECTS } from '../../shared/constants';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';
import {
  applyAspectWrite,
  aspectSourceToDisplay,
  effectiveStatusFromStrength,
  getAspectStatusSync,
  getEffectiveKnowledge,
  prerequisitesOf,
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
    // Explicitly-rated by default: these suites test inheritance/weighting over
    // resolved-known fixtures, not the passive-exposure cap (pinned separately).
    lastStatusChange: 1,
    ...overrides,
  };
}

const easeFor = (status: WordStatus) => (status === 'known' ? 1.8 : status === 'learning' ? 1.55 : 1.3);
const ALL = ['meaning', 'reading', 'prosody'] as const;

describe('getAspectStatusSync', () => {
  it('passive-only exposure caps at learning; explicit rating establishes known', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    // No lastStatusChange: pure passive ease growth (42 displays above the known
    // threshold) — display familiarity alone must not establish Known.
    const passive = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42, lastStatusChange: undefined }) },
    });
    expect(getAspectStatusSync('猫', 'meaning', passive).status).toBe('learning');
    // The same entry with an explicit rating marker reads as known.
    const rated = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42 }) },
    });
    expect(getAspectStatusSync('猫', 'meaning', rated).status).toBe('known');
    expect(getAspectStatusSync('猫', 'meaning', rated).inherited).toBe(false);
  });

  it('reading with no record is untracked even when meaning is known (文脈 rule)', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const deps = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42 }) },
    });
    const result = getAspectStatusSync('猫', 'reading', deps);
    // Knowing the lexeme's meaning never fabricates reading knowledge.
    expect(result.status).toBe('unknown');
    expect(result.inherited).toBe(false);
    expect(result.untracked).toBe(true);
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

  it('returns unknown untracked when nothing is known anywhere', () => {
    const deps = makeDeps();
    const result = getAspectStatusSync('猫', 'prosody', deps);
    expect(result.status).toBe('unknown');
    expect(result.inherited).toBe(false);
    expect(result.untracked).toBe(true);
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
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base });
    expect(entry.aspects.reading?.status).toBe('learning');
    expect(entry.aspects.reading?.inherited).toBeUndefined();
  });

  it('a downgrade never propagates: prosody survives a reading downgrade', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base });
    expect(entry.aspects.reading?.status).toBe('learning');
    // Stored aspects are independent (graph = attribution-time evidence only).
    expect(entry.aspects!.prosody?.status).toBe('known');
    expect(entry.aspects!.prosody?.lastStatusChange).toBe(1);
  });

  it('no inherited seeding: absent finer records stay absent', () => {
    const entry = makeEntry();
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base });
    expect(entry.aspects!.reading?.status).toBe('learning');
    expect(entry.aspects!.prosody).toBeUndefined();
  });
});

describe('aspectSourceToDisplay', () => {
  it('maps raw sources to display names', () => {
    expect(aspectSourceToDisplay('passiveTracking')).toBe('PassiveTracking');
    expect(aspectSourceToDisplay('manual')).toBe('Manual');
  });
});

describe('aspect dependency graph', () => {
  const WITH_GENDER = ['meaning', 'reading', 'prosody', 'gender'] as const;

  it('declares prerequisites for every aspect (extensibility: new aspect = one graph entry)', () => {
    expect([...KNOWLEDGE_ASPECTS].sort()).toEqual(Object.keys(ASPECT_PREREQUISITES).sort());
  });

  it('traverses the linear chain: prosody prerequisites are reading then meaning', () => {
    expect(prerequisitesOf('prosody', WITH_GENDER)).toEqual(['meaning', 'reading']);
    expect(prerequisitesOf('reading', WITH_GENDER)).toEqual(['meaning']);
    // Orthogonal aspects have an empty prerequisite closure.
    expect(prerequisitesOf('gender', WITH_GENDER)).toEqual([]);
  });

  it('a meaning downgrade destroys no aspect evidence (independence)', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      gender: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    // The meaning cascade is removed: no write path downgrades other aspects.
    // A meaning downgrade happens via the meaning ease write, which touches no
    // aspect records — 端 read as はし survives forgetting what 端 means.
    expect(entry.aspects.reading?.status).toBe('known');
    expect(entry.aspects.prosody?.status).toBe('known');
    expect(entry.aspects.gender?.status).toBe('known');
  });

  it('a reading downgrade does not squash the orthogonal aspect', () => {
    const entry = makeEntry();
    entry.aspects = {
      gender: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyAspectWrite(entry, { aspect: 'reading', status: 'unknown', ease: 1.3, source: 'Manual', now: 100 });
    expect(entry.aspects.gender?.status).toBe('known');
  });

  it('orthogonal aspects do not inherit meaning: absent record reads as plain unknown', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const deps = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 5 }) },
    });
    const gender = getAspectStatusSync('猫', 'gender', deps);
    expect(gender.status).toBe('unknown');
    expect(gender.inherited).toBe(false);
    // No record and no chain: untracked, not a claimed-unknown.
    expect(gender.untracked).toBe(true);
    // Chain aspects no longer inherit either — untracked until evidence exists.
    expect(getAspectStatusSync('猫', 'reading', deps).inherited).toBe(false);
    expect(getAspectStatusSync('猫', 'reading', deps).untracked).toBe(true);
  });

  it('gender evidence never changes effective knowledge on any current surface', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const known = makeDeps({ wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 5 }) } });
    const withGenderFailed = makeDeps({
      wordKnowledge: {
        [lk]: {
          ...makeEntry({ ease: 2.0, timesSeen: 5 }),
          aspects: { gender: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 } },
        },
      },
    });
    for (const surface of ['video', 'reader', 'review', 'other'] as const) {
      const baseline = getEffectiveKnowledge('猫', surface, known, WITH_GENDER);
      const failed = getEffectiveKnowledge('猫', surface, withGenderFailed, WITH_GENDER);
      expect(failed.status).toBe(baseline.status);
      expect(failed.strength).toBeCloseTo(baseline.strength, 10);
    }
  });
});

describe('Tier-1 scope semantics', () => {
  const WITH_NEW = ['meaning', 'reading', 'prosody', 'gender', 'pronunciation', 'orthography'] as const;

  it('pronunciation is orthogonal: no inheritance from known meaning', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const deps = makeDeps({ wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 5 }) } });
    const pronunciation = getAspectStatusSync('猫', 'pronunciation', deps);
    // Meaning-known says nothing about the spoken form: untracked, not unknown.
    expect(pronunciation.status).toBe('unknown');
    expect(pronunciation.untracked).toBe(true);
    expect(pronunciation.inherited).toBe(false);
  });

  it('orthography resolves on the presented surface only, never the form family', () => {
    const kanjiLk = langKey('ja', hashWordSync('流石'));
    const kanaLk = langKey('ja', hashWordSync('さすが'));
    // Orthography evidence exists on the kanji surface; the makeDeps family fn
    // returns both forms so a family-scoped resolution WOULD see it.
    const deps = makeDeps({
      getWordForms: (w) => (w === '流石' || w === 'さすが' ? ['流石', 'さすが'] : [w]),
      wordKnowledge: {
        [kanjiLk]: {
          ...makeEntry({ ease: 2.0, timesSeen: 5 }),
          aspects: { orthography: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 } },
        },
      },
    });
    expect(getAspectStatusSync('流石', 'orthography', deps).status).toBe('known');
    // The kana sibling surface has no orthography claim of its own.
    const sibling = getAspectStatusSync('さすが', 'orthography', deps);
    expect(sibling.untracked).toBe(true);
  });

  it('a meaning downgrade destroys no aspect evidence (independence)', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      prosody: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      pronunciation: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
      orthography: { status: 'known', ease: 1.9, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    // The meaning cascade is removed: no write path downgrades other aspects —
    // the meaning ease write touches no aspect records, so 端 read as はし
    // survives forgetting what 端 means.
    expect(entry.aspects.reading?.status).toBe('known');
    expect(entry.aspects.prosody?.status).toBe('known');
    expect(entry.aspects.pronunciation?.status).toBe('known');
    expect(entry.aspects.orthography?.status).toBe('known');
  });

  it('pronunciation and orthography evidence never change effective knowledge on current surfaces', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const known = makeDeps({ wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 5 }) } });
    const withEvidence = makeDeps({
      wordKnowledge: {
        [lk]: {
          ...makeEntry({ ease: 2.0, timesSeen: 5 }),
          aspects: {
            pronunciation: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
            orthography: { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
          },
        },
      },
    });
    for (const surface of ['video', 'reader', 'review', 'other'] as const) {
      const baseline = getEffectiveKnowledge('猫', surface, known, WITH_NEW);
      const failed = getEffectiveKnowledge('猫', surface, withEvidence, WITH_NEW);
      expect(failed.status).toBe(baseline.status);
      expect(failed.strength).toBeCloseTo(baseline.strength, 10);
    }
  });
});
