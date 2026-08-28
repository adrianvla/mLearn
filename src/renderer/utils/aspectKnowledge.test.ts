import { describe, expect, it } from 'vitest';
import { ASPECT_PREREQUISITES, KNOWLEDGE_ASPECTS } from '../../shared/constants';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';
import {
  applyAspectWrite,
  aspectSourceToDisplay,
  getAspectStatusSync,
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
  it('passive-only exposure caps at learning; active evidence establishes known', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    // Pure passive ease growth (42 displays above the known threshold) —
    // display familiarity alone must not establish Known.
    const passive = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42, lastStatusChange: undefined }) },
    });
    expect(getAspectStatusSync('猫', 'meaning', passive).status).toBe('learning');
    // The same entry with active evidence (SRS/attempt rating) reads as known.
    const rated = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42, hasActiveEvidence: true }) },
    });
    expect(getAspectStatusSync('猫', 'meaning', rated).status).toBe('known');
  });

  it('reading with no record is untracked even when meaning is known (文脈 rule)', () => {
    const lk = langKey('ja', hashWordSync('猫'));
    const deps = makeDeps({
      wordKnowledge: { [lk]: makeEntry({ ease: 2.0, timesSeen: 42 }) },
    });
    const result = getAspectStatusSync('猫', 'reading', deps);
    // Knowing the lexeme's meaning never fabricates reading knowledge.
    expect(result.status).toBe('unknown');
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
    expect(result.untracked).toBe(true);
  });
});

describe('applyAspectWrite', () => {
  const base = { source: 'Manual' as const, now: 100 };

  it('writes the aspect record in place', () => {
    const entry = makeEntry();
    entry.aspects = {
      reading: { status: 'known', ease: 1.8, source: 'Manual', lastStatusChange: 1, updatedAt: 1 },
    };
    applyAspectWrite(entry, { aspect: 'reading', status: 'learning', ease: 1.55, ...base });
    expect(entry.aspects.reading?.status).toBe('learning');
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
    // No record and no chain: untracked, not a claimed-unknown.
    expect(gender.untracked).toBe(true);
    // Chain aspects no longer inherit either — untracked until evidence exists.
    expect(getAspectStatusSync('猫', 'reading', deps).untracked).toBe(true);
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

});
