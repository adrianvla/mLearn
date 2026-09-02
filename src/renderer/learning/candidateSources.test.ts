import { describe, expect, it } from 'vitest';
import {
  calibrationUnmeasuredCandidates,
  curriculumCandidates,
  grammarEncounterCandidates,
  mediaOpportunityCandidates,
  probeCandidates,
  retentionDueCandidates,
  suggestedLearningCandidates,
  weakTargetCandidates,
} from './candidateSources';
import type { LearnableTarget } from '../../shared/graph/types';

const target: LearnableTarget = {
  entityId: 'de:surface:hallo',
  capability: 'surface-recognition',
};

describe('retentionDueCandidates', () => {
  it('maps due cards and scores normalized lateness', () => {
    const nowMs = 10_000;
    const candidates = retentionDueCandidates([
      { id: 'due', word: 'hallo', language: 'de', targets: [target], dueDate: 9_500, interval: 1_000 },
      { id: 'future', word: 'morgen', language: 'de', targets: [target], dueDate: 10_001, interval: 1_000 },
      { id: 'buried', word: 'weg', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000, buried: true },
    ], nowMs);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ key: 'due', word: 'hallo', language: 'de', origin: 'retention' });
    expect(candidates[0].scores['retention-need']).toBe(0.5);
  });
});

describe('calibrationUnmeasuredCandidates', () => {
  it('preserves pool candidate shape and assigns calibration origin', () => {
    const [candidate] = calibrationUnmeasuredCandidates([{
      key: 'de:hallo',
      word: 'hallo',
      language: 'de',
      targets: [target],
      scores: { uncertainty: 0.8 },
      meta: { level: 1 },
    }]);

    expect(candidate).toEqual({
      key: 'de:hallo',
      word: 'hallo',
      language: 'de',
      targets: [target],
      origin: 'calibration',
      scores: { uncertainty: 0.8 },
      meta: { level: 1 },
    });
  });
});

describe('weakTargetCandidates', () => {
  it('keeps learning-band entries and scores proximity to known', () => {
    const candidates = weakTargetCandidates([
      { word: 'hallo', language: 'de', status: 'learning', ease: 1.55 },
      { word: 'neu', language: 'de', status: 'unknown', ease: 1.3 },
      { word: 'klar', language: 'de', status: 'known', ease: 1.8 },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      key: 'de:hallo',
      word: 'hallo',
      language: 'de',
      origin: 'weak-target',
      scores: { 'curriculum-relevance': 0.5 },
      targets: [{ entityId: 'de:surface:hallo', capability: 'surface-recognition' }],
    });
  });
});

describe('probeCandidates', () => {
  it('filters by uncertainty and cooldown and maps information scores', () => {
    const candidates = probeCandidates([
      { target, pSuccess: 0.5, uncertainty: 0.8 },
      { target: { ...target, entityId: 'de:surface:niedrig' }, pSuccess: 0.5, uncertainty: 0.2 },
      { target: { ...target, entityId: 'de:surface:kalt' }, pSuccess: 0.6, uncertainty: 0.9 },
    ], {
      nowMs: 10_000,
      cooldownMs: 1_000,
      uncertaintyFloor: 0.5,
      cooldowns: new Map([['de:surface:kalt:surface-recognition', 9_500]]),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      key: 'de:surface:hallo:surface-recognition',
      language: 'de',
      targets: [target],
      origin: 'probe',
      scores: { 'information-gain': 1, uncertainty: 0.8 },
      meta: { pSuccess: 0.5 },
    });
  });
});

describe('curriculum, media, and suggested sources', () => {
  it('preserves source ordering and maps each learnable word to a policy candidate', () => {
    const items = [
      { key: 'first', word: 'hallo', language: 'de' },
      { key: 'second', word: 'morgen', language: 'de' },
    ];

    for (const candidates of [
      curriculumCandidates(items),
      mediaOpportunityCandidates(items),
      suggestedLearningCandidates(items),
    ]) {
      expect(candidates.map((candidate) => candidate.key)).toEqual(['first', 'second']);
      expect(candidates.every((candidate) => candidate.targets[0]?.capability === 'surface-recognition')).toBe(true);
    }

    expect(curriculumCandidates(items)[0].origin).toBe('curriculum');
    expect(mediaOpportunityCandidates(items)[0].origin).toBe('media');
    expect(suggestedLearningCandidates(items)[0].origin).toBe('curriculum');
  });
});

describe('grammarEncounterCandidates', () => {
  it('emits grammar candidates for unmeasured patterns above the exposure floor', () => {
    const candidates = grammarEncounterCandidates([
      { pattern: 'past tense', language: 'de', timesEncountered: 12, measured: false },
      { pattern: 'negation', language: 'de', timesEncountered: 4, measured: false },
      { pattern: 'subjunctive', language: 'de', timesEncountered: 9, measured: true },
      { pattern: 'rare', language: 'de', timesEncountered: 2, measured: false },
    ]);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({
      key: 'de:grammar:past tense',
      language: 'de',
      origin: 'grammar',
      targets: [{ entityId: 'de:grammar:past tense', capability: 'grammar-recognition' }],
      meta: { pattern: 'past tense', timesEncountered: 12 },
    });
    expect(candidates[0].scores['curriculum-relevance']).toBe(1);
    expect(candidates[1].scores['curriculum-relevance']).toBeCloseTo(4 / 6);
  });

  it('honors custom floors and stays a pure selector over its inputs', () => {
    const entries = Object.freeze([
      Object.freeze({ pattern: 'conditional', language: 'fr', timesEncountered: 7, measured: false }),
    ]);

    const candidates = grammarEncounterCandidates(entries, { minEncounters: 5, saturationCount: 7 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].scores['curriculum-relevance']).toBe(1);
    expect(entries).toEqual([{ pattern: 'conditional', language: 'fr', timesEncountered: 7, measured: false }]);
  });
});
