import type { WordStatus } from '../../shared/constants';
import { assembleTargetExplanation, type TargetState } from '../../shared/graph/explanations';
import type { KnowledgeProjection, KnowledgeProjectionBasis, KnowledgeProjectionClassification, KnowledgeProjectionState, KnowledgeProjectionTarget } from '../../shared/graph/ipc';
import { relationsOf, type LingualGraph } from '../../shared/graph/load';
import { learnableTargetsFor } from '../../shared/graph/targets';
import { predictTargetAccessibility } from '../../shared/prediction/supportPredictor';
import { easeToStatus } from '../../shared/utils/knowledgeStrength';
import { DEFAULT_ENABLED_DOMAINS, type GraphDomain, type GraphEntity } from '../../shared/graph/types';
import type { RetentionPolicy } from '../../shared/srs/retentionScheduler';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

const MAX_EVIDENCE = 20;

/** Claim status → displayed classification; an unknown claim is an actual negative state, never unmeasured. */
export function claimClassification(status: WordStatus): KnowledgeProjectionClassification {
  return status === 'known' ? 'known' : status === 'learning' ? 'learning' : 'unknown';
}

/** One TargetState → (classification, basis) mapping; claims never masquerade as evidence. */
function classificationOf(state: TargetState): { classification: KnowledgeProjectionClassification; basis: KnowledgeProjectionBasis } {
  switch (state) {
    case 'evidence-backed-known': return { classification: 'known', basis: 'evidence' };
    case 'claimed-known': return { classification: claimClassification('known'), basis: 'claim' };
    case 'claimed-learning': return { classification: claimClassification('learning'), basis: 'claim' };
    case 'claimed-unknown': return { classification: claimClassification('unknown'), basis: 'claim' };
    case 'learning': return { classification: 'learning', basis: 'evidence' };
    case 'unknown': return { classification: 'unknown', basis: 'evidence' };
    case 'predicted': return { classification: 'predicted', basis: 'prediction' };
    case 'unmeasured': return { classification: 'unmeasured', basis: 'unmeasured' };
  }
}

/**
 * Builds the canonical per-surface learning projection. Specialized domains
 * (names etc.) stay out of ordinary learning/prediction: a domain-excluded
 * surface yields zero learnable targets, and domain-excluded entries/senses
 * reached through a shared homograph surface never generate targets either.
 * Explicit inspection surfaces (lookup/neighborhood) stay unfiltered.
 */
export function buildKnowledgeProjection(
  graph: LingualGraph,
  surfaceId: string,
  events: readonly KnowledgeEvent[],
  policy: RetentionPolicy,
  now = Date.now(),
  enabledDomains: readonly GraphDomain[] = DEFAULT_ENABLED_DOMAINS,
): KnowledgeProjection {
  const domainEnabled = (entity: GraphEntity | undefined): entity is GraphEntity =>
    entity !== undefined && (!entity.domain || enabledDomains.includes(entity.domain));
  const surface = graph.nodes.get(surfaceId);
  if (!domainEnabled(surface)) return { status: 'ready', surfaceId, targets: [] };
  const entries = relationsOf(graph, surfaceId).filter((relation) => relation.type === 'realizes')
    .map((relation) => relation.from === surfaceId ? relation.to : relation.from);
  // One entry can list the same sense/lexeme several times (bank duplication
  // in package data); visiting an entity twice would emit the same
  // (entity, capability) state twice into the projection payload.
  const entityIds = new Set<string>([surfaceId, ...entries.flatMap((entryId) => relationsOf(graph, entryId)
    .filter((relation) => relation.type === 'has-sense')
    .map((relation) => relation.from === entryId ? relation.to : relation.from))]);
  const entities = [...entityIds]
    .map((id) => graph.nodes.get(id))
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined)
    .filter(domainEnabled);
  const targets = learnableTargetsFor(graph, entities);
  const groups = new Map<string, KnowledgeProjectionTarget>();

  for (const target of targets) {
    const entity = graph.nodes.get(target.entityId)!;
    // Capability scoping (aspect → capability, claim vs evidence, grammar
    // targetRef routing) lives inside assembleTargetExplanation so every
    // consumer of the resolver agrees.
    const preliminary = assembleTargetExplanation(target.capability, events, policy, now);
    const direct = preliminary.projection;
    const predicted = !direct ? predictTargetAccessibility({
      graph,
      direct,
      target,
      classify: easeToStatus,
    }) : undefined;
    const prediction = predicted?.supportPath.length
      ? { value: predicted.pSuccess, reasons: predicted.supportPath.map((path) => `${path.from} → ${path.to} (${path.via})`) }
      : undefined;
    const explanation = prediction
      ? assembleTargetExplanation(target.capability, events, policy, now, { value: prediction.value, because: prediction.reasons })
      : preliminary;
    const { classification, basis } = classificationOf(explanation.state);
    const active = explanation.evidence;
    const sourceCounts = active.reduce<Record<string, number>>((counts, event) => {
      counts[event.source] = (counts[event.source] ?? 0) + (event.timesSeenDelta ?? 1);
      return counts;
    }, {});
    const state: KnowledgeProjectionState = {
      capability: target.capability,
      classification,
      basis,
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

function lastDirectSuccess(events: readonly KnowledgeEvent[]): number | undefined {
  return events.reduce<number | undefined>((latest, event) =>
    event.method === 'recall' && (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy')
      ? Math.max(latest ?? 0, event.t)
      : latest,
  undefined);
}
