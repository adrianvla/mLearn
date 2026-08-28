import { SRS_EASE, type WordStatus } from '../../shared/constants';
import { assembleTargetExplanation } from '../../shared/graph/explanations';
import type { KnowledgeProjection, KnowledgeProjectionClassification, KnowledgeProjectionState, KnowledgeProjectionTarget } from '../../shared/graph/ipc';
import { ASPECT_CAPABILITY, type CapabilityKind } from '../../shared/graph/types';
import { relationsOf, type LingualGraph } from '../../shared/graph/load';
import { learnableTargetsFor } from '../../shared/graph/targets';
import { predictTargetAccessibility } from '../../shared/prediction/supportPredictor';
import type { RetentionPolicy } from '../../shared/srs/retentionScheduler';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

const MAX_EVIDENCE = 20;

/**
 * Word-level explicit claims (kind 'claim', aspect 'meaning') express the
 * learner's meaning knowledge; they override ONLY meaning-scoped capabilities.
 * Reading/pronunciation/prosody/gender stay orthogonal and never inherit a
 * meaning claim (Tier-2 invariant).
 */
const MEANING_CAPABILITIES: ReadonlySet<CapabilityKind> = new Set(['sense-recognition', 'surface-recognition']);

function isMeaningScopedCapability(capability: CapabilityKind): boolean {
  return MEANING_CAPABILITIES.has(capability);
}

/** Claim status → displayed classification; an unknown claim reads as unmeasured until evidence arrives. */
export function claimClassification(status: WordStatus): KnowledgeProjectionClassification {
  return status === 'known' ? 'known' : status === 'learning' ? 'learning' : 'unmeasured';
}

/**
 * Scopes claim events to the capability they actually govern. Evidence rows
 * pass through unchanged; a claim (word-level 'meaning' or a mapped aspect
 * claim) only reaches its own capability — it must never masquerade as
 * evidence for an orthogonal skill (e.g. a meaning claim on surface-reading).
 */
function claimAppliesToCapability(event: KnowledgeEvent, capability: CapabilityKind): boolean {
  if (event.kind !== 'claim') return true;
  if (event.aspect === 'meaning') return isMeaningScopedCapability(capability);
  if (event.aspect === 'grammar') return false;
  return ASPECT_CAPABILITY[event.aspect] === capability;
}

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
    const capabilityEvents = events.filter((event) => claimAppliesToCapability(event, target.capability));
    const preliminary = assembleTargetExplanation(target.capability, capabilityEvents, policy, now);
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
    const explanation = assembleTargetExplanation(target.capability, capabilityEvents, policy, now,
      prediction ? { value: prediction.value, because: prediction.reasons } : undefined);
    const active = explanation.evidence;
    const sourceCounts = active.reduce<Record<string, number>>((counts, event) => {
      counts[event.source] = (counts[event.source] ?? 0) + (event.timesSeenDelta ?? 1);
      return counts;
    }, {});
    // Active meaning claim overrides classification/basis for meaning-scoped
    // capabilities; a cleared claim (no toStatus) falls back to evidence.
    const claim = isMeaningScopedCapability(target.capability) ? explanation.projection?.claim : undefined;
    const state: KnowledgeProjectionState = {
      capability: target.capability,
      classification: claim ? claimClassification(claim) : explanation.state === 'evidence-backed-known' ? 'known' : explanation.state,
      basis: claim ? 'claim' : direct ? 'evidence' : prediction ? 'prediction' : 'unmeasured',
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

function lastDirectSuccess(events: readonly KnowledgeEvent[]): number | undefined {
  return events.reduce<number | undefined>((latest, event) =>
    event.method === 'recall' && (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy')
      ? Math.max(latest ?? 0, event.t)
      : latest,
  undefined);
}