import { describe, expect, it } from 'vitest';
import { loadLinguisticGraph } from '../graph/load';
import { predictTargetAccessibility } from './supportPredictor';

const graph = (type = 'derived-from', confidence = 1) => loadLinguisticGraph({
  schemaVersion: 1, language: 'x-test', generatedAt: '', sourceVersions: {},
  entities: [{ id: 'source', kind: 'surface' }, { id: 'target', kind: 'surface' }],
  relations: [{ from: 'source', to: 'target', type, confidence, predictability: 1 }],
});
const input = { graph: graph(), direct: null, target: { entityId: 'target', capability: 'surface-reading' }, classify: () => 'unknown' as const };

describe('learner-grounded support scores', () => {
  it('grants no structural support when source knowledge is absent', () => {
    expect(predictTargetAccessibility(input).supportPath).toEqual([]);
  });
  it('requires source evidence or an explicit claim and respects relation confidence', () => {
    const sourceKnowledge = () => 'evidence' as const;
    expect(predictTargetAccessibility({ ...input, sourceKnowledge }).supportPath).toHaveLength(1);
    expect(predictTargetAccessibility({ ...input, graph: graph('derived-from', 0), sourceKnowledge }).supportPath).toEqual([]);
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
    expect(repeated).toEqual(single);
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
