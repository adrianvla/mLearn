import { describe, expect, it } from 'vitest';
import type { PassiveWordKnowledge } from '../../shared/types';
import type { LinguisticGraph } from '../../shared/graph/load';
import { assembleTargetExplanation } from '../../shared/graph/explanations';
import { eventAppliesToCapability } from '../../shared/graph/addressing';
import { CAPABILITY_ACCESS, demonstratesOf, migrateAspectRecordsToAccess } from '../../shared/graph/access';
import { predictTargetAccessibility } from '../../shared/prediction/supportPredictor';
import { eventCapability } from '../../shared/knowledgeEvents';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';
import { getComprehensiveWordStatusWithSource } from './comprehensiveKnowledge';
import { getAccessStatusSync } from './accessKnowledge';

const policy = { learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 365 };

function makeDeps(overrides: Partial<ComprehensiveKnowledgeDeps> = {}): ComprehensiveKnowledgeDeps {
  return {
    getCanonicalForm: (word: string) => word,
    getWordForms: (word: string) => [word],
    hashWordSync: (word: string) => `hash:${word}`,
    langKey: (language: string, hash: string) => `${language}:${hash}`,
    language: 'ja',
    ignoredWords: {},
    wordKnowledge: {},
    knownEaseThreshold: 1.8,
    learningThreshold: 1.5,
    ...overrides,
  };
}

function entry(overrides: Partial<PassiveWordKnowledge> = {}): PassiveWordKnowledge {
  return {
    ease: 1.3,
    lastSeen: 1,
    timesSeen: 1,
    timesHovered: 0,
    word: 'みょうじ',
    language: 'ja',
    ...overrides,
  };
}

/** Minimal graph: target surface with one predictable derived-from support edge. */
function makeGraph(): LinguisticGraph {
  const relations = [{ from: 'ja:surface:parent', to: 'ja:surface:abc', type: 'derived-from' as const, predictability: 0.8 }];
  const entities = [
    { id: 'ja:surface:abc', kind: 'surface' as const },
    { id: 'ja:surface:parent', kind: 'surface' as const },
  ];
  return {
    asset: { schemaVersion: 1 as const, language: 'ja', generatedAt: '', sourceVersions: {}, entities, relations },
    nodes: new Map(entities.map((entity) => [entity.id, entity])),
    outgoing: new Map(),
    incoming: new Map([['ja:surface:abc', relations]]),
    denseOf: new Map(),
    persistentOf: entities.map((entity) => entity.id),
  };
}

describe('learner overlay: claims, evidence, and predictions stay separate', () => {
  it('A: known-by-sound word with a missing written bridge is NOT wholly unknown', () => {
    // Spoken-recognition claim ("I know this word when I hear it") is stored
    // per access; the written surface has an explicit negative claim. The
    // word-level summary projects the lexical object, not the bridge.
    const deps = makeDeps({
      wordKnowledge: {
        'ja:hash:苗字': entry({
          access: {
            'spoken-recognition': { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 5, updatedAt: 5, claim: 'known', claimAt: 10 },
            'surface-recognition': { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 5, updatedAt: 5, claim: 'unknown', claimAt: 20 },
          },
        }),
      },
    });

    const word = getComprehensiveWordStatusWithSource('苗字', deps);
    expect(word.status).toBe('known');
    expect(word.basis).toBe('claim');

    // The bridge is still honestly missing, per access.
    const surface = getAccessStatusSync('苗字', 'surface-recognition', deps);
    expect(surface.status).toBe('unknown');
    expect(surface.basis).toBe('claim');
    const spoken = getAccessStatusSync('苗字', 'spoken-recognition', deps);
    expect(spoken.status).toBe('known');
  });

  it('A2: surface-recognition negative claims never demote the lexical object', () => {
    // The written-form claim is a bridge statement: it must not compete for
    // the word-level summary (a NEWER "never seen this form" does not make a
    // sense-known word unknown).
    const deps = makeDeps({
      wordKnowledge: {
        'ja:hash:苗字': entry({
          ease: 2.6,
          hasActiveEvidence: true,
          lastEvidenceSource: 'srs',
          claim: 'known',
          claimAt: 10,
          access: {
            'surface-recognition': { status: 'unknown', ease: 1.3, source: 'Manual', lastStatusChange: 5, updatedAt: 5, claim: 'unknown', claimAt: 99 },
          },
        }),
      },
    });

    const word = getComprehensiveWordStatusWithSource('苗字', deps);
    expect(word.status).toBe('known');
    expect(word.basis).toBe('claim');
  });

  it('B: observed compositional inference is evidence (with method), never a claim', () => {
    const inferenceAttempt: KnowledgeEvent = {
      t: 1,
      kind: 'rating',
      source: 'manual',
      quality: 'fluent',
      easeAfter: 2.6,
      method: 'inference',
      attemptId: 'a1',
      targetRef: { kind: 'surface', id: 'ja:surface:abc', capability: 'sense-recognition' },
      presentedSurface: '苗字',
    };
    // Precise addressing: capability-addressed events match ONLY their access
    // (no legacy fan-out).
    expect(eventAppliesToCapability(inferenceAttempt, 'sense-recognition')).toBe(true);
    expect(eventAppliesToCapability(inferenceAttempt, 'surface-recognition')).toBe(false);

    const explanation = assembleTargetExplanation('sense-recognition', [inferenceAttempt], policy, 2);
    expect(explanation.state).toBe('evidence-backed-known');
    expect(explanation.projection?.claim).toBeUndefined();
    expect(explanation.evidence[0].method).toBe('inference');
  });

  it('B2: the predictor calibrates on observed transfer without writing knowledge', () => {
    const target = { entityId: 'ja:surface:abc', capability: 'surface-reading' as const };
    const graph = makeGraph();

    const neutral = predictTargetAccessibility({ graph, direct: null, target, classify: () => 'unknown' });
    const skilled = predictTargetAccessibility({
      graph, direct: null, target, classify: () => 'unknown',
      inferenceSuccess: { attempts: 5, successes: 5 },
    });
    const struggling = predictTargetAccessibility({
      graph, direct: null, target, classify: () => 'unknown',
      inferenceSuccess: { attempts: 5, successes: 0 },
    });

    expect(skilled.pSuccess).toBeGreaterThan(neutral.pSuccess);
    expect(struggling.pSuccess).toBeLessThan(neutral.pSuccess);
    // Predictions are always expectations.
    expect(neutral.kind).toBe('prediction');
  });

  it('C: an access the encounter never measured stays untracked', () => {
    // Word Sync measured sense + written bridge; prosody had no task.
    const deps = makeDeps({
      wordKnowledge: {
        'ja:hash:苗字': entry({
          ease: 2.6,
          hasActiveEvidence: true,
          lastEvidenceSource: 'manual',
          access: {
            'surface-recognition': { status: 'known', ease: 2.1, source: 'Manual', lastStatusChange: 5, updatedAt: 5 },
          },
        }),
      },
    });

    const prosody = getAccessStatusSync('苗字', 'prosodic-pattern', deps);
    expect(prosody.untracked).toBe(true);
    expect(prosody.status).toBe('unknown');
    // Not fabricated by the known word level.
    expect(prosody.basis).toBeUndefined();
  });

  it('E: capability-scoped claims override classification; evidence stays intact underneath', () => {
    const events: KnowledgeEvent[] = [
      { t: 1, kind: 'rating', source: 'manual', quality: 'missed', attemptId: 'a1', aspect: 'prosody', targetRef: { kind: 'surface', id: 'ja:surface:abc', capability: 'prosodic-pattern' }, easeAfter: 1.3 },
      { t: 2, kind: 'claim', source: 'manual', toStatus: 'known', targetRef: { kind: 'surface', id: 'ja:surface:abc', capability: 'prosodic-pattern' } },
    ];
    const explanation = assembleTargetExplanation('prosodic-pattern', events, policy, 3);
    expect(explanation.state).toBe('claimed-known');
    expect(explanation.projection?.claim).toBe('known');
    // Evidence underneath the claim is untouched and still reported.
    expect(explanation.evidence.filter((event) => event.kind !== 'claim')).toHaveLength(1);
    expect(explanation.evidence.some((event) => event.quality === 'missed')).toBe(true);

    // Spoken-recognition has no legacy aspect: the capability is the only address.
    expect(eventCapability({ t: 1, kind: 'claim', source: 'manual', toStatus: 'known', targetRef: { kind: 'surface', id: 's', capability: 'spoken-recognition' } })).toBe('spoken-recognition');
  });

  it('legacy flat journals keep their meaning fan-out; new events do not fan out', () => {
    const legacyMeaning: KnowledgeEvent = { t: 1, kind: 'rating', source: 'srs', aspect: 'meaning', easeAfter: 2.6 };
    expect(eventAppliesToCapability(legacyMeaning, 'sense-recognition')).toBe(true);
    expect(eventAppliesToCapability(legacyMeaning, 'surface-recognition')).toBe(true);
    expect(eventAppliesToCapability(legacyMeaning, 'surface-reading')).toBe(false);

    const addressed: KnowledgeEvent = { t: 1, kind: 'rating', source: 'srs', quality: 'good', targetRef: { kind: 'surface', id: 's', capability: 'sense-recognition' } };
    expect(eventAppliesToCapability(addressed, 'sense-recognition')).toBe(true);
    expect(eventAppliesToCapability(addressed, 'surface-recognition')).toBe(false);
  });
});

describe('access-path semantics', () => {
  it('every core capability declares a directed access', () => {
    expect(CAPABILITY_ACCESS['spoken-recognition']).toEqual({ cue: 'spoken-form', retrieval: 'lexical-identity' });
    expect(CAPABILITY_ACCESS['surface-recognition']).toEqual({ cue: 'written-form', retrieval: 'lexical-identity' });
    expect(CAPABILITY_ACCESS['surface-reading']).toEqual({ cue: 'written-form', retrieval: 'pronunciation' });
    expect(CAPABILITY_ACCESS['sense-recognition']).toEqual({ cue: 'lexical-item', retrieval: 'meaning' });
  });

  it('task-mediated traversal follows the access path, not a linguistic hierarchy', () => {
    // A written-cued sense measurement proves the written bridge worked.
    expect(demonstratesOf('sense-recognition', 'written-form')).toEqual(['surface-recognition']);
    // A written-cued reading measurement proves recognition, NOT sense.
    expect(demonstratesOf('surface-reading', 'written-form')).toEqual(['surface-recognition']);
    // A written-cued pitch self-assessment retrieved the reading too.
    expect(demonstratesOf('prosodic-pattern', 'written-form')).toEqual(['surface-recognition', 'surface-reading']);
    // A spoken-cued sense measurement proves the spoken access.
    expect(demonstratesOf('sense-recognition', 'spoken-form')).toEqual(['spoken-recognition']);
    // Production accesses demonstrate nothing automatically.
    expect(demonstratesOf('pronunciation-production', 'spoken-form')).toEqual([]);
  });
});

describe('overlay record migration', () => {
  it('legacy aspect records re-key to capabilities; unknown keys survive', () => {
    const legacy = entry({
      aspects: {
        reading: { status: 'known', ease: 2.1, source: 'Manual', lastStatusChange: 5, updatedAt: 5 },
        'ns::pkg-tone': { status: 'learning', ease: 1.6, source: 'Manual', lastStatusChange: 6, updatedAt: 6 },
      },
    } as Partial<PassiveWordKnowledge>);

    const migrated = migrateAspectRecordsToAccess(legacy);
    expect(migrated.aspects).toBeUndefined();
    expect(migrated.access?.['surface-reading']?.status).toBe('known');
    expect(migrated.access?.['ns::pkg-tone']?.status).toBe('learning');
  });

  it('entries without legacy records pass through untouched', () => {
    const plain = entry();
    expect(migrateAspectRecordsToAccess(plain)).toBe(plain);
  });
});
