import { describe, expect, it } from 'vitest';
import { loadLinguisticGraph } from '../../shared/graph/load';
import { buildKnowledgeProjection, claimClassification } from './knowledgeProjection';

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
    expect(meaning).toMatchObject({ classification: 'known', basis: 'evidence', evidenceSourceCounts: { anki: 1, passiveTracking: 3 }, lastDirectSuccess: 1 });
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

  it('overrides meaning-scoped classifications with the latest active claim', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [
      { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 1.8, attemptId: 'evt' },
      { t: 2, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' },
      { t: 3, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'learning' },
    ], policy, 10);

    const sense = result.targets.find((target) => target.targetRef.id === senseId)!.states[0];
    const surface = result.targets.find((target) => target.targetRef.id === surfaceId)!.states[0];
    // Latest claim wins regardless of the underlying (weaker) evidence ease.
    expect(sense).toMatchObject({ classification: 'learning', basis: 'claim' });
    expect(surface).toMatchObject({ classification: 'learning', basis: 'claim' });
  });

  it('keeps orthogonal capabilities off a meaning claim', () => {
    const graphWithReading = loadLinguisticGraph({
      schemaVersion: 1,
      language: 'ja',
      generatedAt: '',
      sourceVersions: {},
      entities: [
        { id: surfaceId, kind: 'surface', label: '猫' },
        { id: 'ja:pronunciation:neko', kind: 'pronunciation', label: 'ねこ' },
        { id: 'ja:dictionary-entry:cat', kind: 'dictionary-entry' },
        { id: senseId, kind: 'sense', label: 'cat' },
      ],
      relations: [
        { from: surfaceId, to: 'ja:pronunciation:neko', type: 'has-pronunciation' },
        { from: surfaceId, to: 'ja:dictionary-entry:cat', type: 'realizes' },
        { from: 'ja:dictionary-entry:cat', to: senseId, type: 'has-sense' },
      ],
    });
    const result = buildKnowledgeProjection(graphWithReading, surfaceId, [
      { t: 1, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' },
    ], policy, 10);

    const sense = result.targets.find((target) => target.targetRef.id === senseId)!.states[0];
    const surface = result.targets.find((target) => target.targetRef.id === surfaceId)!.states[0];
    const reading = result.targets.find((target) => target.targetRef.id === surfaceId)!.states.find((state) => state.capability === 'surface-reading')!;
    // Meaning claim applies to meaning-scoped capabilities only.
    expect(sense).toMatchObject({ classification: 'known', basis: 'claim' });
    expect(surface).toMatchObject({ classification: 'known', basis: 'claim' });
    expect(reading).toMatchObject({ classification: 'unmeasured', basis: 'unmeasured' });
  });

  it('falls back to evidence classification when the claim is cleared', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [
      { t: 1, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' },
      { t: 2, kind: 'claim', source: 'manual', aspect: 'meaning' }, // cleared
      { t: 3, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2.6, attemptId: 'evt' },
    ], policy, 10);

    const sense = result.targets.find((target) => target.targetRef.id === senseId)!.states[0];
    expect(sense).toMatchObject({ classification: 'known', basis: 'evidence' });
  });

  it('claims Known on one entry sibling never claim the sibling surface', () => {
    // 殖える/増える shape: both surfaces realize one dictionary entry, the
    // builder links them with an explicit support edge — never identity.
    const fueru = `ja:surface:${'b'.repeat(64)}`;
    const ueru = `ja:surface:${'c'.repeat(64)}`;
    const entry = 'ja:entry:1602440';
    const siblingGraph = loadLinguisticGraph({
      schemaVersion: 1,
      language: 'ja',
      generatedAt: '',
      sourceVersions: {},
      entities: [
        { id: fueru, kind: 'surface', label: '増える' },
        { id: ueru, kind: 'surface', label: '殖える' },
        { id: entry, kind: 'dictionary-entry' },
        { id: 'ja:sense:increase', kind: 'sense', label: 'to increase' },
        { id: 'ja:sense:grow', kind: 'sense', label: 'to grow' },
      ],
      relations: [
        { from: fueru, to: entry, type: 'realizes' },
        { from: ueru, to: entry, type: 'realizes' },
        { from: entry, to: 'ja:sense:increase', type: 'has-sense' },
        // As the builder emits it: unweighted sibling support.
        { from: fueru, to: ueru, type: 'semantically-related' },
        // Measured support may feed prediction — and nothing else.
        { from: 'ja:sense:grow', to: 'ja:sense:increase', type: 'semantically-related', transparency: 1 },
      ],
    });

    const claimed = buildKnowledgeProjection(siblingGraph, fueru, [
      { t: 1, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' },
    ], policy, 10);
    const claimedSense = claimed.targets.find((target) => target.targetRef.id === 'ja:sense:increase')!.states[0];
    expect(claimedSense).toMatchObject({ classification: 'known', basis: 'claim' });

    // The projection for 殖える only ever sees 殖える's own event bucket.
    const independent = buildKnowledgeProjection(siblingGraph, ueru, [], policy, 10);
    for (const target of independent.targets) {
      for (const state of target.states) {
        expect(state.basis).not.toBe('claim');
        expect(state.basis).not.toBe('evidence');
        expect(state.classification).not.toBe('known');
        expect(state.evidence).toHaveLength(0);
      }
    }
    // Measured support shows up as prediction context, nothing more.
    const ueruSense = independent.targets.find((target) => target.targetRef.id === 'ja:sense:increase')!.states[0];
    expect(ueruSense).toMatchObject({ classification: 'predicted', basis: 'prediction' });
    expect(ueruSense.evidence).toHaveLength(0);
  });

  it('evidence on one entry sibling stays evidence there and prediction-only on the sibling', () => {
    const fueru = `ja:surface:${'b'.repeat(64)}`;
    const ueru = `ja:surface:${'c'.repeat(64)}`;
    const entry = 'ja:entry:1602440';
    const siblingGraph = loadLinguisticGraph({
      schemaVersion: 1,
      language: 'ja',
      generatedAt: '',
      sourceVersions: {},
      entities: [
        { id: fueru, kind: 'surface', label: '増える' },
        { id: ueru, kind: 'surface', label: '殖える' },
        { id: entry, kind: 'dictionary-entry' },
        { id: 'ja:sense:increase', kind: 'sense', label: 'to increase' },
      ],
      relations: [
        { from: fueru, to: entry, type: 'realizes' },
        { from: ueru, to: entry, type: 'realizes' },
        { from: entry, to: 'ja:sense:increase', type: 'has-sense' },
        { from: fueru, to: ueru, type: 'semantically-related' },
      ],
    });

    const evidence = buildKnowledgeProjection(siblingGraph, fueru, [
      { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2.6, attemptId: 'evt' },
    ], policy, 10);
    const evidenceSense = evidence.targets.find((target) => target.targetRef.id === 'ja:sense:increase')!.states[0];
    expect(evidenceSense).toMatchObject({ classification: 'known', basis: 'evidence' });

    const independent = buildKnowledgeProjection(siblingGraph, ueru, [], policy, 10);
    for (const target of independent.targets) {
      for (const state of target.states) {
        expect(state.basis).not.toBe('claim');
        expect(state.basis).not.toBe('evidence');
        expect(state.classification).not.toBe('known');
        expect(state.evidence).toHaveLength(0);
      }
    }
  });

  it('maps claim statuses onto a displayed classification', () => {
    expect(claimClassification('known')).toBe('known');
    expect(claimClassification('learning')).toBe('learning');
    expect(claimClassification('unknown')).toBe('unknown');
  });
  it('keeps specialized-domain entities out of learnable targets', () => {
    const namesSurface = `ja:surface:${'b'.repeat(64)}`;
    const mixedSurface = `ja:surface:${'c'.repeat(64)}`;
    const domains = loadLinguisticGraph({
      schemaVersion: 1,
      language: 'ja',
      generatedAt: '',
      sourceVersions: {},
      entities: [
        { id: namesSurface, kind: 'surface', label: 'レア', domain: 'names' },
        { id: 'ja:dictionary-entry:rhea', kind: 'dictionary-entry', domain: 'names' },
        { id: 'ja:sense:rhea', kind: 'sense', label: 'Rhea', domain: 'names' },
        { id: mixedSurface, kind: 'surface', label: 'レア' },
        { id: 'ja:dictionary-entry:rare', kind: 'dictionary-entry' },
        { id: 'ja:sense:rare', kind: 'sense', label: 'rare' },
      ],
      relations: [
        { from: namesSurface, to: 'ja:dictionary-entry:rhea', type: 'realizes' },
        { from: 'ja:dictionary-entry:rhea', to: 'ja:sense:rhea', type: 'has-sense' },
        { from: mixedSurface, to: 'ja:dictionary-entry:rare', type: 'realizes' },
        { from: mixedSurface, to: 'ja:dictionary-entry:rhea', type: 'realizes' },
        { from: 'ja:dictionary-entry:rare', to: 'ja:sense:rare', type: 'has-sense' },
        { from: 'ja:dictionary-entry:rhea', to: 'ja:sense:rhea', type: 'has-sense' },
      ],
    });
    // A names-domain surface projects zero learnable targets.
    expect(buildKnowledgeProjection(domains, namesSurface, [], policy).targets).toHaveLength(0);
    // A shared homograph surface keeps the common sense and drops the names entry's sense.
    const mixed = buildKnowledgeProjection(domains, mixedSurface, [], policy);
    const targetIds = mixed.targets.map((target) => target.targetRef.id);
    expect(targetIds).toContain(mixedSurface);
    expect(targetIds).not.toContain('ja:sense:rhea');
    expect(targetIds).not.toContain('ja:dictionary-entry:rhea');
  });
});