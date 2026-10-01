import type { LanguageData } from '../../shared/types';
import { describe, expect, it } from 'vitest';
import type { KeyArchive } from '../../shared/knowledge/historyArchive';
import { applyEventToFold, emptyKeyFold } from '../../shared/utils/projectionReplay';
import { loadLinguisticGraph } from '../../shared/graph/load';
import { attestedCompoundAnalysis } from '../../shared/graph/morphology/attested';
import { buildKnowledgeProjection, claimClassification, observedTransferHistory } from './knowledgeProjection';

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
  it('retains exact-surface historical ratings when the installed graph no longer contains that surface', () => {
    const missing = 'ja:surface:removed';
    const events = [{ t: 1, kind: 'rating' as const, source: 'manual' as const, aspect: 'meaning' as const, easeAfter: 1.8, origin: 'word-sync' as const, attemptId: 'original' }];
    const result = buildKnowledgeProjection(graph, missing, events, policy, 10);
    expect(result.lexical?.overall).toEqual({ classification: 'known', basis: 'evidence' });
    expect(result.targets).toEqual([expect.objectContaining({
      targetRef: { kind: 'surface', id: missing }, applicableCapabilities: [],
      states: [expect.objectContaining({ capability: 'sense-recognition', classification: 'known', evidenceSourceCounts: { manual: 1 } })],
    })]);
    const retracted = buildKnowledgeProjection(graph, missing, [...events,
      { t: 2, kind: 'retraction', source: 'manual', retracts: 'original' },
    ], policy, 10);
    expect(retracted.lexical?.overall.basis).toBe('unmeasured');
    expect(events[0]).not.toHaveProperty('targetRef');
  });

  it('retains and clears an explicit claim on an absent surface without transferring its identity', () => {
    const missing = 'ja:surface:removed';
    const targetRef = { kind: 'surface' as const, id: missing, capability: 'sense-recognition' };
    const claim = { t: 1, kind: 'claim' as const, source: 'manual' as const, targetRef, toStatus: 'known' as const };
    expect(buildKnowledgeProjection(graph, missing, [claim], policy).lexical?.overall).toEqual({ classification: 'known', basis: 'claim' });
    expect(buildKnowledgeProjection(graph, missing, [claim, { ...claim, t: 2, toStatus: undefined }], policy).lexical?.overall.basis).toBe('unmeasured');
    expect(buildKnowledgeProjection(graph, surfaceId, [claim], policy).lexical?.overall.basis).toBe('unmeasured');
  });

  it('keeps claims in state and history without counting them as observed evidence', () => {
    const claim = { t: 1, kind: 'claim' as const, source: 'manual' as const, quality: 'fluent' as const,
      targetRef: { kind: 'surface' as const, id: surfaceId, capability: 'surface-reading' }, toStatus: 'known' as const };
    const claimed = buildKnowledgeProjection(graph, surfaceId, [claim], policy, 10);
    const state = claimed.targets.find(target => target.targetRef.id === surfaceId)!.states.find(state => state.capability === 'surface-reading')!;
    expect(state).toMatchObject({ basis: 'claim', classification: 'known', evidence: [], evidenceSourceCounts: {} });
    const cleared = buildKnowledgeProjection(graph, surfaceId, [claim, { ...claim, t: 2, toStatus: undefined }], policy, 10);
    expect(cleared.targets.flatMap(target => target.states).every(state => state.evidence.length === 0 && Object.keys(state.evidenceSourceCounts ?? {}).length === 0)).toBe(true);
    expect(cleared.lexical?.overall.basis).toBe('unmeasured');
  });

  it('keeps a reading-only claim on its access while lexical identity remains unmeasured', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [
      { t: 1, kind: 'claim', source: 'manual', aspect: 'reading', toStatus: 'known' },
    ], policy, 10);
    expect(result.lexical?.overall).toEqual({ classification: 'unmeasured', basis: 'unmeasured' });
    expect(result.lexical?.sense.classification).not.toBe('known');
  });

  it('emits one state per (entity, capability) even when package data duplicates relations', () => {
    const duplicated = loadLinguisticGraph({
      schemaVersion: 1,
      language: 'ja',
      generatedAt: '',
      sourceVersions: {},
      entities: [
        { id: surfaceId, kind: 'surface', label: '猫' },
        { id: 'ja:dictionary-entry:cat', kind: 'dictionary-entry' },
        { id: senseId, kind: 'sense', label: 'cat' },
      ],
      relations: [
        { from: surfaceId, to: 'ja:dictionary-entry:cat', type: 'realizes' },
        { from: surfaceId, to: 'ja:dictionary-entry:cat', type: 'realizes' },
        { from: 'ja:dictionary-entry:cat', to: senseId, type: 'has-sense' },
        // Package banks repeat entries: the same has-sense edge twice must not
        // duplicate the sense's states in the projection payload.
        { from: 'ja:dictionary-entry:cat', to: senseId, type: 'has-sense' },
      ],
    });
    const result = buildKnowledgeProjection(duplicated, surfaceId, [], policy);
    expect(result.lexical?.entryIds).toEqual(['ja:dictionary-entry:cat']);
    const sense = result.targets.find((target) => target.targetRef.id === senseId);
    const recognitionStates = sense?.states.filter((state) => state.capability === 'sense-recognition') ?? [];
    expect(recognitionStates).toHaveLength(1);
    const surface = result.targets.find((target) => target.targetRef.id === surfaceId)!;
    const surfaceCapabilities = surface.states.map((state) => state.capability);
    expect(new Set(surfaceCapabilities).size).toBe(surfaceCapabilities.length);
  });

  it('projects a package-declared opaque capability without core registration', () => {
    const capability = 'x-test::evidentiality';
    const packageGraph = loadLinguisticGraph({
      schemaVersion: 1,
      language: 'x-test',
      generatedAt: '',
      sourceVersions: {},
      entities: [{ id: 'x-test:surface:opaque', kind: 'surface', learnableCapabilities: [capability] }],
      relations: [],
    });
    const result = buildKnowledgeProjection(packageGraph, 'x-test:surface:opaque', [{
      t: 1,
      kind: 'rating',
      source: 'srs',
      quality: 'fluent',
      easeAfter: 2,
      targetRef: { kind: 'surface', id: 'x-test:surface:opaque', capability },
    }], policy, 10, undefined, {
      languageData: {
        name: 'Test language',
        learning: { capabilities: { [capability]: { label: 'Evidentiality', scope: 'surface' } } },
      },
    });
    expect(result.targets[0]?.applicableCapabilities).toContain(capability);
    expect(result.targets[0]?.states.find((state) => state.capability === capability)).toEqual(expect.objectContaining({ capability, classification: 'known', basis: 'evidence' }));
  });


  it('uses active evidence, groups provenance, derives retention, and round-trips JSON', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [
      { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2, rating: 'good', method: 'recall', quality: 'fluent', attemptId: 'kept', latencyMs: 42 },
      { t: 2, kind: 'status', source: 'passiveTracking', aspect: 'meaning', timesSeenDelta: 3 },
      { t: 3, kind: 'rating', source: 'srs', aspect: 'meaning', easeAfter: 3, attemptId: 'gone' },
      { t: 4, kind: 'retraction', source: 'srs', aspect: 'meaning', retracts: 'gone' },
    ], policy, 10);

    const meaning = result.targets.find((target) => target.targetRef.id === surfaceId)!.states.find(state => state.capability === 'sense-recognition')!;
    expect(meaning).toMatchObject({ classification: 'known', basis: 'evidence', evidenceSourceCounts: { anki: 1, passiveTracking: 3 }, lastDirectSuccess: 1 });
    expect(meaning.evidence).toHaveLength(2);
    expect(meaning.retention).toMatchObject({ dueAt: expect.any(Number), pressure: expect.any(Number) });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('reports predicted and unmeasured targets without inventing prediction reasons', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [], policy);
    const sense = result.targets.find((target) => target.targetRef.id === senseId)!.states[0];
    const surface = result.targets.find((target) => target.targetRef.id === surfaceId)!.states[0];
    expect(sense).toMatchObject({ classification: 'unmeasured', basis: 'unmeasured' });
    expect(sense.prediction).toBeUndefined();
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
    expect(result.lexical?.sense).toEqual({ classification: 'learning', basis: 'claim' });
    expect(sense.basis).not.toBe('claim');
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
    // Meaning claim applies to meaning-scoped capabilities only — never as
    // evidence. The written bridge is UNMEASURED evidence; graph-relative
    // support may PREDICT it cheaply (basis: prediction, never claim/evidence).
    expect(reading).toMatchObject({ classification: 'predicted', basis: 'prediction' });
  });

  it('falls back to evidence classification when the claim is cleared', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [
      { t: 1, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' },
      { t: 2, kind: 'claim', source: 'manual', aspect: 'meaning' }, // cleared
      { t: 3, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2.6, attemptId: 'evt' },
    ], policy, 10);

    const sense = result.targets.find((target) => target.targetRef.id === senseId)!.states[0];
    expect(result.lexical?.sense).toEqual({ classification: 'known', basis: 'evidence' });
    expect(sense.basis).not.toBe('evidence');
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
    expect(claimed.lexical?.sense).toEqual({ classification: 'known', basis: 'claim' });
    expect(claimedSense.basis).not.toBe('claim');

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
    // Structural weights alone cannot establish the learner's source knowledge.
    const ueruSense = independent.targets.find((target) => target.targetRef.id === 'ja:sense:increase')!.states[0];
    expect(ueruSense).toMatchObject({ classification: 'unmeasured', basis: 'unmeasured' });
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
    expect(evidence.lexical?.sense).toEqual({ classification: 'known', basis: 'evidence' });
    expect(evidenceSense.basis).not.toBe('evidence');

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

  it('supports an unmeasured target only from known source access and keeps senses independent', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [{
      t: 1, kind: 'rating', source: 'manual', quality: 'fluent', easeAfter: 2.6,
      targetRef: { kind: 'surface', id: 'ja:surface:support', capability: 'sense-recognition' },
    }], policy, 10);
    const meaning = result.targets.find(target => target.targetRef.id === senseId)!.states[0];
    expect(meaning).toMatchObject({ classification: 'predicted', basis: 'prediction', evidence: [] });
    expect(meaning.prediction?.reasons).toEqual(['ja:surface:support → ja:sense:cat (semantically-related)']);
    expect(result.lexical?.overall.basis).toBe('unmeasured');
    const measured = buildKnowledgeProjection(graph, surfaceId, [{
      t: 1, kind: 'rating', source: 'manual', quality: 'fluent', easeAfter: 2.6,
      targetRef: { kind: 'sense', id: senseId, capability: 'sense-recognition' },
    }], policy, 10);
    expect(measured.targets.find(target => target.targetRef.id === senseId)!.states[0]).toMatchObject({ classification: 'known', basis: 'evidence' });
  });

  it('counts identifiable unassisted transfer attempts once and excludes assisted or unknown contexts', () => {
    const event = { t: 1, kind: 'rating', source: 'srs', method: 'inference', quality: 'fluent', taskType: 'srs-review', scaffolds: {}, attemptId: 'observed-transfer', aspect: 'meaning' } as const;
    expect(observedTransferHistory([event, { ...event, aspect: 'reading' }, event])).toEqual({ attempts: 1, successes: 1 });
    expect(observedTransferHistory([event, { ...event, aspect: 'reading', quality: 'missed' }])).toEqual({ attempts: 1, successes: 0 });
    expect(observedTransferHistory([{ ...event, attemptId: 'assisted', scaffolds: { 'x::help': true } },
      { ...event, attemptId: 'unknown-context', scaffolds: undefined }, { ...event, attemptId: '1' },
      { ...event, taskType: undefined }])).toBeUndefined();
    expect(observedTransferHistory([event, { t: 2, kind: 'retraction', source: 'srs', retracts: event.attemptId }])).toBeUndefined();
  });

  it('allows prediction when unrelated archived observations do not measure the target', () => {
    const empty = { version: 1, frontierT: 1, archivedEventCount: 0, buckets: {}, weekPoints: [] } as unknown as KeyArchive;
    const result = buildKnowledgeProjection(graph, surfaceId, [{ t: 1, kind: 'rating', source: 'manual', quality: 'fluent', easeAfter: 2.6,
      targetRef: { kind: 'surface', id: 'ja:surface:support', capability: 'sense-recognition' } }], policy, 10, undefined, { archives: [empty] });
    expect(result.targets.find(target => target.targetRef.id === senseId)!.states[0]).toMatchObject({ classification: 'predicted', basis: 'prediction' });
  });

  it('does not reinterpret unaddressed target history as an unrelated support source', () => {
    const extension = loadLinguisticGraph({
      schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: [{ id: 'target', kind: 'surface', learnableCapabilities: ['x::access'] }, { id: 'unrelated', kind: 'surface' }],
      relations: [{ from: 'unrelated', to: 'target', type: 'x::support' }],
    });
    const languageData = { learning: { capabilities: { 'x::access': { supportRules: [{ relation: 'x::support', sourceCapability: 'surface-reading', weight: 1 }] } } } } as LanguageData;
    const result = buildKnowledgeProjection(extension, 'target', [{ t: 1, kind: 'rating', source: 'manual', aspect: 'reading', quality: 'fluent', easeAfter: 2.6 }], policy, 10, undefined, { languageData });
    expect(result.targets.find(target => target.targetRef.id === 'target')?.states.find(state => state.capability === 'x::access')).toMatchObject({ classification: 'unmeasured', basis: 'unmeasured' });
  });

  it('discovers learnable package entities without a core relation or entity registry', () => {
    const extension = loadLinguisticGraph({
      schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: [{ id: 'surface', kind: 'surface' }, { id: 'context', kind: 'x-future::context', learnableCapabilities: ['x-future::access'] }],
      relations: [{ from: 'surface', to: 'context', type: 'x-future::attached' }],
    });
    const result = buildKnowledgeProjection(extension, 'surface', [{ t: 1, kind: 'rating', source: 'manual', quality: 'fluent', easeAfter: 2.6,
      targetRef: { kind: 'x-future::context', id: 'context', capability: 'x-future::access' } }], policy, 10);
    expect(result.targets.find(target => target.targetRef.id === 'context')?.states).toEqual([
      expect.objectContaining({ capability: 'x-future::access', classification: 'known', basis: 'evidence' }),
    ]);
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

  it('attaches graph-attested compound support to predicted targets', () => {
    const compoundGraph = loadLinguisticGraph({
      schemaVersion: 1,
      language: 'de',
      generatedAt: '',
      sourceVersions: {},
      entities: [
        { id: 'de:surface:unseen', kind: 'surface', label: 'Unseenword' },
        { id: 'de:surface:papa', kind: 'surface', label: 'Papa' },
        { id: 'de:surface:hand', kind: 'surface', label: 'Hand' },
        { id: 'de:entry:unseen', kind: 'dictionary-entry', label: 'Unseenword' },
        { id: 'de:sense:unseen', kind: 'sense', label: 'meaning' },
      ],
      relations: [
        { from: 'de:surface:papa', to: 'de:surface:unseen', type: 'component-of' },
        { from: 'de:surface:hand', to: 'de:surface:unseen', type: 'component-of' },
        { from: 'de:entry:unseen', to: 'de:sense:unseen', type: 'has-sense' },
        { from: 'de:entry:unseen', to: 'de:surface:unseen', type: 'realizes' },
      ],
    });
    const support = {
      analysis: attestedCompoundAnalysis(compoundGraph, 'de:surface:unseen')!,
      isKnownPart: (lemma: string) => lemma === 'Papa',
    };
    expect(support.analysis).toMatchObject({ source: 'attested', ambiguous: false });
    const result = buildKnowledgeProjection(compoundGraph, 'de:surface:unseen', [], policy, undefined, undefined, { compound: support });
    const senseState = result.targets
      .find((target) => target.targetRef.id === 'de:sense:unseen')
      ?.states.find((state) => state.capability === 'sense-recognition');
    expect(senseState).toMatchObject({ classification: 'predicted', basis: 'prediction' });
    expect(senseState?.prediction?.reasons.length).toBeGreaterThan(0);
    // Without compound support the same unseen target stays unmeasured.
    const bare = buildKnowledgeProjection(compoundGraph, 'de:surface:unseen', [], policy);
    const bareState = bare.targets
      .find((target) => target.targetRef.id === 'de:sense:unseen')
      ?.states.find((state) => state.capability === 'sense-recognition');
    expect(bareState).toMatchObject({ classification: 'unmeasured', basis: 'unmeasured' });
  });
});
describe('modeling-grade latency in projected evidence', () => {
  it('projects active latency when recorded, wall fallback for legacy rows, nothing for stalled rows', () => {
    const result = buildKnowledgeProjection(graph, surfaceId, [
      { t: 1, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2, rating: 'good', quality: 'fluent', attemptId: 'active', latencyMs: 60_000, activeLatencyMs: 900 },
      { t: 2, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2, rating: 'good', quality: 'struggled', attemptId: 'legacy', latencyMs: 42 },
      { t: 3, kind: 'rating', source: 'anki', aspect: 'meaning', easeAfter: 2, rating: 'good', quality: 'missed', attemptId: 'stalled', latencyMs: 400_000, activeLatencyMs: 400_000, stalled: true },
    ], policy, 10);

    const meaning = result.targets.find((target) => target.targetRef.id === surfaceId)!.states.find(state => state.capability === 'sense-recognition')!;
    const byQuality = Object.fromEntries(meaning.evidence.map((row) => [row.quality, row]));
    // Active latency wins over wall: the away-time never becomes modeling input.
    expect(byQuality.fluent).toMatchObject({ latencyMs: 900 });
    // Legacy rows keep their wall latency through the accessor fallback.
    expect(byQuality.struggled).toMatchObject({ latencyMs: 42 });
    // A stall-flagged row carries no trustworthy latency at all.
    expect(byQuality.fluent?.stalled).toBeUndefined();
    const stalledRow = meaning.evidence.find((row) => (row as { stalled?: boolean }).stalled === true);
    expect(stalledRow).toBeDefined();
    expect(stalledRow!.latencyMs).toBeUndefined();
  });

  it('merges archived bucket statistics and discovers archive-only package capabilities', () => {
    const bucketKey = (capability: string): string => `${capability}\u0000surface|${surfaceId}|`;
    const measurableKnownFold = emptyKeyFold();
    applyEventToFold(measurableKnownFold, { t: 100, kind: 'rating', source: 'srs', aspect: 'meaning', easeAfter: 3.2, rating: 'good', timesSeenDelta: 1 }, 3);
    const bucket = (capability: string): KeyArchive['buckets'][string] => ({
      fold: measurableKnownFold,
      measurableFold: measurableKnownFold,
      transitions: { lapsedAfterFirstKnown: false },
      ratings: [],
      latency: { count: 0, sum: 0 },
      rowCount: 2,
      methodStats: { inference: 2, inferenceSuccess: 1 },
      sourceSeen: { srs: 7 },
      lastDirect: { t: 555, seq: 9 },
    });
    const archive: KeyArchive = {
      v: 2,
      frontierT: 5000,
      frontierSeq: 10,
      acquisitionCutoff: Number.NEGATIVE_INFINITY,
      buckets: {
        [bucketKey('sense-recognition')]: bucket('sense-recognition'),
        [bucketKey('x-test::glyph-tone')]: bucket('x-test::glyph-tone'),
      },
      archivedEventCount: 4,
      ankiReviewIds: [],
      weekPoints: [],
    };
    const result = buildKnowledgeProjection(graph, surfaceId, [], policy, 10_000, undefined, { archives: [archive] });
    const senseState = result.targets
      .find((target) => target.targetRef.id === surfaceId)
      ?.states.find((state) => state.capability === 'sense-recognition');
    // Archived sufficient statistics surface exactly like exact-row counters.
    expect(senseState?.evidenceSourceCounts).toEqual({ srs: 7 });
    expect(senseState?.lastDirectSuccess).toBe(555);
    expect(senseState?.classification).toBe('known');
    // Archive-only package capability survives compaction as an inert state.
    const packageState = result.targets
      .find((target) => target.targetRef.id === surfaceId)
      ?.states.find((state) => state.capability === 'x-test::glyph-tone');
    expect(packageState).toBeDefined();
    expect(packageState?.evidenceSourceCounts).toEqual({ srs: 7 });
    expect(packageState?.lastDirectSuccess).toBe(555);
    const withoutSurface = { ...graph, nodes: new Map([...graph.nodes].filter(([id]) => id !== surfaceId)) };
    const retained = buildKnowledgeProjection(withoutSurface, surfaceId, [], policy, 10_000, undefined, { archives: [archive] });
    expect(retained.lexical?.overall).toEqual({ classification: 'known', basis: 'evidence' });
    const retainedSurface = retained.targets.find(target => target.targetRef.id === surfaceId)!;
    expect(retainedSurface.applicableCapabilities).toEqual([]);
    expect(retainedSurface.states.find(state => state.capability === 'x-test::glyph-tone')?.evidenceSourceCounts).toEqual({ srs: 7 });
  });
});

it.each([
  [1.4, 'unknown'], [2.1 - 0.000001, 'unknown'], [2.1, 'learning'],
  [2.1 + 0.000001, 'learning'], [2.7 - 0.000001, 'learning'], [2.7, 'known'], [2.7 + 0.000001, 'known'],
] as const)('forwards configured thresholds into target and lexical-summary state at ease %s', (ease, expected) => {
  const result = buildKnowledgeProjection(graph, surfaceId, [
    { t: 1, kind: 'rating', source: 'manual', aspect: 'meaning', easeAfter: ease },
  ], policy, 2, undefined, { thresholds: { learning: 2.1, known: 2.7 } });
  const meaning = result.targets.find(target => target.targetRef.id === surfaceId)?.states.find(state => state.capability === 'sense-recognition');
  expect(meaning).toMatchObject({ classification: expected, basis: 'evidence' });
  expect(result.lexical?.sense).toEqual({ classification: expected, basis: 'evidence' });
});
