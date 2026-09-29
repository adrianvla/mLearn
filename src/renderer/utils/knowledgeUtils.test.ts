import { describe, it, expect } from 'vitest';
import { buildKnownWordSet, buildKnownWordSetFromStore, buildTrackedWordSet } from './knowledgeUtils';
import { effectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import type { FlashcardStore, PassiveWordKnowledge } from '../../shared/types';

const thresholds = effectiveThresholds();
// The band the production caller uses, raised so the test distinguishes
// "classified at the configured threshold" from "classified at the default".
const strict = effectiveThresholds({ easeThresholdKnown: 4.0, easeThresholdLearning: 3.0 });

const entry = (overrides: Partial<PassiveWordKnowledge> = {}): PassiveWordKnowledge => ({
  word: 'x', language: 'ja', ease: 1.3, lastSeen: 1, timesSeen: 0, timesHovered: 0, ...overrides,
});

describe('buildKnownWordSet', () => {
  it('counts an entry with active evidence at the known threshold', () => {
    const knowledge = { 'ja:h1': entry({ ease: 2.0, timesSeen: 3, hasActiveEvidence: true }) };
    expect(buildKnownWordSet(knowledge, thresholds).has('ja:h1')).toBe(true);
  });

  it('never counts passive-only exposure however high the ease', () => {
    // The honesty rule: familiarity is not demonstration.
    const knowledge = { 'ja:h1': entry({ ease: 5, timesSeen: 50 }) };
    expect(buildKnownWordSet(knowledge, thresholds).has('ja:h1')).toBe(false);
  });

  it('accepts an explicit known claim at any ease', () => {
    const knowledge = { 'ja:h1': entry({ ease: 1.3, claim: 'known', claimAt: 5 }) };
    expect(buildKnownWordSet(knowledge, thresholds).has('ja:h1')).toBe(true);
  });

  it('lets a current unknown claim override high evidence', () => {
    const knowledge = { 'ja:h1': entry({ ease: 4.5, claim: 'unknown', claimAt: 5, hasActiveEvidence: true }) };
    expect(buildKnownWordSet(knowledge, thresholds).has('ja:h1')).toBe(false);
  });

  it('classifies against the caller-supplied thresholds, not a hardcoded band', () => {
    // This is the contract that replaced the `knownEaseThreshold / 1000`
    // signature: the configured band decides, on the same scale the rest of
    // the app uses.
    const knowledge = { 'ja:h1': entry({ ease: 2.5, timesSeen: 4, hasActiveEvidence: true }) };
    expect(buildKnownWordSet(knowledge, thresholds).has('ja:h1')).toBe(true);
    expect(buildKnownWordSet(knowledge, strict).has('ja:h1')).toBe(false);
  });

  it('resolves the whole surface-form family through keysForEntry', () => {
    const knowledge = { 'ja:h1': entry({ ease: 2.0, timesSeen: 3, hasActiveEvidence: true }) };
    const set = buildKnownWordSet(knowledge, thresholds, () => ['ja:h1', 'ja:variant']);
    expect(set.has('ja:h1')).toBe(true);
  });
});

describe('buildKnownWordSetFromStore', () => {
  it('reads wordKnowledge and nothing else', () => {
    const store = {
      flashcards: { 'fc-1': {} },
      wordToCardMap: { 'ja:h9': ['fc-1'] },
      knownUntracked: { 'ja:h9': true },
      ignoredWords: {},
      wordCandidates: {},
      wordKnowledge: { 'ja:h1': entry({ ease: 2.0, timesSeen: 3, hasActiveEvidence: true }) },
    } as unknown as FlashcardStore;
    const set = buildKnownWordSetFromStore(store, thresholds);
    expect(set.has('ja:h1')).toBe(true);
    // A card and a legacy known marker are not evidence.
    expect(set.has('ja:h9')).toBe(false);
  });
});

describe('buildTrackedWordSet', () => {
  it('tracks every evidence, candidate and claim key for the language', () => {
    const store = {
      wordToCardMap: { 'ja:card': ['fc-1'], 'de:card': ['fc-2'] },
      wordKnowledge: { 'ja:claim': entry({ claim: 'known', claimAt: 1 }), 'de:x': entry() },
      wordCandidates: { 'ja:cand': { word: 'a', count: 1, language: 'ja' } },
      ignoredWords: { 'ja:ignored': { word: 'b' } },

    } as unknown as FlashcardStore;
    const tracked = buildTrackedWordSet(store, 'ja');
    expect([...tracked].sort()).toEqual(['ja:cand', 'ja:card', 'ja:claim', 'ja:ignored']);
  });
});

describe('configured thresholds reach every consumer', () => {
  // The old signature took `knownEaseThreshold / 1000` while hardcoding
  // `learning: DEFAULT_SETTINGS.easeThresholdLearning`, and the callers
  // multiplied by 1000 to compensate. That mixed two scales for one concept
  // and let a caller pass 1.8 where 1800 was expected (silently classifying
  // nothing as known). All consumers now take the same object.
  const knowledge = { 'ja:h1': entry({ ease: 2.5, timesSeen: 4, hasActiveEvidence: true }) };
  const store = { wordKnowledge: knowledge } as unknown as FlashcardStore;
  const configured = effectiveThresholds({ easeThresholdKnown: 3.0, easeThresholdLearning: 2.0 });

  it('buildKnownWordSet and buildKnownWordSetFromStore agree on the configured band', () => {
    expect(buildKnownWordSet(knowledge, configured).has('ja:h1')).toBe(false);
    expect(buildKnownWordSetFromStore(store, configured).has('ja:h1')).toBe(false);
    expect(buildKnownWordSet(knowledge, thresholds).has('ja:h1')).toBe(true);
    expect(buildKnownWordSetFromStore(store, thresholds).has('ja:h1')).toBe(true);
  });
});
