import type { WordStatus } from '../constants';
import { assembleTargetExplanation, toJournalRows, type JournalRow, type TargetExplanation } from '../graph/explanations';
import { archiveBucketStats, bucketRepresentative, emptyArchiveTargetStats, type ArchiveTargetStats, type KeyArchive } from './historyArchive';
import { eventAppliesToTarget, realizedEntryIds } from '../graph/addressing';
import type { KnowledgeLexicalSummary, KnowledgeProjection, KnowledgeProjectionBasis, KnowledgeProjectionClassification, KnowledgeProjectionState, KnowledgeProjectionTarget } from '../graph/ipc';
import { relationsOf, type LingualGraph } from '../graph/load';
import { learnableTargetsFor } from '../graph/targets';
import { predictTargetAccessibility, type PredictionInput } from '../prediction/supportPredictor';
import type { SourceKnowledge } from '../prediction/supportContributors';
import { attemptActiveLatencyMs, eventCapability, eventIsMeasurable, readActiveEvidence } from '../knowledgeEvents';
import { evidenceStatusFromEase, effectiveThresholds, type EffectiveThresholds } from './effectiveKnowledge';
import { DEFAULT_ENABLED_DOMAINS, type CapabilityKey, type GraphDomain, type GraphEntity, type LearnableTarget } from '../graph/types';
import type { RetentionPolicy } from '../srs/retentionScheduler';
import type { KnowledgeEvent } from '../knowledgeEvents';
import type { LanguageData } from '../types';

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
  policy: RetentionPolicy | undefined,
  now: number,
  prediction?: TargetExplanation['prediction'],
  archives?: readonly KeyArchive[],
  thresholds: EffectiveThresholds = effectiveThresholds(),
  languageData?: LanguageData | null,
  allowUnscoped = true,
): TargetExplanation {
  return assembleTargetExplanation(
    target.capability,
    rows,
    policy,
    now,
    prediction,
    (event) => (allowUnscoped || event.targetRef !== undefined) && eventAppliesToTarget(graph, event, target, queriedSurfaceId, languageData),
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
  policy: RetentionPolicy | undefined,
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
  policy: RetentionPolicy | undefined,
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
  const entityIds = projectionEntityIds(graph, surfaceId, enabledDomains);
  const entities = [...entityIds]
    .map((id) => graph.nodes.get(id))
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined)
    .filter(domainEnabled);
  const targets = learnableTargetsFor(graph, entities);
  const groups = new Map<string, KnowledgeProjectionTarget>();
  const sourceStates = new Map<string, SourceKnowledge | undefined>();
  const transferHistory: NonNullable<PredictionInput['transferHistory']> = Object.fromEntries(
    [...new Set(Object.values(options?.languageData?.learning?.capabilities ?? {})
      .flatMap(declaration => Array.isArray(declaration.supportRules) ? declaration.supportRules.flatMap(rule =>
        typeof rule?.transferContext === 'string' && rule.transferContext ? [rule.transferContext] : []) : []))]
      .flatMap(context => {
        const history = observedTransferHistory(events, context);
        return history ? [[context, history]] : [];
      }));

  // Lexical summaries remain evidence/claim projections. They do not authorize
  // another access: every prediction source must pass the package rule boundary.
  const senseState = entryCapabilityState(graph, rows, entryIds, 'sense-recognition', surfaceId, policy, now, options?.archives, thresholds, options?.languageData);
  const spokenState = entryCapabilityState(graph, rows, entryIds, 'spoken-recognition', surfaceId, policy, now, options?.archives, thresholds, options?.languageData);

  for (const target of targets) {
    const entity = graph.nodes.get(target.entityId)!;
    const preliminary = targetExplanation(graph, rows, target, surfaceId, policy, now, undefined, options?.archives, thresholds, options?.languageData);
    let explanation = preliminary;
    let supportLimits: string[] = [];
    const direct = preliminary.projection;
    if (!direct) {
      const predicted = predictTargetAccessibility({
        graph,
        direct,
        target,
        classify: (ease) => evidenceStatusFromEase(ease, thresholds),
        languageData: options?.languageData,
        transferHistory,
        sourceKnowledge: (source) => {
          const cacheKey = JSON.stringify([source.entityId, source.capability]);
          if (sourceStates.has(cacheKey)) return sourceStates.get(cacheKey);
          const resolved = targetExplanation(graph, rows, source, source.entityId, policy, now,
            undefined, options?.archives, thresholds, options?.languageData, source.entityId === surfaceId);
          const state = classificationOf(resolved.state);
          if (state.classification !== 'known' || (state.basis !== 'evidence' && state.basis !== 'claim')) {
            sourceStates.set(cacheKey, undefined); return undefined;
          }
          // Claims and archived aggregates never acquire fabricated attempt ids.
          const witness = resolved.knowledgeWitness;
          const observationIds = state.basis === 'evidence' && witness
            && (witness.kind === 'rating' || witness.kind === 'review')
            && witness.attemptId && !/^\d+$/.test(witness.attemptId) ? [witness.attemptId] : [];
          const knowledge = { basis: state.basis, observationIds };
          sourceStates.set(cacheKey, knowledge);
          return knowledge;
        },
      });
      supportLimits = predicted.limits;
      if (predicted.supportPath.length) {
        explanation = targetExplanation(graph, rows, target, surfaceId, policy, now, {
          value: predicted.supportScore,
          model: 'package-support-v2',
          interpretation: 'heuristic-support',
          contributors: predicted.contributors,
          because: predicted.supportPath.map((path) => `${path.from} → ${path.to} (${path.via})`),
        }, options?.archives, thresholds, options?.languageData);
      }
    }
    const state = projectionState(target.capability, explanation,
      mergeArchivesStats(options?.archives ?? [], (event) => eventAppliesToTarget(graph, event, target, surfaceId, options?.languageData)));
    if (supportLimits.length) state.supportLimits = supportLimits;
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
    const { basis } = classificationOf(explanation.state);
    if (basis !== 'claim' && basis !== 'evidence') continue;
    const group = groups.get(entity.id) ?? {
      targetRef: { kind: entity.kind, id: entity.id },
      applicableCapabilities: [],
      states: [],
    };
    group.states.push(projectionState(target.capability, explanation,
      mergeArchivesStats(options?.archives ?? [], (event) => eventAppliesToTarget(graph, event, target, surfaceId, options?.languageData))));
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
  const lexical: KnowledgeLexicalSummary = {
    overall: [senseState, spokenState, surfaceRecognition].find(state => state.classification === 'known')
      ?? [senseState, spokenState, surfaceRecognition].find(state => state.classification === 'learning')
      ?? [senseState, spokenState, surfaceRecognition].find(state => state.basis === 'claim' || state.basis === 'evidence')
      ?? { classification: 'unmeasured', basis: 'unmeasured' },
    entryIds,
    sense: senseState,
    spoken: spokenState,
    surfaceRecognition,
    synchronized: senseState.classification === 'known' || spokenState.classification === 'known',
    missingBridges,
  };
  return { status: 'ready', surfaceId, targets: [...groups.values()], lexical };
}

/** Package-declared learnable neighbors use the same discovery as built-in targets. */
export function projectionEntityIds(graph: LingualGraph, surfaceId: string, enabledDomains: readonly GraphDomain[] = DEFAULT_ENABLED_DOMAINS): Set<string> {
  const domainEnabled = (entity: GraphEntity | undefined): entity is GraphEntity =>
    entity !== undefined && (!entity.domain || enabledDomains.includes(entity.domain));
  const entryIds = realizedEntryIds(graph, surfaceId).filter(id => domainEnabled(graph.nodes.get(id)));
  const entityIds = new Set<string>([surfaceId, ...entryIds.flatMap((entryId) => relationsOf(graph, entryId)
    .filter((relation) => relation.type === 'has-sense')
    .map((relation) => relation.from === entryId ? relation.to : relation.from))]);
  // Character components of the presented surface are learnable targets too
  // (ordered has-character graph edges — builder-attested structure).
  for (const owner of [surfaceId, ...entryIds]) {
    for (const relation of relationsOf(graph, owner)) {
      const id = relation.from === owner ? relation.to : relation.from;
      const entity = graph.nodes.get(id);
      if (domainEnabled(entity) && (relation.type === 'has-character'
        || entity.learnable === true || (entity.learnableCapabilities?.length ?? 0) > 0)) {
        entityIds.add(id);
      }
    }
  }
  return entityIds;
}

/** Authored historical and graph-declared targets expose the same provenance. */
function projectionState(capability: CapabilityKey, explanation: TargetExplanation, archivedStats: ArchiveTargetStats): KnowledgeProjectionState {
  const direct = explanation.projection;
  const { classification, basis } = classificationOf(explanation.state);
  const active = explanation.evidence;
  const sourceCounts = active.reduce<Record<string, number>>((counts, event) => {
    counts[event.source] = (counts[event.source] ?? 0) + (event.timesSeenDelta ?? 1);
    return counts;
  }, {});
  for (const [source, count] of Object.entries(archivedStats.sourceSeen)) {
    sourceCounts[source] = (sourceCounts[source] ?? 0) + count;
  }
  const lastSuccess = Math.max(lastDirectSuccess(active) ?? 0, archivedStats.lastDirectT ?? 0) || undefined;
  return {
    ...(explanation.prediction ? { prediction: { value: explanation.prediction.value, reasons: explanation.prediction.because,
      model: explanation.prediction.model, interpretation: explanation.prediction.interpretation,
      ...(explanation.prediction.contributors ? { contributors: explanation.prediction.contributors } : {}) } } : {}),
    capability: capability,
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
}

/** Count physical unassisted attempts, never duplicate accesses or uncertain legacy counters. */
export function observedTransferHistory(events: readonly KnowledgeEvent[], context?: string): { attempts: number; successes: number } | undefined {
  const attempts = new Map<string, boolean>();
  for (const event of readActiveEvidence(events)) {
    if (context !== undefined && event.transferContext !== context) continue;
    if (event.kind !== 'rating' && event.kind !== 'review') continue;
    if (event.method !== 'inference' || !eventIsMeasurable(event) || !event.taskType
      || event.scaffolds === undefined || Object.values(event.scaffolds).some(Boolean)
      || !event.attemptId || /^\d+$/.test(event.attemptId)) continue;
    const success = event.quality === 'fluent' || event.rating === 'good' || event.rating === 'easy';
    attempts.set(event.attemptId, (attempts.get(event.attemptId) ?? true) && success);
  }
  return attempts.size ? { attempts: attempts.size, successes: [...attempts.values()].filter(Boolean).length } : undefined;
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
