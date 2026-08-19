import {
  type KnowledgeAspect,
  ASPECT_PREREQUISITES,
  SURFACE_SCOPED_ASPECTS,
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

export interface AspectStatusResult {
  status: WordStatus;
  ease: number;
  source: WordKnowledgeSource;
  inherited: boolean;
  /** True only for orthogonal aspects with no record: no evidence AND no chain to inherit from. */
  untracked?: boolean;
  lastStatusChange?: number;
}

/**
 * Read an aspect's status. Meaning delegates to the existing bank resolution
 * (it IS the meaning aspect). Every other aspect reads wordKnowledge aspect
 * records — surface-scoped aspects on the presented form's own hash, the rest
 * across the form family. No record means untracked: the graph is an
 * evidence/attribution structure, NOT a missing-state implication — meaning
 * known never fabricates reading/prosody knowledge (文脈 counterexample).
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
  // Surface-scoped aspects (reading, orthography) resolve on the presented
  // form's own hash only: mapping 流石 to its pronunciation says nothing about
  // さすが and vice versa — the family unification below is exactly the
  // lexical-scope sharing they must not get.
  const matches: FormMatch[] = SURFACE_SCOPED_ASPECTS.includes(aspect)
    ? [{ lk: deps.langKey(deps.language, deps.hashWordSync(word.trim())) }]
    : buildFormMatches(word, deps);
  for (const match of matches) {
    const record = deps.wordKnowledge[match.lk]?.aspects?.[aspect];
    if (!record) continue;
    const result: AspectStatusResult = {
      status: record.status,
      ease: record.ease,
      source: record.source,
      // Legacy flag from the removed meaning-cascade seed; nothing writes it anymore.
      inherited: record.inherited === true,
      lastStatusChange: record.lastStatusChange,
    };
    const rank = STATUS_RANK[record.status];
    if (!best || rank > best.rank) {
      best = { result, rank };
    }
  }
  if (best) return best.result;

  return { status: 'unknown', ease: 0, source: 'None', inherited: false, untracked: true };
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
 *
 * Currently production-dead (tests only). If revived: untracked aspects now
 * contribute strength 0 where they previously inherited the meaning strength —
 * decide explicitly whether to exclude untracked aspects from the denominator
 * (like unavailable aspects) instead of letting them drag blends down.
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

export function aspectSourceToDisplay(source: KnowledgeSource | 'manual'): WordKnowledgeSource {
  return KNOWLEDGE_SOURCE_DISPLAY_NAMES[source];
}

/**
 * Apply a direct aspect write onto ONE wordKnowledge entry (caller iterates
 * every surface-form hash per the split-hash rule, except surface-scoped
 * aspects). Aspects are independent stored state: no downgrade propagation
 * into dependents, no inherited seeding — the graph's prerequisite edges
 * govern attribution-time evidence only (what a failure's traversal
 * demonstrates), never stored-state implication. Combos like meaning unknown +
 * reading known are valid and must survive any write.
 */
export function applyAspectWrite(
  entry: PassiveWordKnowledge,
  input: AspectWriteInput,
): void {
  if (!entry.aspects) entry.aspects = {};
  entry.aspects[input.aspect] = {
    status: input.status,
    ease: input.ease,
    source: input.source,
    lastStatusChange: input.now,
    updatedAt: input.now,
  };
}

/**
 * Meaning-aspect cascade — REMOVED. The aspect graph is an evidence/attribution
 * structure, not a persistent-state implication graph: a meaning downgrade must
 * not destroy reading/pronunciation/prosody/orthography evidence (端 read as
 * はし while forgetting what it means is valid knowledge). Attribution-time
 * positive evidence lives in FlashcardContext.attributeKnowledgeFailure.
 */
