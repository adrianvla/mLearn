import {
  type KnowledgeAspect,
  ASPECT_PREREQUISITES,
  KNOWLEDGE_ASPECTS,
  type KnowledgeSource,
  type KnowledgeSurface,
  SURFACE_WEIGHTS,
  KNOWLEDGE_SOURCE_DISPLAY_NAMES,
  type WordStatus,
  type WordKnowledgeSource,
} from '../../shared/constants';
import type { PassiveWordKnowledge } from '../../shared/types';
import { normalizedStrength, statusToStrength } from '../../shared/utils/knowledgeStrength';
import {
  type ComprehensiveKnowledgeDeps,
  getComprehensiveWordStatusWithSource,
} from './comprehensiveKnowledge';

export type ReadableAspect = Exclude<KnowledgeAspect, 'meaning'>;

const STATUS_RANK: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };
const RANK_STATUS: readonly WordStatus[] = ['unknown', 'learning', 'known'];

export interface AspectStatusResult {
  status: WordStatus;
  ease: number;
  source: WordKnowledgeSource;
  inherited: boolean;
  lastStatusChange?: number;
}

/**
 * Read an aspect's status across all surface-form entries of a word.
 * Meaning delegates to the existing bank resolution (it IS the meaning aspect).
 * Reading/prosody read wordKnowledge aspects; absent aspect records fall back
 * to the resolved meaning status with inherited semantics (computed, never
 * persisted on read).
 */
export function getAspectStatusSync(
  word: string,
  aspect: KnowledgeAspect,
  deps: ComprehensiveKnowledgeDeps,
): AspectStatusResult {
  const meaning = getComprehensiveWordStatusWithSource(word, deps);
  if (aspect === 'meaning') {
    return {
      status: meaning.status,
      ease: meaning.ease ?? (meaning.status === 'known' ? deps.knownEaseThreshold : meaning.status === 'learning' ? deps.learningThreshold : 0),
      source: meaning.source,
      inherited: false,
    };
  }

  let best: { result: AspectStatusResult; rank: number } | null = null;
  const matches = buildFormMatches(word, deps);
  for (const match of matches) {
    const record = deps.wordKnowledge[match.lk]?.aspects?.[aspect];
    if (!record) continue;
    const result: AspectStatusResult = {
      status: record.status,
      ease: record.ease,
      source: record.source,
      inherited: record.inherited === true,
      lastStatusChange: record.lastStatusChange,
    };
    const rank = STATUS_RANK[record.status];
    if (!best || rank > best.rank) {
      best = { result, rank };
    }
  }
  if (best) return best.result;

  // Inheritance runs along the dependency chain only: an aspect whose
  // prerequisites include meaning displays the meaning status until finer
  // evidence exists. Orthogonal aspects (e.g. gender) have no chain to inherit
  // from — an absent record is plain no-evidence unknown.
  if (prerequisitesOf(aspect, KNOWLEDGE_ASPECTS).includes('meaning')) {
    return {
      status: meaning.status,
      ease: meaning.ease ?? (meaning.status === 'known' ? deps.knownEaseThreshold : meaning.status === 'learning' ? deps.learningThreshold : 0),
      source: meaning.source,
      inherited: true,
    };
  }

  return { status: 'unknown', ease: 0, source: 'None', inherited: false };
}

interface FormMatch {
  lk: string;
}

function buildFormMatches(word: string, deps: ComprehensiveKnowledgeDeps): FormMatch[] {
  const forms = deps.getWordForms?.(word) ?? (() => {
    const canonical = deps.getCanonicalForm(word);
    return canonical && canonical !== word ? [canonical, word] : [word];
  })();
  const matches: FormMatch[] = [];
  const seen = new Set<string>();
  for (const form of forms) {
    const normalized = form.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    matches.push({ lk: deps.langKey(deps.language, deps.hashWordSync(normalized)) });
  }
  return matches;
}

export interface EffectiveKnowledgeResult {
  /** Weighted 0–1 strength over available aspects. */
  strength: number;
  status: WordStatus;
}

/**
 * Surface-weighted knowledge blend: Σ profile[aspect] × normalizedStrength(aspect)
 * over Σ weights of aspects available for the language, mapped back to WordStatus
 * at 0.5/1.0 boundaries. The 'other' profile reduces exactly to meaning.
 */
export function getEffectiveKnowledge(
  word: string,
  surface: KnowledgeSurface,
  deps: ComprehensiveKnowledgeDeps,
  availableAspects: readonly KnowledgeAspect[],
): EffectiveKnowledgeResult {
  const weights = SURFACE_WEIGHTS[surface];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const aspect of availableAspects) {
    const w = weights[aspect];
    if (w <= 0) continue;
    const aspectStatus = getAspectStatusSync(word, aspect, deps);
    // Aspect eases and the deps thresholds are app-domain (1.3–1.8+); normalizedStrength
    // anchors default to the raw-factor domain (1300+). Scale ×1000 — same domain split
    // as eventStrength in knowledgeHistory.
    const strength = aspect === 'meaning'
      ? statusToStrength(aspectStatus.status)
      : normalizedStrength(aspectStatus.ease * 1000, deps.learningThreshold * 1000, deps.knownEaseThreshold * 1000);
    weightedSum += w * strength;
    weightTotal += w;
  }
  const strength = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return { strength, status: effectiveStatusFromStrength(strength) };
}

export function effectiveStatusFromStrength(strength: number): WordStatus {
  if (strength >= 1) return 'known';
  if (strength >= 0.5) return 'learning';
  return 'unknown';
}

export interface AspectWriteInput {
  aspect: ReadableAspect;
  status: WordStatus;
  ease: number;
  source: WordKnowledgeSource;
  now: number;
}

/**
 * Transitive prerequisites of `aspect` among `availableAspects` — the coarser
 * aspects a learner necessarily traversed first (ASPECT_PREREQUISITES graph).
 */
export function prerequisitesOf(aspect: KnowledgeAspect, availableAspects: readonly KnowledgeAspect[]): readonly KnowledgeAspect[] {
  const seen = new Set<KnowledgeAspect>();
  const queue = [...ASPECT_PREREQUISITES[aspect]];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...ASPECT_PREREQUISITES[current]);
  }
  return availableAspects.filter((candidate) => seen.has(candidate));
}

/**
 * Transitive dependents of `aspect` among `availableAspects` — the finer aspects
 * whose prerequisite chain includes it. Meaning is never a dependent.
 */
function dependentsOf(aspect: KnowledgeAspect, availableAspects: readonly KnowledgeAspect[]): readonly ReadableAspect[] {
  const seen = new Set<KnowledgeAspect>([aspect]);
  const result: ReadableAspect[] = [];
  const visit = (node: KnowledgeAspect) => {
    for (const candidate of availableAspects) {
      if (seen.has(candidate) || !ASPECT_PREREQUISITES[candidate].includes(node)) continue;
      seen.add(candidate);
      if (candidate !== 'meaning') result.push(candidate);
      visit(candidate);
    }
  };
  visit(aspect);
  return result;
}

function minStatus(a: WordStatus, b: WordStatus): WordStatus {
  return RANK_STATUS[Math.min(STATUS_RANK[a], STATUS_RANK[b])];
}

/**
 * Write an aspect record onto ONE wordKnowledge entry (caller iterates every
 * surface-form hash per the split-hash rule). Applies:
 * - direct write (clears `inherited`),
 * - down-squash: a downgrade pulls all finer aspects down at write time,
 * - down-init: a finer aspect with no record initializes inherited from the broader one.
 * Finer aspects may rebuild independently afterwards.
 */
export function applyAspectWrite(
  entry: PassiveWordKnowledge,
  input: AspectWriteInput,
  easeForStatus: (status: WordStatus) => number,
  availableAspects: readonly KnowledgeAspect[],
): void {
  if (!entry.aspects) entry.aspects = {};
  const aspects = entry.aspects;
  const previous = aspects[input.aspect];
  const downgraded = previous !== undefined && STATUS_RANK[input.status] < STATUS_RANK[previous.status];

  aspects[input.aspect] = {
    status: input.status,
    ease: input.ease,
    source: input.source,
    lastStatusChange: input.now,
    updatedAt: input.now,
  };

  for (const finer of dependentsOf(input.aspect, availableAspects)) {
    const finerRecord = aspects[finer];
    if (!finerRecord) {
      aspects[finer] = {
        status: input.status,
        ease: input.ease,
        source: input.source,
        lastStatusChange: input.now,
        updatedAt: input.now,
        inherited: true,
      };
    } else if (downgraded) {
      const squashed = minStatus(finerRecord.status, input.status);
      finerRecord.status = squashed;
      finerRecord.ease = squashed === input.status ? input.ease : easeForStatus(squashed);
      finerRecord.lastStatusChange = input.now;
      finerRecord.updatedAt = input.now;
    }
  }
}

/**
 * Meaning-aspect cascade applied from setComprehensiveWordStatus: a meaning
 * downgrade squashes reading+prosody at write time; missing finer records
 * initialize inherited from the meaning status. Existing finer records survive
 * non-downgrade writes untouched (independence after init).
 */
export function applyMeaningCascade(
  entry: PassiveWordKnowledge,
  status: WordStatus,
  now: number,
  source: WordKnowledgeSource,
  easeForStatus: (status: WordStatus) => number,
  previousMeaningStatus: WordStatus | undefined,
  availableAspects: readonly KnowledgeAspect[],
): void {
  if (!entry.aspects) entry.aspects = {};
  const aspects = entry.aspects;
  const downgraded = previousMeaningStatus !== undefined && STATUS_RANK[status] < STATUS_RANK[previousMeaningStatus];

  for (const finer of dependentsOf('meaning', availableAspects)) {
    const record = aspects[finer];
    if (!record) {
      aspects[finer] = {
        status,
        ease: easeForStatus(status),
        source,
        lastStatusChange: now,
        updatedAt: now,
        inherited: true,
      };
    } else if (downgraded) {
      const squashed = minStatus(record.status, status);
      record.status = squashed;
      record.ease = easeForStatus(squashed);
      record.lastStatusChange = now;
      record.updatedAt = now;
    }
  }
}

export function aspectSourceToDisplay(source: KnowledgeSource | 'manual'): WordKnowledgeSource {
  return KNOWLEDGE_SOURCE_DISPLAY_NAMES[source];
}
