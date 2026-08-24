import { SRS_EASE } from '../../shared/constants';
import { assembleTargetExplanation } from '../../shared/graph/explanations';
import type { KnowledgeProjection, KnowledgeProjectionState, KnowledgeProjectionTarget } from '../../shared/graph/ipc';
import { relationsOf, type LingualGraph } from '../../shared/graph/load';
import { learnableTargetsFor } from '../../shared/graph/targets';
import { predictTargetAccessibility } from '../../shared/prediction/supportPredictor';
import type { RetentionPolicy } from '../../shared/srs/retentionScheduler';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

const MAX_EVIDENCE = 20;

export function buildKnowledgeProjection(
  graph: LingualGraph,
  surfaceId: string,
  events: readonly KnowledgeEvent[],
  policy: RetentionPolicy,
  now = Date.now(),
): KnowledgeProjection {
  const surface = graph.nodes.get(surfaceId);
  if (!surface) return { status: 'ready', surfaceId, targets: [] };
  const entries = relationsOf(graph, surfaceId).filter((relation) => relation.type === 'realizes')
    .map((relation) => relation.from === surfaceId ? relation.to : relation.from);
  const entities = [surface, ...entries.flatMap((entryId) => relationsOf(graph, entryId)
    .filter((relation) => relation.type === 'has-sense')
    .map((relation) => relation.from === entryId ? relation.to : relation.from)
    .map((id) => graph.nodes.get(id))
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined))];
  const targets = learnableTargetsFor(graph, entities);
  const groups = new Map<string, KnowledgeProjectionTarget>();

  for (const target of targets) {
    const entity = graph.nodes.get(target.entityId)!;
    const preliminary = assembleTargetExplanation(target.capability, events, policy, now);
    const direct = preliminary.projection;
    const predicted = !direct ? predictTargetAccessibility({
      graph,
      direct,
      target,
      classify: classifyEase,
    }) : undefined;
    const prediction = predicted?.supportPath.length
      ? { value: predicted.pSuccess, reasons: predicted.supportPath.map((path) => `${path.from} → ${path.to} (${path.via})`) }
      : undefined;
    const explanation = assembleTargetExplanation(target.capability, events, policy, now,
      prediction ? { value: prediction.value, because: prediction.reasons } : undefined);
    const active = explanation.evidence;
    const sourceCounts = active.reduce<Record<string, number>>((counts, event) => {
      counts[event.source] = (counts[event.source] ?? 0) + (event.timesSeenDelta ?? 1);
      return counts;
    }, {});
    const state: KnowledgeProjectionState = {
      capability: target.capability,
      classification: explanation.state === 'evidence-backed-known' ? 'known' : explanation.state,
      basis: direct ? 'evidence' : prediction ? 'prediction' : 'unmeasured',
      ...(direct ? { strength: { ease: direct.ease, timesSeen: direct.timesSeen, timesHovered: direct.timesHovered } } : {}),
      ...(lastDirectSuccess(active) !== undefined ? { lastDirectSuccess: lastDirectSuccess(active) } : {}),
      evidence: [...active].sort((a, b) => b.t - a.t).slice(0, MAX_EVIDENCE).map((event) => ({
        timestamp: event.t,
        source: event.source,
        ...(event.quality ?? event.rating ? { quality: event.quality ?? event.rating } : {}),
        ...(event.latencyMs !== undefined ? { latencyMs: event.latencyMs } : {}),
      })),
      evidenceSourceCounts: sourceCounts,
      ...(explanation.retention ? { retention: { pressure: explanation.retention.pressure, dueAt: explanation.retention.dueAt } } : {}),
      ...(prediction ? { prediction } : {}),
    };
    const group = groups.get(entity.id) ?? {
      targetRef: { kind: entity.kind, id: entity.id },
      applicableCapabilities: [],
      states: [],
    };
    group.applicableCapabilities.push(target.capability);
    group.states.push(state);
    groups.set(entity.id, group);
  }
  return { status: 'ready', surfaceId, targets: [...groups.values()] };
}

function classifyEase(ease: number): 'known' | 'learning' | 'unknown' {
  return ease >= SRS_EASE.DEFAULT_KNOWN ? 'known' : ease > SRS_EASE.MIN ? 'learning' : 'unknown';
}

function lastDirectSuccess(events: readonly import('../../shared/knowledgeEvents').KnowledgeEvent[]): number | undefined {
  return events.reduce<number | undefined>((latest, event) =>
    event.method === 'recall' && (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy')
      ? Math.max(latest ?? 0, event.t)
      : latest,
  undefined);
}
