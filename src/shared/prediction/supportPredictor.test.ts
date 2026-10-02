import { describe, expect, it } from 'vitest';
import { loadLinguisticGraph } from '../graph/load';
import { predictTargetAccessibility } from './supportPredictor';
import { attestedCompoundAnalysis } from '../graph/morphology/attested';
import { buildKnowledgeProjection } from '../knowledge/projectionBuilder';

const graph = (type = 'derived-from', confidence = 1) => loadLinguisticGraph({
  schemaVersion: 1, language: 'x-test', generatedAt: '', sourceVersions: {},
  entities: [{ id: 'source', kind: 'surface' }, { id: 'target', kind: 'surface' }],
  relations: [{ from: 'source', to: 'target', type, confidence, predictability: 1 }],
});
const input = { graph: graph(), direct: null, target: { entityId: 'target', capability: 'surface-reading' }, classify: () => 'unknown' as const };

describe('learner-grounded support scores', () => {
  it.each([false, true])('preserves dependency allocation and full rule semantics when witness routes share a physical response (colliding ids: %s)', collidingRuleIds => {
    const capability = 'future::next';
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: [{ id: 'target', kind: 'future::discourse', learnableCapabilities: [capability] },
        ...['aaa-alias', 'bbb-observed', 'ccc-independent'].map(id => ({ id, kind: 'surface', label: id })),
        ...['entry1', 'entry2'].map(id => ({ id, kind: 'dictionary-entry' }))],
      relations: [...['aaa-alias', 'bbb-observed'].map(from => ({ from, to: 'entry1', type: 'realizes' })),
        { from: 'ccc-independent', to: 'entry2', type: 'realizes' },
        ...['aaa-alias', 'ccc-independent'].map(from => ({ from, to: 'target', type: 'future::group1' })),
        { from: 'bbb-observed', to: 'target', type: 'future::group2' }] });
    const languageData = { name: 'Future', learning: { capabilities: { [capability]: { supportRules: [
      { id: collidingRuleIds ? 'shared-rule-id' : 'rule1', relation: 'future::group1', sourceCapability: 'sense-recognition', weight: 0.1, dependencyGroup: 'group1' },
      { id: collidingRuleIds ? 'shared-rule-id' : 'rule2', relation: 'future::group2', sourceCapability: 'sense-recognition', weight: 0.1, dependencyGroup: collidingRuleIds ? 'group1' : 'group2' },
    ] } } } };
    // One real response resolves through both forms of entry1. Another
    // independent response occupies the first rule's declared dependency group.
    const events = ['bbb-observed', 'ccc-independent'].map((id, index) => ({
      t: index + 1, kind: 'rating' as const, source: 'manual' as const, quality: 'fluent' as const,
      easeAfter: 3, attemptId: `physical${index + 1}`,
      targetRef: { kind: 'surface', id, capability: 'sense-recognition' },
    }));
    const projected = buildKnowledgeProjection(g, 'target', events, undefined, 10, undefined, { languageData });
    const prediction = projected.targets.find(target => target.targetRef.id === 'target')?.states
      .find(state => state.capability === capability)?.prediction;
    const withoutWitness = predictTargetAccessibility({ graph: g, direct: null, target: { entityId: 'target', capability },
      classify: () => 'unknown', languageData, sourceKnowledge: source => ({ basis: 'evidence',
        observationIds: [source.entityId === 'ccc-independent' ? 'physical2' : 'physical1'] }) });
    expect(prediction?.contributors).toHaveLength(1);
    expect(prediction?.contributors?.[0]).toMatchObject({ source: { entityId: 'aaa-alias' },
      rule: { id: collidingRuleIds ? 'shared-rule-id' : 'rule1', dependencyGroup: 'group1' }, credit: 0.1, observationIds: ['physical1'],
      witness: { targetRef: events[0].targetRef } });
    expect(prediction?.value).toBeCloseTo(withoutWitness.supportScore);
    expect(prediction?.contributors?.map(contributor => contributor.credit))
      .toEqual(withoutWitness.contributors.map(contributor => contributor.credit));
  });

  it.each([false, true])('prefers the actual witness among equal-credit opaque sources independent of insertion order (%s)', reverse => {
    const target = { entityId: 'target', capability: 'future::unknown-access' };
    const sourceCapability = 'future::unknown-context';
    const entities = [{ id: 'aaa-alias', kind: 'future::discourse', label: 'Semantic alias' },
      { id: 'zzz-observed', kind: 'future::discourse', label: 'Observed context' }, { id: target.entityId, kind: 'future::discourse' }];
    const relations = ['aaa-alias', 'zzz-observed'].map(from => ({ from, to: target.entityId, type: 'future::context-link' }));
    const witness = { attemptId: 'one-physical-response', targetRef: { kind: 'future::discourse', id: 'zzz-observed',
      capability: sourceCapability, to: 'future::listener', opaque: { unregistered: [1, 'new'] } } };
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: reverse ? entities.reverse() : entities, relations: reverse ? relations.reverse() : relations });
    const languageData = { name: 'Future', learning: { capabilities: { [target.capability]: { supportRules: [{
      relation: 'future::context-link', sourceCapability, weight: 0.4, dependencyGroup: 'one-observation',
    }] } } } };
    const result = predictTargetAccessibility({ ...input, graph: g, target, languageData,
      sourceKnowledge: () => ({ basis: 'evidence', observationIds: [witness.attemptId], witness }) });
    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0]).toMatchObject({ source: { entityId: 'zzz-observed', capability: sourceCapability },
      sourceLabel: 'Observed context', witness, credit: 0.4 });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    witness.targetRef.opaque.unregistered.push('later-mutation');
    expect(result.contributors[0].witness?.targetRef).toMatchObject({ opaque: { unregistered: [1, 'new'] } });

    const claim = predictTargetAccessibility({ ...input, graph: g, target, languageData,
      sourceKnowledge: () => ({ basis: 'claim', witness }) });
    expect(claim.contributors[0].source.entityId).toBe('aaa-alias');
    expect(claim.contributors[0].witness).toBeUndefined();
    expect(claim.contributors[0].observationIds).toEqual([]);
    const archive = predictTargetAccessibility({ ...input, graph: g, target, languageData,
      sourceKnowledge: () => ({ basis: 'evidence' }) });
    expect(archive.contributors[0].source.entityId).toBe('aaa-alias');
    expect(archive.contributors[0].witness).toBeUndefined();
    expect(archive.contributors[0].observationIds).toEqual([]);
    const unmatched = predictTargetAccessibility({ ...input, graph: g, target, languageData,
      sourceKnowledge: () => ({ basis: 'evidence', observationIds: ['other-response'], witness }) });
    expect(unmatched.contributors[0].source.entityId).toBe('aaa-alias');
    expect(unmatched.contributors[0].witness).toBeUndefined();
  });

  it('does not turn a relation category into package authorization', () => {
    expect(predictTargetAccessibility({ ...input, sourceKnowledge: () => 'evidence' }).supportPath).toEqual([]);
  });
  it('does not universalize decomposition, entry familiarity, or component counts into unknown capabilities', () => {
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: ['source', 'other', 'target'].map(id => ({ id, kind: 'surface', label: id })),
      relations: ['source', 'other'].map(from => ({ from, to: 'target', type: 'component-of', confidence: 1 })) });
    const request = { ...input, graph: g, target: { entityId: 'target', capability: 'future::unfamiliar-access' } };
    const baseline = predictTargetAccessibility(request);
    expect(predictTargetAccessibility({ ...request,
      compound: { analysis: attestedCompoundAnalysis(g, 'target')!, isKnownPart: () => true },
      entry: { entryId: 'source', senseKnown: true, spokenKnown: true }, characters: { known: 2, total: 2 },
    })).toEqual(baseline);
  });
  it('does not double count a declared source through a parallel decomposition hint', () => {
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: ['source', 'other', 'target'].map(id => ({ id, kind: 'surface', label: id })),
      relations: ['source', 'other'].map(from => ({ from, to: 'target', type: 'component-of', confidence: 1 })) });
    const request = { ...input, graph: g, languageData: { name: 'Future', learning: { capabilities: {
      'surface-reading': { supportRules: [{ relation: 'component-of', sourceCapability: 'future::prior', weight: 0.4 }] },
    } } }, sourceKnowledge: (source: { entityId: string }) => source.entityId === 'source' ? 'evidence' as const : undefined };
    expect(predictTargetAccessibility({ ...request, compound: {
      analysis: attestedCompoundAnalysis(g, 'target')!, isKnownPart: lemma => lemma === 'source',
    } })).toEqual(predictTargetAccessibility(request));
  });
  it('preserves zero confidence in an inspectable structural assertion', () => {
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: ['source', 'other', 'target'].map(id => ({ id, kind: 'surface', label: id })),
      relations: ['source', 'other'].map(from => ({ from, to: 'target', type: 'component-of', confidence: 0 })) });
    expect(attestedCompoundAnalysis(g, 'target')?.confidence).toBe(0);
  });
  it('grants no structural support when source knowledge is absent', () => {
    expect(predictTargetAccessibility(input).supportPath).toEqual([]);
  });
  it('requires source evidence or an explicit claim and respects relation confidence', () => {
    const sourceKnowledge = () => 'evidence' as const;
    const languageData = { name: 'Future', learning: { capabilities: { 'surface-reading': {
      supportRules: [{ relation: 'derived-from', sourceCapability: 'surface-reading', weight: 0.7 }],
    } } } };
    expect(predictTargetAccessibility({ ...input, languageData, sourceKnowledge }).supportPath).toHaveLength(1);
    expect(predictTargetAccessibility({ ...input, languageData, graph: graph('derived-from', 0), sourceKnowledge }).supportPath).toEqual([]);
    expect(predictTargetAccessibility({ ...input, graph: graph('realizes'), sourceKnowledge }).supportPath).toEqual([]);
    expect(predictTargetAccessibility({ ...input, graph: graph('contrasts-with'), sourceKnowledge }).supportPath).toEqual([]);
  });
  it('allows a package to declare unfamiliar source accesses and relation semantics', () => {
    const result = predictTargetAccessibility({ ...input, graph: graph('x-test::context-link'),
      target: { entityId: 'target', capability: 'x-test::unfamiliar-access' },
      languageData: { name: 'Future', learning: { capabilities: { 'x-test::unfamiliar-access': {
        supportRules: [{ relation: 'x-test::context-link', sourceCapability: 'x-test::prior-context', weight: 0.4 }],
      } } } },
      sourceKnowledge: (source) => source.entityId === 'source' && source.capability === 'x-test::prior-context' ? 'evidence' : undefined,
    });
    expect(result.supportPath).toEqual([expect.objectContaining({ from: 'source', to: 'target', via: 'x-test::context-link' })]);
  });
  it('does not gain confidence from duplicate edges or repeated rules for the same source access', () => {
    const asset = {
      schemaVersion: 1 as const, language: 'future', generatedAt: '', sourceVersions: {},
      entities: [{ id: 'source', kind: 'surface' }, { id: 'target', kind: 'surface' }],
      relations: [{ from: 'source', to: 'target', type: 'future::link', confidence: 0.8 }],
    };
    const rule = { relation: 'future::link', sourceCapability: 'future::prior', weight: 0.4 };
    const request = { ...input, graph: loadLinguisticGraph(asset), target: { entityId: 'target', capability: 'future::access' },
      languageData: { name: 'Future', learning: { capabilities: { 'future::access': { supportRules: [rule] } } } },
      sourceKnowledge: () => 'evidence' as const };
    const single = predictTargetAccessibility(request);
    const repeated = predictTargetAccessibility({ ...request,
      graph: loadLinguisticGraph({ ...asset, relations: Array.from({ length: 10 }, (_, i) => ({ ...asset.relations[0], provenance: `provider-${i}` })) }),
      languageData: { name: 'Future', learning: { capabilities: { 'future::access': { supportRules: [rule, rule] } } } },
    });
    expect(repeated.supportScore).toEqual(single.supportScore);
    expect(repeated.uncertainty).toEqual(single.uncertainty);
    expect(repeated.supportPath).toEqual(single.supportPath);
    expect(repeated.contributors).toHaveLength(1);
  });

  it('resolves outgoing multi-hop assertions with their exact capabilities and provenance', () => {
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: { provider: 'v7' },
      entities: ['source', 'middle', 'target'].map(id => ({ id, kind: 'future::entity', features: { 'future::unknown': { values: [7] } } })),
      relations: [{ from: 'target', to: 'middle', type: 'future::anchors', confidence: 0.5 },
        { from: 'source', to: 'middle', type: 'future::member', confidence: 0.8 }] });
    const result = predictTargetAccessibility({ ...input, graph: g, target: { entityId: 'target', capability: 'future::access' },
      languageData: { name: 'Future', learning: { capabilities: { 'future::access': { supportRules: [{
        id: 'future::rule', version: '3', relation: 'future::anchors', direction: 'out',
        sourcePath: [{ relation: 'future::member', direction: 'in' }], sourceCapability: 'future::context', weight: 0.6,
      }] } } } }, sourceKnowledge: source => source.entityId === 'source' && source.capability === 'future::context'
        ? { basis: 'evidence', observationIds: ['physical-attempt'] } : undefined });
    expect(result.supportScore).toBeCloseTo(0.17);
    expect(result.contributors).toEqual([expect.objectContaining({ source: { entityId: 'source', capability: 'future::context' },
      target: { entityId: 'target', capability: 'future::access' }, basis: 'evidence', observationIds: ['physical-attempt'],
      package: { language: 'future', sourceVersions: { provider: 'v7' } },
      rule: { id: 'future::rule', version: '3', weight: 0.6 }, assertionConfidence: 0.4, calibration: 1, credit: 0.24 })]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(g.nodes.get('source')?.features).toEqual({ 'future::unknown': { values: [7] } });
  });

  it('does not treat accesses from the same physical observation as independent', () => {
    const result = predictTargetAccessibility({ ...input, sourceKnowledge: () => ({ basis: 'evidence', observationIds: ['one-attempt'] }),
      languageData: { name: 'Future', learning: { capabilities: { 'surface-reading': { supportRules: [
        { relation: 'derived-from', sourceCapability: 'future::first', weight: 0.4 },
        { relation: 'derived-from', sourceCapability: 'future::second', weight: 0.6 },
      ] } } } } });
    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0].source.capability).toBe('future::second');
    expect(result.supportScore).toBeCloseTo(0.35);
  });

  it('uses one declared transfer context and applies calibration once', () => {
    const request = { ...input, sourceKnowledge: () => 'evidence' as const,
      languageData: { name: 'Future', learning: { capabilities: { 'surface-reading': { supportRules: [{
        relation: 'derived-from', sourceCapability: 'future::prior', weight: 0.5, transferContext: 'future::context',
      }] } } } } };
    const baseline = predictTargetAccessibility(request);
    expect(predictTargetAccessibility({ ...request, inferenceSuccess: { attempts: 2, successes: 2 },
      transferHistory: { unrelated: { attempts: 2, successes: 2 } } })).toEqual(baseline);
    const calibrated = predictTargetAccessibility({ ...request, transferHistory: { 'future::context': { attempts: 2, successes: 2 } } });
    expect(calibrated.supportScore).toBeCloseTo(0.425);
    expect(calibrated.contributors[0].calibration).toBe(1.5);
  });

  it('allows package-declared support between distinct accesses on one entity', () => {
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: [{ id: 'target', kind: 'future::context' }],
      relations: [{ from: 'target', to: 'target', type: 'future::within' }] });
    const result = predictTargetAccessibility({ ...input, graph: g, target: { entityId: 'target', capability: 'future::next' },
      languageData: { name: 'Future', learning: { capabilities: { 'future::next': { supportRules: [{
        relation: 'future::within', sourceCapability: 'future::prior', weight: 0.4,
      }] } } } }, sourceKnowledge: source => source.capability === 'future::prior' ? 'evidence' : undefined });
    expect(result.contributors).toHaveLength(1);
    expect(result.contributors[0].source).toEqual({ entityId: 'target', capability: 'future::prior' });
  });

  it('does not exhaust path budgets on equivalent providers of one source assertion', () => {
    const asset = graph().asset;
    const request = { ...input, sourceKnowledge: () => 'evidence' as const,
      languageData: { name: 'Future', learning: { capabilities: { 'surface-reading': { supportRules: [{
        relation: 'derived-from', sourceCapability: 'future::prior', weight: 0.4,
      }] } } } } };
    const duplicate = loadLinguisticGraph({ ...asset, relations: Array.from({ length: 257 }, (_, index) => ({
      ...asset.relations[0], provenance: `provider-${index}`,
    })) });
    expect(predictTargetAccessibility({ ...request, graph: duplicate }).supportScore)
      .toEqual(predictTargetAccessibility(request).supportScore);
  });

  it('reports unavailable support instead of choosing an arbitrary prefix of a broad rule', () => {
    const sources = Array.from({ length: 257 }, (_, i) => `source-${i}`);
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: {},
      entities: ['target', ...sources].map(id => ({ id, kind: 'future::entity' })),
      relations: sources.map(from => ({ from, to: 'target', type: 'future::link' })) });
    const result = predictTargetAccessibility({ ...input, graph: g, sourceKnowledge: () => 'evidence',
      languageData: { name: 'Future', learning: { capabilities: { 'surface-reading': { supportRules: [{
        id: 'future::broad-rule', relation: 'future::link', sourceCapability: 'future::prior', weight: 0.4,
      }] } } } } });
    expect(result.contributors).toEqual([]);
    expect(result.limits).toEqual(['support-path-budget:future::broad-rule']);
  });

  it('rejects malformed known dependency fields while preserving unrelated opaque metadata', () => {
    const rule = { relation: 'derived-from', sourceCapability: 'future::prior', weight: 0.4, dependencyGroup: ['shared'] };
    const languageData = { name: 'Future', learning: { capabilities: { 'surface-reading': { supportRules: [rule] } } } };
    const result = predictTargetAccessibility({ ...input, sourceKnowledge: () => 'evidence',
      languageData: languageData as unknown as import('../types').LanguageData });
    expect(result.contributors).toEqual([]);
    expect(result.limits).toContain('invalid-support-rule');
    expect(rule.dependencyGroup).toEqual(['shared']);
  });
  it('takes the strongest path for one source access, independent of edge ordering', () => {
    const asset = { schemaVersion: 1 as const, language: 'future', generatedAt: '', sourceVersions: {},
      entities: [{ id: 'source', kind: 'surface' }, { id: 'target', kind: 'surface' }],
      relations: [
        { from: 'source', to: 'target', type: 'future::weak', confidence: 1 },
        { from: 'source', to: 'target', type: 'future::strong', confidence: 1 },
      ] };
    const request = { ...input, graph: loadLinguisticGraph(asset), target: { entityId: 'target', capability: 'future::access' },
      languageData: { name: 'Future', learning: { capabilities: { 'future::access': { supportRules: [
        { relation: 'future::weak', sourceCapability: 'future::prior', weight: 0.2 },
        { relation: 'future::strong', sourceCapability: 'future::prior', weight: 0.6 },
      ] } } } }, sourceKnowledge: () => 'evidence' as const };
    const result = predictTargetAccessibility(request);
    expect(result.supportPath).toEqual([{ from: 'source', to: 'target', via: 'future::strong' }]);
    expect(result.uncertainty).toBeCloseTo(0.4);
    expect(predictTargetAccessibility({ ...request, graph: loadLinguisticGraph({ ...asset, relations: [...asset.relations].reverse() }) })).toEqual(result);
  });

});
