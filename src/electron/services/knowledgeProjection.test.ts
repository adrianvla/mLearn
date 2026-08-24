import { describe, expect, it } from 'vitest';
import { loadLinguisticGraph } from '../../shared/graph/load';
import { buildKnowledgeProjection } from './knowledgeProjection';

const policy = { learningSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, reviewIntervalModifier: 100, maxInterval: 36500 };
const surfaceId = `ja:surface:${'a'.repeat(64)}`;
const senseId = 'ja:sense:cat';
const graph = loadLinguisticGraph({
  schemaVersion: 1,
  language: 'ja',
  generatedAt: '',
  sourceVersions: {},
  entities: [
    { id: surfaceId, kind: 'surface', label: '猫' },
    { id: 'ja:dictionary-entry:cat', kind: 'dictionary-entry' },
    { id: senseId, kind: 'sense', label: 'cat' },
    { id: 'ja:surface:support', kind: 'surface', label: '犬' },
  ],
  relations: [
    { from: surfaceId, to: 'ja:dictionary-entry:cat', type: 'realizes' },
    { from: 'ja:dictionary-entry:cat', to: senseId, type: 'has-sense' },
    { from: 'ja:surface:support', to: senseId, type: 'semantically-related', transparency: 1 },
  ],
});

describe('buildKnowledgeProjection', () => {
  it('uses active evidence, groups provenance, derives retention, and round-trips JSON', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [
      { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2, rating: 'good', method: 'recall', quality: 'fluent', attemptId: 'kept', latencyMs: 42 },
      { t: 2, kind: 'status', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 3 },
      { t: 3, kind: 'rating', source: 'srs', aspect: 'meaning', easeAfter: 3, attemptId: 'gone' },
      { t: 4, kind: 'retraction', source: 'srs', aspect: 'meaning', retracts: 'gone' },
    ], policy, 10);

    const meaning = result.targets.find((target) => target.targetRef.id === senseId)!.states[0];
    expect(meaning).toMatchObject({ classification: 'learning', basis: 'evidence', evidenceSourceCounts: { anki: 1, passiveTracking: 3 }, lastDirectSuccess: 1 });
    expect(meaning.evidence).toHaveLength(2);
    expect(meaning.retention).toMatchObject({ dueAt: expect.any(Number), pressure: expect.any(Number) });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('reports predicted and unmeasured targets without inventing prediction reasons', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [], policy);
    const sense = result.targets.find((target) => target.targetRef.id === senseId)!.states[0];
    const surface = result.targets.find((target) => target.targetRef.id === surfaceId)!.states[0];
    expect(sense).toMatchObject({ classification: 'predicted', basis: 'prediction' });
    expect(sense.prediction?.reasons).toHaveLength(1);
    expect(surface).toMatchObject({ classification: 'unmeasured', basis: 'unmeasured' });
    expect(surface.prediction).toBeUndefined();
  });
});
