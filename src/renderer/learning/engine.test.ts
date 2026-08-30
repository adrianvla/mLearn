import { describe, expect, it } from 'vitest';
import { grammarEntityId } from '../../shared/graph/load';
import {
  PRESETS,
  calibrationPoolItem,
  selectEncounterBatch,
  selectNextEncounter,
  type EncounterInputs,
} from './engine';

const target = { entityId: 'de:surface:hallo', capability: 'surface-recognition' as const };

describe('selectNextEncounter', () => {
  it('composes each preset with its source adapter', () => {
    const retention = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'due', word: 'hallo', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      rng: () => 0.5,
    });
    const calibration = selectNextEncounter({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [calibrationPoolItem('de:neu', 'neu', 'de', 1)],
      rng: () => 0.5,
    });

    expect(retention?.action).toBe('MAINTAIN');
    expect(calibration?.action).toBe('TEACH');
    expect(PRESETS.RETENTION.weights['retention-need']).toBeGreaterThan(0);
    expect(PRESETS.CALIBRATION.weights.novelty).toBeGreaterThan(0);
  });

  it('leaves callers able to retain their existing fallback on defer', () => {
    const fallback = { id: 'future' };
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: fallback.id, word: 'morgen', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      config: { attentionBudgetRemaining: 0 },
    });

    expect(decision?.action).toBe('DEFER');
    expect(decision?.action === 'DEFER' ? decision.candidate.key : fallback.id).toBe(fallback.id);
  });

  it('preserves Level Study, media, and suggested source order through policy selection', () => {
    const expected = ['first', 'second'];
    const common = [
      { key: 'first', word: 'hallo', language: 'de' },
      { key: 'second', word: 'morgen', language: 'de' },
    ];

    expect(selectEncounterBatch({ preset: 'CURRICULUM', nowMs: 0, levelStudyItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
    expect(selectEncounterBatch({ preset: 'MEDIA', nowMs: 0, mediaItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
    expect(selectEncounterBatch({ preset: 'SUGGESTED', nowMs: 0, suggestedItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
  });
});

describe('REQ24 dead-source wiring', () => {
  it('selects calibration probes under the CALIBRATION preset', () => {
    const decision = selectNextEncounter({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [],
      probeTargets: [{
        target: { entityId: 'de:grammar:past tense', capability: 'grammar-recognition' },
        pSuccess: 0.5,
        uncertainty: 1,
      }],
      rng: () => 0.5,
    });

    expect(decision?.action).toBe('PROBE');
    expect(decision?.candidate.origin).toBe('probe');
    expect(decision?.candidate.scores['information-gain']).toBe(1);
  });

  it('merges weak targets into the calibration mix and selects them as TEACH', () => {
    const decision = selectNextEncounter({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.3 }],
      rng: () => 0.5,
    });

    expect(decision?.action).toBe('TEACH');
    expect(decision?.candidate.origin).toBe('weak-target');
  });

  it('merges weak targets into the retention pool as fallback fill', () => {
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
      rng: () => 0.5,
    });

    expect(decision?.action).toBe('TEACH');
    expect(decision?.candidate.origin).toBe('weak-target');
  });

  it('keeps due review cards ranked above zero-weight weak targets', () => {
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'due', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
      rng: () => 0.5,
    });

    expect(decision?.candidate.key).toBe('due');
    expect(decision?.action).toBe('MAINTAIN');
  });
});

describe('REQ39 grammar exposure priority', () => {
  const encounters = [
    { pattern: 'negation', language: 'de', timesEncountered: 4, measured: false },
    { pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false },
  ];

  it('prioritizes repeatedly-seen unmeasured patterns through the single policy layer', () => {
    const decision = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [],
      grammarEncounters: encounters,
      rng: () => 0.5,
    });

    expect(decision?.candidate.origin).toBe('grammar');
    expect(decision?.candidate.key).toBe(grammarEntityId('de', 'past tense'));
    expect(decision?.candidate.scores['curriculum-relevance']).toBe(1);

    const reversed = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [],
      grammarEncounters: [...encounters].reverse(),
      rng: () => 0.5,
    });
    expect(reversed?.candidate.key).toBe(grammarEntityId('de', 'past tense'));
  });

  it('ranks exposure-saturated grammar patterns against suggested words in one weighted pick', () => {
    const decision = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
      grammarEncounters: [{ pattern: 'negation', language: 'de', timesEncountered: 4, measured: false }],
      rng: () => 0.5,
    });

    // Both compete on curriculum-relevance: word scores 1, pattern 4/6.
    expect(decision?.candidate.key).toBe('de:wort');
  });
});

describe('candidate origin reachability', () => {
  it('reaches every non-reserved origin from sourceCandidates', () => {
    const origins = new Set<string>();
    const collect = (inputs: EncounterInputs) => {
      for (const decision of selectEncounterBatch(inputs)) origins.add(decision.candidate.origin);
    };

    collect({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'due', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
    });
    collect({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [calibrationPoolItem('de:neu', 'neu', 'de', 1)],
      weakTargets: [{ word: 'haus', language: 'de', status: 'learning', ease: 1.55 }],
      probeTargets: [{
        target: { entityId: 'de:grammar:past tense', capability: 'grammar-recognition' },
        pSuccess: 0.5,
        uncertainty: 1,
      }],
    });
    collect({ preset: 'CURRICULUM', nowMs: 0, levelStudyItems: [{ key: 'de:wort', word: 'wort', language: 'de' }] });
    collect({ preset: 'MEDIA', nowMs: 0, mediaItems: [{ key: 'de:wort', word: 'wort', language: 'de' }] });
    collect({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [{ key: 'de:wort', word: 'wort', language: 'de' }],
      grammarEncounters: [{ pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false }],
    });

    expect(origins).toEqual(new Set([
      'retention',
      'curriculum',
      'calibration',
      'weak-target',
      'probe',
      'media',
      'grammar',
    ]));
    expect(origins.has('assignment')).toBe(false);
  });
});

describe('source purity', () => {
  it('grammar encounters are read-only policy input — never evidence writes', () => {
    const grammarEncounters = Object.freeze([
      Object.freeze({ pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false }),
    ]);

    const decision = selectNextEncounter({
      preset: 'SUGGESTED',
      nowMs: 0,
      suggestedItems: [],
      grammarEncounters,
      rng: () => 0.5,
    });

    expect(decision?.candidate.origin).toBe('grammar');
    expect(decision?.candidate.meta).toEqual({ pattern: 'past tense', timesEncountered: 12 });
    expect(grammarEncounters).toEqual([
      { pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false },
    ]);
  });
});
