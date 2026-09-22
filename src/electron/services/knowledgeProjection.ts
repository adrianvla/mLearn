import type { WordStatus } from '../../shared/constants';
import { assembleTargetExplanation, toJournalRows, type JournalRow, type TargetExplanation } from '../../shared/graph/explanations';
import { archiveBucketStats, bucketRepresentative, emptyArchiveTargetStats, type ArchiveTargetStats, type KeyArchive } from '../../shared/knowledge/historyArchive';
import { eventAppliesToTarget, realizedEntryIds } from '../../shared/graph/addressing';
import type { KnowledgeLexicalSummary, KnowledgeProjection, KnowledgeProjectionBasis, KnowledgeProjectionClassification, KnowledgeProjectionState, KnowledgeProjectionTarget } from '../../shared/graph/ipc';
import { relationsOf, type LingualGraph } from '../../shared/graph/load';
import { learnableTargetsFor } from '../../shared/graph/targets';
import { predictTargetAccessibility, type PredictionInput } from '../../shared/prediction/supportPredictor';
import { attemptActiveLatencyMs, eventCapability, readActiveEvidence } from '../../shared/knowledgeEvents';
import { evidenceStatusFromEase, effectiveThresholds, type EffectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { DEFAULT_ENABLED_DOMAINS, type CapabilityKey, type GraphDomain, type GraphEntity, type LearnableTarget } from '../../shared/graph/types';
import type { RetentionPolicy } from '../../shared/srs/retentionScheduler';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';
import type { LanguageData } from '../../shared/types';

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
  thresholds: EffectiveThresholds = effectiveThresholds(),
  languageData?: LanguageData | null,
): TargetExplanation {
  return assembleTargetExplanation(
    target.capability,
    rows,
    policy,
    now,
    prediction,
    (event) => eventAppliesToTarget(graph, event, target, queriedSurfaceId, languageData),
    archives,
    thresholds,
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
  thresholds: EffectiveThresholds = effectiveThresholds(),
  languageData?: LanguageData | null,
): { classification: KnowledgeProjectionClassification; basis: KnowledgeProjectionBasis } {
  const matched = assembleTargetExplanation(
    capability,
    rows,
    policy,
    now,
    undefined,
    (event) => (realizedEntryIds(graph, queriedSurfaceId).length ? entryIds : [queriedSurfaceId]).some((entryId) => eventAppliesToTarget(graph, event, { entityId: entryId, capability }, queriedSurfaceId, languageData)),
    archives,
    thresholds,
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
  options?: { compound?: PredictionInput['compound']; archives?: readonly KeyArchive[]; thresholds?: EffectiveThresholds; languageData?: LanguageData | null },
): KnowledgeProjection {
  const thresholds = options?.thresholds ?? effectiveThresholds();
  const rows = toJournalRows(rawRows);
  const events = rows.map(({ event }) => event);
  const domainEnabled = (entity: GraphEntity | undefined): entity is GraphEntity =>
    entity !== undefined && (!entity.domain || enabledDomains.includes(entity.domain));
  const surface = graph.nodes.get(surfaceId);
  if (surface && !domainEnabled(surface)) return { status: 'ready', surfaceId, targets: [] };
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
  // Archived attempts contribute the same counts via bucket methodStats —
  // retraction-safe: rebuilds recompute the stats from surviving records.
  for (const archive of options?.archives ?? []) {
    for (const bucket of Object.values(archive.buckets)) {
      if (bucket.methodStats === undefined) continue;
      inferenceAttempts += bucket.methodStats.inference;
      inferenceSuccesses += bucket.methodStats.inferenceSuccess;
    }
  }
  const inferenceSuccess = inferenceAttempts > 0 ? { attempts: inferenceAttempts, successes: inferenceSuccesses } : undefined;

  // Entry-level lexical state feeding PREDICTION ONLY (acceptance A/B/C):
  // a synchronized lexical object (sense/spoken known through any variant)
  // makes a missing written bridge cheap. Never written as knowledge.
  const senseState = entryCapabilityState(graph, rows, entryIds, 'sense-recognition', surfaceId, policy, now, options?.archives, thresholds, options?.languageData);
  const spokenState = entryCapabilityState(graph, rows, entryIds, 'spoken-recognition', surfaceId, policy, now, options?.archives, thresholds, options?.languageData);
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
    const explanation = targetExplanation(graph, rows, { entityId: characterId, capability: 'character-recognition' }, surfaceId, policy, now, undefined, options?.archives, thresholds, options?.languageData);
    if (classificationOf(explanation.state).classification === 'known') charactersKnown += 1;
  }
  const characterSupport = characterIds.length > 0
    ? { known: charactersKnown, total: characterIds.length }
    : undefined;

  for (const target of targets) {
    const entity = graph.nodes.get(target.entityId)!;
    const preliminary = targetExplanation(graph, rows, target, surfaceId, policy, now, undefined, options?.archives, thresholds, options?.languageData);
    let explanation = preliminary;
    const direct = preliminary.projection;
    if (!direct) {
      const predicted = predictTargetAccessibility({
        graph,
        direct,
        target,
        classify: (ease) => evidenceStatusFromEase(ease, thresholds),
        compound: options?.compound,
        ...(entrySupport ? { entry: entrySupport } : {}),
        ...(characterSupport ? { characters: characterSupport } : {}),
        ...(inferenceSuccess ? { inferenceSuccess } : {}),
      });
      if (predicted.supportPath.length) {
        explanation = targetExplanation(graph, rows, target, surfaceId, policy, now, {
          value: predicted.pSuccess,
          because: predicted.supportPath.map((path) => `${path.from} → ${path.to} (${path.via})`),
        }, options?.archives, thresholds, options?.languageData);
      }
    }
    const { classification, basis } = classificationOf(explanation.state);
    const active = explanation.evidence;
    // Archived evidence contributes the same counters through its bucket
    // statistics, selected by the same address matcher as the exact rows.
    const archivedStats = mergeArchivesStats(options?.archives ?? [], (event) => eventAppliesToTarget(graph, event, target, surfaceId, options?.languageData));
    const sourceCounts = active.reduce<Record<string, number>>((counts, event) => {
      counts[event.source] = (counts[event.source] ?? 0) + (event.timesSeenDelta ?? 1);
      return counts;
    }, {});
    for (const [source, count] of Object.entries(archivedStats.sourceSeen)) {
      sourceCounts[source] = (sourceCounts[source] ?? 0) + count;
    }
    const lastSuccess = Math.max(lastDirectSuccess(active) ?? 0, archivedStats.lastDirectT ?? 0) || undefined;
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

  // Authored accesses survive package changes as inert states. A missing
  // surface retains its exact journal address; this does not invent graph
  // applicability, transfer evidence to another entity, or create new events.
  const generated = new Set([...groups.values()].flatMap((group) => group.states.map((state) => `${group.targetRef.id}:${state.capability}`)));
  const authored = new Map<string, LearnableTarget>();
  const collect = (event: KnowledgeEvent) => {
    const capability = eventCapability(event);
    const id = event.targetRef?.id ?? surfaceId;
    if (capability === undefined || !entityIds.has(id)) return;
    const key = `${id}:${capability}`;
    if (!generated.has(key)) authored.set(key, { entityId: id, capability });
  };
  readActiveEvidence(events).forEach(collect);
  for (const archive of options?.archives ?? []) {
    for (const key of Object.keys(archive.buckets)) {
      const event = bucketRepresentative(key);
      if (event) collect(event);
    }
  }
  for (const target of authored.values()) {
    const entity = graph.nodes.get(target.entityId)
      ?? (target.entityId === surfaceId ? { id: surfaceId, kind: 'surface' as const } : undefined);
    if (!entity || !domainEnabled(entity)) continue;
    const explanation = targetExplanation(graph, rows, target, surfaceId, policy, now, undefined, options?.archives, thresholds, options?.languageData);
    const { classification, basis } = classificationOf(explanation.state);
    if (basis !== 'claim' && basis !== 'evidence') continue;
    const active = explanation.evidence;
    const archivedStats = mergeArchivesStats(options?.archives ?? [], (event) => eventAppliesToTarget(graph, event, target, surfaceId, options?.languageData));
    const sourceCounts: Record<string, number> = { ...archivedStats.sourceSeen };
    for (const row of active) {
      sourceCounts[row.source] = (sourceCounts[row.source] ?? 0) + (row.timesSeenDelta ?? 1);
    }
    const group = groups.get(entity.id) ?? {
      targetRef: { kind: entity.kind, id: entity.id },
      applicableCapabilities: [],
      states: [],
    };
    const lastSuccess = Math.max(lastDirectSuccess(active) ?? 0, archivedStats.lastDirectT ?? 0) || undefined;
    group.states.push({
      capability: target.capability,
      classification,
      basis,
      ...(lastSuccess !== undefined ? { lastDirectSuccess: lastSuccess } : {}),
      evidence: [...active].sort((a, b) => b.t - a.t).slice(0, MAX_EVIDENCE).map((row) => ({
        timestamp: row.t,
        source: row.source,
        ...(row.quality ?? row.rating ? { quality: row.quality ?? row.rating } : {}),
      })),
      evidenceSourceCounts: sourceCounts,
    });
    groups.set(entity.id, group);
  }

  // Word-level lexical summary (acceptance C): the lexical object is NOT
  // wholly unknown when its sense or spoken access is known, even when the
  // written bridge was never measured.
  const surfaceRecognition = classificationOf(
    targetExplanation(graph, rows, { entityId: surfaceId, capability: 'surface-recognition' }, surfaceId, policy, now, undefined, options?.archives, thresholds, options?.languageData).state,
  );
  const surfaceReading = classificationOf(
    targetExplanation(graph, rows, { entityId: surfaceId, capability: 'surface-reading' }, surfaceId, policy, now, undefined, options?.archives, thresholds, options?.languageData).state,
  );
  const missingBridges: CapabilityKey[] = [];
  if (surfaceRecognition.classification !== 'known') missingBridges.push('surface-recognition');
  if (surfaceReading.classification !== 'known') missingBridges.push('surface-reading');
  // An observed bridge is tracked even when lexical identity is unresolved.
  // Positive reading/prosody evidence alone never promotes identity to Known.
  const measuredBridge = groups.get(surfaceId)?.states.find(state => state.basis === 'claim' || state.basis === 'evidence');
  const lexical: KnowledgeLexicalSummary = {
    overall: [senseState, spokenState, surfaceRecognition].find(state => state.classification === 'known')
      ?? [senseState, spokenState, surfaceRecognition].find(state => state.classification === 'learning')
      ?? [senseState, spokenState, surfaceRecognition].find(state => state.basis === 'claim' || state.basis === 'evidence')
      ?? (measuredBridge ? { classification: 'unknown', basis: measuredBridge.basis } : { classification: 'unmeasured', basis: 'unmeasured' }),
    entryIds,
    sense: senseState,
    spoken: spokenState,
    surfaceRecognition,
    synchronized: senseState.classification === 'known' || spokenState.classification === 'known',
    missingBridges,
  };
  return { status: 'ready', surfaceId, targets: [...groups.values()], lexical };
}

/** Matcher-scoped archived statistics merged across sibling keys. */
function mergeArchivesStats(archives: readonly KeyArchive[], match: (representative: KnowledgeEvent) => boolean): ArchiveTargetStats {
  let stats = emptyArchiveTargetStats();
  for (const archive of archives) {
    stats = archiveBucketStats(archive, match, stats);
  }
  return stats;
}

function lastDirectSuccess(events: readonly KnowledgeEvent[]): number | undefined {
  return events.reduce<number | undefined>((latest, event) =>
    event.method === 'recall' && (event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy')
      ? Math.max(latest ?? 0, event.t)
      : latest,
  undefined);
}
