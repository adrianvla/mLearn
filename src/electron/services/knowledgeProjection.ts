import type { WordStatus } from '../../shared/constants';
import { assembleTargetExplanation, toJournalRows, type JournalRow, type TargetExplanation } from '../../shared/graph/explanations';
import type { KeyArchive } from '../../shared/knowledge/historyArchive';
import { eventAppliesToTarget, realizedEntryIds } from '../../shared/graph/addressing';
import type { KnowledgeLexicalSummary, KnowledgeProjection, KnowledgeProjectionBasis, KnowledgeProjectionClassification, KnowledgeProjectionState, KnowledgeProjectionTarget } from '../../shared/graph/ipc';
import { relationsOf, type LingualGraph } from '../../shared/graph/load';
import { learnableTargetsFor } from '../../shared/graph/targets';
import { predictTargetAccessibility, type PredictionInput } from '../../shared/prediction/supportPredictor';
import { attemptActiveLatencyMs, readActiveEvidence } from '../../shared/knowledgeEvents';
import { easeToStatus } from '../../shared/utils/knowledgeStrength';
import { DEFAULT_ENABLED_DOMAINS, type CapabilityKey, type GraphDomain, type GraphEntity, type LearnableTarget } from '../../shared/graph/types';
import type { RetentionPolicy } from '../../shared/srs/retentionScheduler';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

const MAX_EVIDENCE = 20;

/** Claim status → displayed classification; an unknown claim is an actual negative state, never unmeasured. */
export function claimClassification(status: WordStatus): KnowledgeProjectionClassification {
  return status === 'known' ? 'known' : status === 'learning' ? 'learning' : 'unknown';
}

/** One TargetState → (classification, basis) mapping; claims never masquerade as evidence. */
function classificationOf(state: TargetExplanation['state']): { classification: KnowledgeProjectionClassification; basis: KnowledgeProjectionBasis } {
  switch (state) {
    case 'claimed-known':
    case 'evidence-backed-known':
      return { classification: 'known', basis: state === 'claimed-known' ? 'claim' : 'evidence' };
    case 'claimed-learning':
    case 'learning':
      return { classification: 'learning', basis: state === 'claimed-learning' ? 'claim' : 'evidence' };
    case 'claimed-unknown':
    case 'unknown':
      return { classification: 'unknown', basis: state === 'claimed-unknown' ? 'claim' : 'evidence' };
    case 'predicted':
      return { classification: 'predicted', basis: 'prediction' };
    case 'unmeasured':
      return { classification: 'unmeasured', basis: 'unmeasured' };
  }
}

/**
 * Graph-relative explanation for one target: evidence is matched by ACCESS
 * ADDRESS (cue entity + capability + retrieved identity), so journaled rows
 * recorded through an authoritative variant surface resolve to the shared
 * lexical object without any state copy — while surface-scoped accesses stay
 * bound to the exact presented surface and homophones stay independent.
 */
function targetExplanation(
  graph: LingualGraph,
  rows: readonly JournalRow[],
  target: LearnableTarget,
  queriedSurfaceId: string,
  policy: RetentionPolicy,
  now: number,
  prediction?: TargetExplanation['prediction'],
  archives?: readonly KeyArchive[],
): TargetExplanation {
  return assembleTargetExplanation(
    target.capability,
    rows,
    policy,
    now,
    prediction,
    (event) => eventAppliesToTarget(graph, event, target, queriedSurfaceId),
    archives,
  );
}

/**
 * Entry-level aggregate for one lexical-identity capability across the
 * surface's authoritative entries. This is the word-level "does the learner
 * know this object by meaning/sound" signal — deliberately independent of
 * which variant surface the evidence arrived through.
 */
function entryCapabilityState(
  graph: LingualGraph,
  rows: readonly JournalRow[],
  entryIds: readonly string[],
  capability: CapabilityKey,
  queriedSurfaceId: string,
  policy: RetentionPolicy,
  now: number,
  archives?: readonly KeyArchive[],
): { classification: KnowledgeProjectionClassification; basis: KnowledgeProjectionBasis } {
  const matched = assembleTargetExplanation(
    capability,
    rows,
    policy,
    now,
    undefined,
    (event) => entryIds.some((entryId) => eventAppliesToTarget(graph, event, { entityId: entryId, capability }, queriedSurfaceId)),
    archives,
  );
  return classificationOf(matched.state);
}

/**
 * Builds the canonical per-surface learning projection. Specialized domains
 * (names etc.) stay out of ordinary learning/prediction: a domain-excluded
 * surface yields zero learnable targets, and domain-excluded entries/senses
 * reached through a shared homograph surface never generate targets either.
 * Explicit inspection surfaces (lookup/neighborhood) stay unfiltered.
 *
 * Callers must pass MERGED journal events for the surface's own key AND its
 * authoritative variant keys (see siblingJournalKeys) — resolution here is
 * address-based, so no per-key re-projection happens.
 */
export function buildKnowledgeProjection(
  graph: LingualGraph,
  surfaceId: string,
  /** Journal rows (stable seq) or plain event arrays (array order = journal order). */
  rawRows: readonly (KnowledgeEvent | JournalRow)[],
  policy: RetentionPolicy,
  now = Date.now(),
  enabledDomains: readonly GraphDomain[] = DEFAULT_ENABLED_DOMAINS,
  /** Graph-attested (primary) or strategy-derived (unseen) compound support. */
  options?: { compound?: PredictionInput['compound']; archives?: readonly KeyArchive[] },
): KnowledgeProjection {
  const rows = toJournalRows(rawRows);
  const events = rows.map(({ event }) => event);
  const domainEnabled = (entity: GraphEntity | undefined): entity is GraphEntity =>
    entity !== undefined && (!entity.domain || enabledDomains.includes(entity.domain));
  const surface = graph.nodes.get(surfaceId);
  if (!domainEnabled(surface)) return { status: 'ready', surfaceId, targets: [] };
  const realizedEntries = realizedEntryIds(graph, surfaceId);
  const entryIds = realizedEntries.filter((id) => domainEnabled(graph.nodes.get(id)));
  // One entry can list the same sense/lexeme several times (bank duplication
  // in package data); visiting an entity twice would emit the same
  // (entity, capability) state twice into the projection payload.
  const entityIds = new Set<string>([surfaceId, ...entryIds.flatMap((entryId) => relationsOf(graph, entryId)
    .filter((relation) => relation.type === 'has-sense')
    .map((relation) => relation.from === entryId ? relation.to : relation.from))]);
  // Character components of the presented surface are learnable targets too
  // (ordered has-character graph edges — builder-attested structure).
  for (const relation of relationsOf(graph, surfaceId, { direction: 'out' })) {
    if (relation.type === 'has-character') {
      const character = graph.nodes.get(relation.to);
      if (character && domainEnabled(character)) entityIds.add(relation.to);
    }
  }
  const entities = [...entityIds]
    .map((id) => graph.nodes.get(id))
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined)
    .filter(domainEnabled);
  const targets = learnableTargetsFor(graph, entities);
  const groups = new Map<string, KnowledgeProjectionTarget>();

  // Learner transfer calibration (acceptance D): observed method:'inference'
  // outcomes tell the predictor whether THIS learner exploits component →
  // whole structure. Read-only input; never written as knowledge.
  let inferenceAttempts = 0;
  let inferenceSuccesses = 0;
  for (const event of readActiveEvidence(events)) {
    if (event.method !== 'inference') continue;
    inferenceAttempts += 1;
    if (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy') inferenceSuccesses += 1;
  }
  const inferenceSuccess = inferenceAttempts > 0 ? { attempts: inferenceAttempts, successes: inferenceSuccesses } : undefined;

  // Entry-level lexical state feeding PREDICTION ONLY (acceptance A/B/C):
  // a synchronized lexical object (sense/spoken known through any variant)
  // makes a missing written bridge cheap. Never written as knowledge.
  const senseState = entryCapabilityState(graph, rows, entryIds, 'sense-recognition', surfaceId, policy, now, options?.archives);
  const spokenState = entryCapabilityState(graph, rows, entryIds, 'spoken-recognition', surfaceId, policy, now, options?.archives);
  const entrySupport = entryIds.length > 0
    ? {
        entryId: entryIds.length === 1 ? entryIds[0] : undefined,
        senseKnown: senseState.classification === 'known',
        spokenKnown: spokenState.classification === 'known',
      }
    : undefined;

  // Character-component familiarity feeding PREDICTION ONLY (acceptance B):
  // knowing 字 while 苗 is weak supports reading the whole, never measures it.
  const characterIds = relationsOf(graph, surfaceId, { direction: 'out' })
    .filter((relation) => relation.type === 'has-character')
    .map((relation) => relation.to);
  let charactersKnown = 0;
  for (const characterId of characterIds) {
    const explanation = targetExplanation(graph, rows, { entityId: characterId, capability: 'character-recognition' }, surfaceId, policy, now, undefined, options?.archives);
    if (classificationOf(explanation.state).classification === 'known') charactersKnown += 1;
  }
  const characterSupport = characterIds.length > 0
    ? { known: charactersKnown, total: characterIds.length }
    : undefined;

  for (const target of targets) {
    const entity = graph.nodes.get(target.entityId)!;
    const preliminary = targetExplanation(graph, rows, target, surfaceId, policy, now, undefined, options?.archives);
    let explanation = preliminary;
    const direct = preliminary.projection;
    if (!direct) {
      const predicted = predictTargetAccessibility({
        graph,
        direct,
        target,
        classify: easeToStatus,
        compound: options?.compound,
        ...(entrySupport ? { entry: entrySupport } : {}),
        ...(characterSupport ? { characters: characterSupport } : {}),
        ...(inferenceSuccess ? { inferenceSuccess } : {}),
      });
      if (predicted.supportPath.length) {
        explanation = targetExplanation(graph, rows, target, surfaceId, policy, now, {
          value: predicted.pSuccess,
          because: predicted.supportPath.map((path) => `${path.from} → ${path.to} (${path.via})`),
        }, options?.archives);
      }
    }
    const { classification, basis } = classificationOf(explanation.state);
    const active = explanation.evidence;
    const sourceCounts = active.reduce<Record<string, number>>((counts, event) => {
      counts[event.source] = (counts[event.source] ?? 0) + (event.timesSeenDelta ?? 1);
      return counts;
    }, {});
    const lastSuccess = lastDirectSuccess(active);
    const state: KnowledgeProjectionState = {
      ...(explanation.prediction ? { prediction: { value: explanation.prediction.value, reasons: explanation.prediction.because } } : {}),
      capability: target.capability,
      classification,
      basis,
      ...(direct ? { strength: { ease: direct.ease, timesSeen: direct.timesSeen, timesHovered: direct.timesHovered } } : {}),
      ...(lastSuccess !== undefined ? { lastDirectSuccess: lastSuccess } : {}),
      evidence: [...active].sort((a, b) => b.t - a.t).slice(0, MAX_EVIDENCE).map((event) => {
        // THE modeling-grade latency channel: attemptActiveLatencyMs yields
        // active-engagement time when recorded (undefined for stall-flagged
        // rows), falling back to legacy wall latency. The journal keeps the
        // full active/wall/stalled provenance; this projection carries only
        // what modeling may consume.
        const modelingLatency = attemptActiveLatencyMs(event);
        return {
          timestamp: event.t,
          source: event.source,
          ...(event.quality ?? event.rating ? { quality: event.quality ?? event.rating } : {}),
          ...(event.stalled ? { stalled: true } : {}),
          ...(modelingLatency !== undefined ? { latencyMs: modelingLatency } : {}),
        };
      }),
      evidenceSourceCounts: sourceCounts,
      ...(explanation.retention ? { retention: { pressure: explanation.retention.pressure, dueAt: explanation.retention.dueAt } } : {}),
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

  // Package-defined accesses (open world, acceptance I): events addressed
  // with a capability outside the graph-applicable set survive as INERT
  // states on their entity — claims, inspector, policy, and sync see them
  // under their own id; core never interprets their semantics.
  const generated = new Set([...groups.values()].flatMap((group) => group.states.map((state) => `${group.targetRef.id}:${state.capability}`)));
  for (const event of readActiveEvidence(events)) {
    const ref = event.targetRef;
    const capability = ref?.capability;
    if (!ref || capability === undefined || generated.has(`${ref.id}:${capability}`)) continue;
    if (!entityIds.has(ref.id)) continue;
    const entity = graph.nodes.get(ref.id);
    if (!entity) continue;
    generated.add(`${ref.id}:${capability}`);
    const explanation = targetExplanation(graph, rows, { entityId: ref.id, capability }, surfaceId, policy, now, undefined, options?.archives);
    if (explanation.evidence.length === 0) continue;
    const { classification, basis } = classificationOf(explanation.state);
    const active = explanation.evidence;
    const state: KnowledgeProjectionState = {
      capability,
      classification,
      basis,
      evidence: [...active].sort((a, b) => b.t - a.t).slice(0, MAX_EVIDENCE).map((row) => ({
        timestamp: row.t,
        source: row.source,
        ...(row.quality ?? row.rating ? { quality: row.quality ?? row.rating } : {}),
      })),
      evidenceSourceCounts: active.reduce<Record<string, number>>((counts, row) => {
        counts[row.source] = (counts[row.source] ?? 0) + (row.timesSeenDelta ?? 1);
        return counts;
      }, {}),
    };
    const group = groups.get(entity.id) ?? {
      targetRef: { kind: entity.kind, id: entity.id },
      applicableCapabilities: [],
      states: [],
    };
    group.states.push(state);
    groups.set(entity.id, group);
  }

  // Word-level lexical summary (acceptance C): the lexical object is NOT
  // wholly unknown when its sense or spoken access is known, even when the
  // written bridge was never measured.
  const surfaceRecognition = classificationOf(
    targetExplanation(graph, rows, { entityId: surfaceId, capability: 'surface-recognition' }, surfaceId, policy, now, undefined, options?.archives).state,
  );
  const surfaceReading = classificationOf(
    targetExplanation(graph, rows, { entityId: surfaceId, capability: 'surface-reading' }, surfaceId, policy, now, undefined, options?.archives).state,
  );
  const missingBridges: CapabilityKey[] = [];
  if (surfaceRecognition.classification !== 'known') missingBridges.push('surface-recognition');
  if (surfaceReading.classification !== 'known') missingBridges.push('surface-reading');
  const lexical: KnowledgeLexicalSummary = {
    entryIds,
    sense: senseState,
    spoken: spokenState,
    surfaceRecognition,
    synchronized: senseState.classification === 'known' || spokenState.classification === 'known',
    missingBridges,
  };
  return { status: 'ready', surfaceId, targets: [...groups.values()], lexical };
}

function lastDirectSuccess(events: readonly KnowledgeEvent[]): number | undefined {
  return events.reduce<number | undefined>((latest, event) =>
    event.method === 'recall' && (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy')
      ? Math.max(latest ?? 0, event.t)
      : latest,
  undefined);
}
