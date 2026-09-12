import { KNOWLEDGE_SOURCE_DISPLAY_NAMES, SRS_EASE } from '../../../../shared/constants';
import { LEXICAL_IDENTITY_CAPABILITIES } from '../../../../shared/graph/access';
import { bucketRepresentative, type KeyArchive } from '../../../../shared/knowledge/historyArchive';
import { eventCapability, eventIsMeasurable, readActiveEvidence, type KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import type { PassiveWordKnowledge } from '../../../../shared/types';
import { applyEventToFold, emptyKeyFold, mergeKeyFolds, projectKeyFold, type FoldState, type ReplayProjection } from '../../../../shared/utils/projectionReplay';
import { getComprehensiveWordStatusWithSource } from '../../../utils/comprehensiveKnowledge';
import { evidenceStatusFromEase, type EffectiveThresholds } from '../../../utils/effectiveKnowledge';

export interface WordEaseHistoryEntry { word: string; key: string; events: KnowledgeEvent[]; archive?: KeyArchive }
export interface WordEasePoint { t: number; ease?: number; event: KnowledgeEvent; word: string; matchedWord?: string }
const identityCapabilities = new Set<string>(LEXICAL_IDENTITY_CAPABILITIES);

/** Read-only shape adapter matching the live materialization. The actual overall
 * choice remains getComprehensiveWordStatusWithSource, never an average. */
function asKnowledge(word: string, language: string, capabilities: Record<string, ReplayProjection>, thresholds: EffectiveThresholds): PassiveWordKnowledge {
  const meaning = capabilities['sense-recognition'];
  const access: NonNullable<PassiveWordKnowledge['access']> = {};
  for (const [capability, projected] of Object.entries(capabilities)) {
    if (capability === 'sense-recognition') continue;
    const source = KNOWLEDGE_SOURCE_DISPLAY_NAMES[projected.evidenceSource as keyof typeof KNOWLEDGE_SOURCE_DISPLAY_NAMES];
    access[capability] = {
      ease: projected.ease, status: evidenceStatusFromEase(projected.ease, thresholds),
      source: source === 'Grammar' || source === 'Migration' ? 'None' : source ?? 'None',
      lastStatusChange: projected.lastStatusChange ?? projected.lastSeen, updatedAt: projected.lastSeen,
      claim: projected.claim, claimAt: projected.claimAt,
    };
  }
  return {
    word, language, ease: meaning?.ease ?? SRS_EASE.MIN, timesSeen: meaning?.timesSeen ?? 0,
    timesHovered: meaning?.timesHovered ?? 0, lastSeen: meaning?.lastSeen ?? 0,
    lastStatusChange: meaning?.lastStatusChange, lastEvidenceSource: meaning?.evidenceSource,
    hasActiveEvidence: meaning?.hasActiveEvidence ?? false, claim: meaning?.claim, claimAt: meaning?.claimAt, access,
  };
}

/** Incremental journal replay into the SAME word-level resolver used by the
 * hover. Keep each spelling's state separate before the resolver selects it.
 * Archive ranges have no invented intermediate ease; resume from exact folds. */
export function wordEaseTrajectoryData(entries: readonly WordEaseHistoryEntry[], language: string, thresholds: EffectiveThresholds) {
  const folds = new Map<string, Map<string, FoldState>>();
  const archiveBuckets = entries.flatMap((entry) => Object.entries(entry.archive?.buckets ?? {}).flatMap(([key, bucket]) => {
    const representative = bucketRepresentative(key);
    const capability = representative && eventCapability(representative);
    return capability && identityCapabilities.has(capability) ? [{ key: entry.key, capability, bucket }] : [];
  }));
  const compressed = archiveBuckets.map(({ bucket }) => ({ from: bucket.fold.firstSeen ?? 0, to: bucket.fold.lastSeen ?? 0, count: bucket.rowCount }));
  const active = new Set(readActiveEvidence(entries.flatMap((entry) => entry.events)));
  const ordered = entries.flatMap((entry) => entry.events.filter((event) => active.has(event)).map((event, seq) => ({ entry, event, seq })))
    .filter(({ event }) => identityCapabilities.has(eventCapability(event) ?? '') && eventIsMeasurable(event))
    .sort((a, b) => a.event.t - b.event.t || a.seq - b.seq);
  const wordKnowledge: Record<string, PassiveWordKnowledge> = {};
  const points: WordEasePoint[] = [];
  for (const { entry, event, seq } of ordered) {
    const capability = eventCapability(event)!;
    const keyFolds = folds.get(entry.key) ?? new Map<string, FoldState>();
    const fold = keyFolds.get(capability) ?? emptyKeyFold();
    applyEventToFold(fold, event, seq);
    keyFolds.set(capability, fold);
    folds.set(entry.key, keyFolds);
    for (const candidate of entries) {
      const combined = new Map<string, FoldState>();
      for (const archived of archiveBuckets) {
        if (archived.key !== candidate.key || (archived.bucket.fold.lastSeen ?? Infinity) > event.t) continue;
        combined.set(archived.capability, mergeKeyFolds(combined.get(archived.capability) ?? emptyKeyFold(), archived.bucket.measurableFold));
      }
      for (const [capability, exact] of folds.get(candidate.key) ?? []) {
        combined.set(capability, mergeKeyFolds(combined.get(capability) ?? emptyKeyFold(), exact));
      }
      const projections: Record<string, ReplayProjection> = {};
      for (const [capability, fold] of combined) {
        const projected = projectKeyFold(fold);
        if (projected) projections[capability] = projected;
      }
      if (Object.keys(projections).length) wordKnowledge[candidate.key] = asKnowledge(candidate.word, language, projections, thresholds);
      else delete wordKnowledge[candidate.key];
    }
    const result = getComprehensiveWordStatusWithSource(entry.word, {
      language, getCanonicalForm: (word) => word, getWordForms: () => entries.map((entry) => entry.word),
      hashWordSync: (word) => entries.find((entry) => entry.word === word)?.key ?? '', langKey: (_language, key) => key,
      ignoredWords: {}, wordKnowledge, knownEaseThreshold: thresholds.known, learningThreshold: thresholds.learning,
    });
    const incomplete = compressed.some((range) => range.from <= event.t && range.to > event.t);
    // A claim-only winning form has a default ease, not an observed outcome.
    // Evidence on another spelling cannot make that default a measured value.
    const resolvedKey = entries.find((candidate) => candidate.word === result.matchedWord)?.key ?? entry.key;
    const hasOutcome = [...(folds.get(resolvedKey)?.values() ?? [])].some((fold) => fold.ease !== undefined)
      || archiveBuckets.some(({ key, bucket }) => key === resolvedKey && bucket.measurableFold.ease !== undefined && (bucket.fold.lastSeen ?? Infinity) <= event.t);
    points.push({ t: event.t, event, word: entry.word, matchedWord: result.matchedWord, ease: !incomplete && hasOutcome ? result.ease : undefined });
  }
  return { points, compressed };
}
