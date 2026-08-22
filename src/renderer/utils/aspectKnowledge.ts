import {
  type KnowledgeAspect,
  ASPECT_PREREQUISITES,
  type KnowledgeSource,
  KNOWLEDGE_SOURCE_DISPLAY_NAMES,
  type WordStatus,
  type WordKnowledgeSource,
} from '../../shared/constants';
import type { PassiveWordKnowledge } from '../../shared/types';
import { isSurfaceScopedAspect } from '../../shared/graph/targets';
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
    };
  }

  let best: { result: AspectStatusResult; rank: number } | null = null;
  // Surface-scoped aspects (reading, orthography → surface-reading/recognition
  // capabilities) resolve on the presented form's own hash only: mapping 流石
  // to its pronunciation says nothing about さすが and vice versa — the family
  // unification below is exactly the lexical-scope sharing they must not get.
  const matches: FormMatch[] = isSurfaceScopedAspect(aspect)
    ? [{ lk: deps.langKey(deps.language, deps.hashWordSync(word.trim())) }]
    : buildFormMatches(word, deps);
  for (const match of matches) {
    const record = deps.wordKnowledge[match.lk]?.aspects?.[aspect];
    if (!record) continue;
    const result: AspectStatusResult = {
      status: record.status,
      ease: record.ease,
      source: record.source,
      lastStatusChange: record.lastStatusChange,
    };
    const rank = STATUS_RANK[record.status];
    if (!best || rank > best.rank) {
      best = { result, rank };
    }
  }
  if (best) return best.result;

  return { status: 'unknown', ease: 0, source: 'None', untracked: true };
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
