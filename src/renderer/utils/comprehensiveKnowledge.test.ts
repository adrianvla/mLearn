import { describe, expect, it } from 'vitest';
import type { PassiveWordKnowledge } from '../../shared/types';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';
import { getComprehensiveWordStatusWithSource, toSelectionBlockingStatus } from './comprehensiveKnowledge';
import { effectiveStateFromEntry } from './effectiveKnowledge';

function makeDeps(overrides: Partial<ComprehensiveKnowledgeDeps> = {}): ComprehensiveKnowledgeDeps {
  return {
    getCanonicalForm: (word: string) => word,
    getWordForms: (word: string) => [word],
    hashWordSync: (word: string) => `hash:${word}`,
    langKey: (language: string, hash: string) => `${language}:${hash}`,
    language: 'ru',
    ignoredWords: {},
    wordKnowledge: {},
    knownEaseThreshold: 1.8,
    learningThreshold: 1.5,
    ...overrides,
  };
}

function entry(overrides: Partial<PassiveWordKnowledge> = {}): PassiveWordKnowledge {
  return {
    ease: 2.0,
    lastSeen: Date.now(),
    timesSeen: 4,
    timesHovered: 0,
    word: 'слово',
    language: 'ru',
    ...overrides,
  };
}

describe('getComprehensiveWordStatusWithSource (Tier-2 semantics)', () => {
  it('an explicit claim overrides evidence classification while evidence stays intact', () => {
    // 人権 invariant: evidence says Known, user claims Learning → effective
    // Learning, basis claim, evidence still Known.
    const deps = makeDeps({
      wordKnowledge: { 'ru:hash:слово': entry({ ease: 2.6, claim: 'learning', claimAt: 20, hasActiveEvidence: true, lastEvidenceSource: 'srs' }) },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    expect(result.status).toBe('learning');
    expect(result.basis).toBe('claim');
    expect(result.claim).toBe('learning');
    expect(result.evidenceStatus).toBe('known');
  });

  it('clearing the claim returns the effective state to the evidence projection', () => {
    const deps = makeDeps({
      wordKnowledge: { 'ru:hash:слово': entry({ ease: 2.6, hasActiveEvidence: true, lastEvidenceSource: 'srs' }) },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    expect(result.status).toBe('known');
    expect(result.basis).toBe('evidence');
    expect(result.claim).toBeUndefined();
  });

  it('a claim on an unmeasured word carries the classification without fabricating evidence', () => {
    const deps = makeDeps({
      wordKnowledge: { 'ru:hash:слово': entry({ ease: 0, timesSeen: 0, claim: 'known', claimAt: 5 }) },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    expect(result.status).toBe('known');
    expect(result.basis).toBe('claim');
    expect(result.evidenceStatus).toBe('unknown');
  });

  it('pure passive exposure is untracked — never Learning, never evidence-backed', () => {
    const deps = makeDeps({
      wordKnowledge: { 'ru:hash:слово': entry({ ease: 2.6, timesSeen: 50, lastEvidenceSource: 'passiveTracking' }) },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    // REQ13: familiarity (timesSeen 50, high ease) proves nothing epistemic.
    expect(result.status).toBe('unknown');
    expect(result.basis).toBe('unmeasured');
    expect(result.evidenceStatus).toBe('unknown');
    // Familiarity counts survive for familiarity consumers.
    expect(result.timesSeen).toBe(50);
    expect(result.ease).toBe(2.6);
  });

  it('an explicit status marker without the active flag stays measured and capped at learning', () => {
    const deps = makeDeps({
      wordKnowledge: { 'ru:hash:слово': entry({ ease: 2.6, timesSeen: 50, lastStatusChange: 5 }) },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    expect(result.status).toBe('learning');
    expect(result.basis).toBe('evidence');
  });

  it('active evidence (SRS/Anki/attempt/migration) lifts the passive cap', () => {
    const deps = makeDeps({
      wordKnowledge: { 'ru:hash:слово': entry({ ease: 2.6, hasActiveEvidence: true, lastEvidenceSource: 'srs' }) },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    expect(result.status).toBe('known');
    expect(result.source).toBe('Srs');
  });

  it('evidence resolves to the strongest form across the surface-form family', () => {
    const deps = makeDeps({
      getWordForms: (word: string) => word === 'идти' ? ['идти', 'иду'] : [word],
      wordKnowledge: {
        'ru:hash:идти': entry({ ease: 1.0, word: 'идти' }),
        'ru:hash:иду': entry({ ease: 2.6, word: 'иду', hasActiveEvidence: true, lastEvidenceSource: 'srs' }),
      },
    });

    const result = getComprehensiveWordStatusWithSource('идти', deps);

    expect(result.status).toBe('known');
    expect(result.matchedWord).toBe('иду');
  });

  it('the latest claim across the form family wins', () => {
    const deps = makeDeps({
      getWordForms: (word: string) => word === 'идти' ? ['идти', 'иду'] : [word],
      wordKnowledge: {
        'ru:hash:идти': entry({ claim: 'known', claimAt: 10, word: 'идти' }),
        'ru:hash:иду': entry({ claim: 'learning', claimAt: 20, word: 'иду' }),
      },
    });

    const result = getComprehensiveWordStatusWithSource('идти', deps);

    expect(result.status).toBe('learning');
  });

  it('reports the matched canonical form for reading aliases', () => {
    const deps = makeDeps({
      getWordForms: (word: string) => word === 'れんぞく' ? ['連続', 'れんぞく'] : [word],
      language: 'ja',
      wordKnowledge: { 'ja:hash:連続': entry({ word: '連続', language: 'ja', ease: 2.6, hasActiveEvidence: true, lastEvidenceSource: 'srs' }) },
    });

    const result = getComprehensiveWordStatusWithSource('れんぞく', deps);

    expect(result.status).toBe('known');
    expect(result.matchedWord).toBe('連続');
  });

  it('unmeasured words resolve unknown with unmeasured basis', () => {
    const result = getComprehensiveWordStatusWithSource('слово', makeDeps());

    expect(result.status).toBe('unknown');
    expect(result.basis).toBe('unmeasured');
    expect(result.source).toBe('None');
  });
});

describe('exclusion vs knowledge (Tier-2 semantics)', () => {
  it('ignored words resolve honestly: status stays truthful + excluded flag, never known-by-ignore', () => {
    const deps = makeDeps({
      ignoredWords: { 'ru:hash:слово': { word: 'слово', language: 'ru', ignoredAt: 1 } },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    expect(result.status).toBe('unknown');
    expect(result.excluded).toBe(true);
  });

  it('a claim coexists with exclusion: status honest, excluded flagged separately', () => {
    const deps = makeDeps({
      ignoredWords: { 'ru:hash:слово': { word: 'слово', language: 'ru', ignoredAt: 1 } },
      wordKnowledge: { 'ru:hash:слово': entry({ claim: 'known', claimAt: 5 }) },
    });

    const result = getComprehensiveWordStatusWithSource('слово', deps);

    expect(result.status).toBe('known');
    expect(result.basis).toBe('claim');
    expect(result.excluded).toBe(true);
  });
});

describe('toSelectionBlockingStatus', () => {
  it('mirrors the effective status for selection gates', () => {
    const resolved = getComprehensiveWordStatusWithSource('слово', makeDeps({
      wordKnowledge: { 'ru:hash:слово': entry({ claim: 'learning', claimAt: 3 }) },
    }));

    expect(toSelectionBlockingStatus(resolved)).toBe('learning');
  });
});

describe('effectiveStateFromEntry', () => {
  const thresholds = { learning: 1.5, known: 1.8 };

  it('no entry → unmeasured unknown', () => {
    const state = effectiveStateFromEntry(undefined, thresholds);
    expect(state.status).toBe('unknown');
    expect(state.basis).toBe('unmeasured');
  });

  it('claim unknown over evidence known keeps history visible via evidenceStatus', () => {
    const state = effectiveStateFromEntry(
      entry({ ease: 2.6, claim: 'unknown', claimAt: 9, hasActiveEvidence: true }),
      thresholds,
    );
    expect(state.status).toBe('unknown');
    expect(state.basis).toBe('claim');
    expect(state.evidenceStatus).toBe('known');
  });
});
