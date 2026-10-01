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
});
