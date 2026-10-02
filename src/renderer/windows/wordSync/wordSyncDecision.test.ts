import { describe, expect, it } from 'vitest';
import japaneseMetadata from '../../../../scripts/language-data/language-overrides/ja.metadata.json';
import type { LanguageData } from '../../../shared/types';
import { loadLinguisticGraph } from '../../../shared/graph/load';
import { predictTargetAccessibility } from '../../../shared/prediction/supportPredictor';
import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import { selectWordSyncDecision, wordSyncDecisionWindow } from './wordSyncDecision';

function supportedProjection(): KnowledgeProjection {
  const target = { entityId: 'future:surface:first', capability: 'future::access' };
  const graph = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: { provider: 'v3' },
    entities: ['future::prior', target.entityId].map(id => ({ id, kind: 'surface', ...(id === 'future::prior' ? { label: 'Unfamiliar prior label' } : {}) })),
    relations: [{ from: 'future::prior', to: target.entityId, type: 'future::route', confidence: 1 }] });
  const prediction = predictTargetAccessibility({ graph, direct: null, target, classify: () => 'unknown',
    languageData: { name: 'Future', learning: { capabilities: { 'future::access': { supportRules: [{
      id: 'future::rule', version: '1', relation: 'future::route', sourceCapability: 'future::prior-access', weight: 0.6,
    }] } } } }, sourceKnowledge: () => ({ basis: 'evidence', observationIds: ['prior-attempt'] }) });
  return { status: 'ready', surfaceId: target.entityId, targets: [{ targetRef: { kind: 'surface', id: target.entityId },
    applicableCapabilities: [target.capability], states: [{ capability: target.capability, classification: 'predicted', basis: 'prediction',
      evidence: [], evidenceSourceCounts: {}, prediction: { value: prediction.supportScore, interpretation: 'heuristic-support', contributors: prediction.contributors, reasons: [], model: 'package-support-v2' } }] }] };
}

describe('bounded operational Word Sync decisions', () => {
  const first = { index: 0, key: 'first', word: 'first', language: 'future', surfaceId: 'future:surface:first', possible: ['future::access'], scaffolds: {} };
  const second = { ...first, index: 1, key: 'second', word: 'second', surfaceId: 'future:surface:second' };

  it('changes a real candidate choice using authorized source evidence and preserves the same-pool baseline/task', () => {
    const result = selectWordSyncDecision({ id: 'choice-1', at: 42, items: [second, { ...first, projection: supportedProjection() }] });
    expect(result?.index).toBe(0);
    expect(result?.decision.baseline?.key).toBe('second');
    expect(result?.decision.selected.targets).toEqual([{ kind: 'surface', id: first.surfaceId, capability: 'future::access' }]);
    expect(result?.decision.selected.task.requested).toEqual(['future::access']);
    expect(result?.decision.detail.sourceLabels).toEqual(['Unfamiliar prior label']);
    expect(result?.decision.detail.trace).toMatchObject({ inputs: { candidateCount: 2, selection: 'ranked', rng: { draws: [] } } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('does not use exact sense support or a scaffold-supplied access as evidence for a plain word task', () => {
    const projection = supportedProjection();
    projection.targets[0].targetRef = { kind: 'sense', id: 'future::sense' };
    const unsupported = selectWordSyncDecision({ id: 'choice-2', at: 42, items: [{ ...first, projection }, second] });
    expect(unsupported?.decision.selected.key).toBe(unsupported?.decision.baseline?.key);
    expect(unsupported?.decision.selected.targets.every(target => target.kind === 'surface')).toBe(true);
    expect(selectWordSyncDecision({ id: 'choice-3', at: 42, items: [{ ...first,
      possible: ['surface-reading'], scaffolds: { reading: true } }] })).toBeNull();
  });

  it('uses the shipped spelling-check rule as weak priority without manufacturing spelling knowledge', () => {
    const target = { entityId: 'ja:surface:spelling', capability: 'surface-recognition' };
    const sourceId = 'ja:surface:prior-form';
    const graph = loadLinguisticGraph({ schemaVersion: 1, language: 'ja', generatedAt: '', sourceVersions: {},
      entities: [{ id: target.entityId, kind: 'surface' }, { id: sourceId, kind: 'surface' }, { id: 'ja:entry:shared', kind: 'dictionary-entry' }],
      relations: [{ from: target.entityId, to: 'ja:entry:shared', type: 'realizes' }, { from: sourceId, to: 'ja:entry:shared', type: 'realizes' }] });
    const prediction = predictTargetAccessibility({ graph, target, direct: null,
      languageData: { name: 'Japanese', ...japaneseMetadata } as LanguageData,
      classify: access => access.entityId === sourceId && access.capability === 'sense-recognition' ? 'known' : 'unknown',
      sourceKnowledge: access => access.entityId === sourceId ? { basis: 'evidence', observationIds: ['actual-meaning-attempt'] } : null });
    expect(prediction.contributors).toHaveLength(1);
    expect(prediction.contributors[0]).toMatchObject({ rule: { id: 'ja:lexical-familiarity-spelling', version: '1', weight: 0.1 },
      source: { entityId: sourceId, capability: 'sense-recognition' }, basis: 'evidence' });
    const projection: KnowledgeProjection = { status: 'ready', surfaceId: target.entityId, targets: [{ targetRef: { kind: 'surface', id: target.entityId },
      applicableCapabilities: [target.capability], states: [{ capability: target.capability, classification: 'predicted', basis: 'prediction', evidence: [], evidenceSourceCounts: {},
        prediction: { interpretation: 'heuristic-support', value: prediction.supportScore, model: 'package-support-v2', reasons: [], contributors: prediction.contributors } }] }] };
    const unsupported = { ...second, language: 'ja', possible: [target.capability] };
    const selected = selectWordSyncDecision({ id: 'shipped-rule', at: 1, items: [unsupported, { ...first, language: 'ja', surfaceId: target.entityId, possible: [target.capability], projection }] });
    expect(selected?.decision.baseline?.key).toBe(unsupported.key);
    expect(selected?.decision.selected.targets).toEqual([{ kind: 'surface', id: target.entityId, capability: target.capability }]);
    expect(selected?.decision.selected.key).toBe(first.key);
  });

  it('keeps the level/direction anchor but bounds projection work to eight unvisited entries at that same level', () => {
    const queue = Array.from({ length: 20 }, (_, index) => ({ id: String(index) }));
    const entries = new Map(queue.map((entry, index) => [entry.id, { level: index < 10 ? 1 : 2 }]));
    const result = wordSyncDecisionWindow({ queue, index: 4, visited: [0, 2] }, entries);
    expect(result).toHaveLength(8);
    expect(result.every(index => index < 10 && index !== 0 && index !== 2)).toBe(true);
    expect(result[0]).toBe(4);
    expect(wordSyncDecisionWindow({ queue, index: 20, visited: [] }, entries)).toEqual([]);
  });
});
