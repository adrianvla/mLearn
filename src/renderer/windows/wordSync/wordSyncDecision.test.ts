import { describe, expect, it } from 'vitest';
import japaneseMetadata from '../../../../scripts/language-data/language-overrides/ja.metadata.json';
import type { LanguageData } from '../../../shared/types';
import { loadLinguisticGraph } from '../../../shared/graph/load';
import { predictTargetAccessibility } from '../../../shared/prediction/supportPredictor';
import { buildKnowledgeProjection } from '../../../shared/knowledge/projectionBuilder';
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

  it.each([['f', 'a'], ['a', 'f']])('attributes shared-entry support to its observed form regardless of source hash order (%s/%s)', (sourceHash, targetHash) => {
    const sourceId = `future:surface:${sourceHash.repeat(64)}`;
    const targetId = `future:surface:${targetHash.repeat(64)}`;
    const g = loadLinguisticGraph({ schemaVersion: 1, language: 'future', generatedAt: '', sourceVersions: { dictionary: 'real-entry-v1' },
      entities: [{ id: sourceId, kind: 'surface', label: 'Observed form' }, { id: targetId, kind: 'surface', label: 'Selected form' },
        { id: 'future:entry:shared', kind: 'dictionary-entry' }, { id: 'future:sense:unresolved', kind: 'sense' }],
      relations: [{ from: sourceId, to: 'future:entry:shared', type: 'realizes' },
        { from: targetId, to: 'future:entry:shared', type: 'realizes' },
        { from: 'future:entry:shared', to: 'future:sense:unresolved', type: 'has-sense' }] });
    const languageData: LanguageData = { name: 'Future package', learning: { capabilities: { 'surface-recognition': { supportRules: [{
      id: 'future:spelling-check', relation: 'realizes', direction: 'out', sourcePath: [{ relation: 'realizes', direction: 'in' }],
      sourceCapability: 'sense-recognition', weight: 0.1, dependencyGroup: 'future:shared-observation',
    }] } } } };
    const event = { t: 1, kind: 'rating' as const, source: 'manual' as const, quality: 'fluent' as const, easeAfter: 2,
      attemptId: 'observed-attempt', presentedSurface: 'Observed form',
      targetRef: { kind: 'surface', id: sourceId, capability: 'sense-recognition' } };
    const projection = buildKnowledgeProjection(g, targetId, [event], undefined, 10, undefined, { languageData });
    const predicted = projection.targets.find(t => t.targetRef.id === targetId)?.states.find(s => s.capability === 'surface-recognition')?.prediction;
    expect(predicted?.contributors).toHaveLength(1);
    expect(predicted?.contributors?.[0]).toMatchObject({ source: { entityId: sourceId, capability: 'sense-recognition' },
      sourceLabel: 'Observed form', observationIds: ['observed-attempt'], credit: 0.1,
      witness: { attemptId: event.attemptId, targetRef: event.targetRef, presentedSurface: event.presentedSurface } });
    const choice = selectWordSyncDecision({ id: 'after-observation', at: 11, items: [
      { ...second, key: 'baseline-unrelated', possible: ['surface-recognition'] },
      { ...first, key: targetId, surfaceId: targetId, possible: ['surface-recognition'], projection },
    ] });
    expect(choice?.decision.selected.key).toBe(targetId);
    expect(choice?.decision.baseline?.key).toBe('baseline-unrelated');
    expect(choice?.decision.detail.sourceLabels).toEqual(['Observed form']);
    expect(JSON.parse(JSON.stringify(choice))).toEqual(choice);
    expect(projection.targets.find(t => t.targetRef.kind === 'sense')?.states[0].classification).toBe('unmeasured');
    const undone = buildKnowledgeProjection(g, targetId, [event, { t: 2, kind: 'retraction', source: 'manual', retracts: event.attemptId }],
      undefined, 10, undefined, { languageData });
    expect(undone.targets.flatMap(t => t.states).every(s => !s.prediction?.contributors?.length)).toBe(true);
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
