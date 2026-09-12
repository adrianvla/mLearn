import {
  type KnowledgeAspect,
  type KnowledgeSource,
  KNOWLEDGE_SOURCE_DISPLAY_NAMES,
  type WordStatus,
  type WordKnowledgeSource,
} from '../../shared/constants';
import { CAPABILITY_ASPECT, demonstratesOf, migrateAspectRecordsToAccess, type AccessCue } from '../../shared/graph/access';
import type { CapabilityKind } from '../../shared/graph/types';
import type { CapabilityKey, PassiveWordKnowledge } from '../../shared/types';
import { isSurfaceScopedCapability } from '../../shared/graph/targets';
import {
  type ComprehensiveKnowledgeDeps,
  getComprehensiveWordStatusWithSource,
} from './comprehensiveKnowledge';

export { migrateAspectRecordsToAccess };
/** Capabilities a rating row can address directly (sense knowledge rides the word-level projection). */
export type RatedCapability = CapabilityKey;

const STATUS_RANK: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };

export interface AccessStatusResult {
  status: WordStatus;
  ease: number;
  source: WordKnowledgeSource;
  /** True only for accesses with no record: no evidence AND no claim. */
  untracked?: boolean;
  lastStatusChange?: number;
  /** Where the status comes from: an explicit user claim overrides evidence. */
  basis?: 'claim' | 'evidence';
  claim?: WordStatus;
}

/**
 * Read one access's status. Sense recognition delegates to the word-level
 * projection (it IS the meaning access). Every other access reads the
 * materialized capability-keyed records — surface-scoped accesses
 * (surface-recognition, surface-reading) on the presented form's own hash,
 * the rest across the form family. No record means untracked: the overlay is
 * an evidence/attribution structure, NOT a missing-state implication — sense
 * knowledge never fabricates reading/prosody/spoken knowledge (文脈
 * counterexample).
 */
export function getAccessStatusSync(
  word: string,
  capability: CapabilityKey,
  deps: ComprehensiveKnowledgeDeps,
): AccessStatusResult {
  if (capability === 'sense-recognition') {
    const meaning = getComprehensiveWordStatusWithSource(word, deps, 'sense');
    return {
      status: meaning.status,
      ease: meaning.ease ?? (meaning.status === 'known' ? deps.knownEaseThreshold : meaning.status === 'learning' ? deps.learningThreshold : 0),
      source: meaning.source,
      untracked: meaning.basis === 'unmeasured',
      ...(meaning.basis === 'claim' || meaning.basis === 'evidence' ? { basis: meaning.basis } : {}),
      ...(meaning.claim !== undefined ? { claim: meaning.claim } : {}),
    };
  }

  let best: { result: AccessStatusResult; rank: number } | null = null;
  // Surface-scoped accesses resolve on the presented form's own hash only:
  // mapping 流石 to its pronunciation says nothing about さすが and vice
  // versa — the family unification below is exactly the lexical-scope
  // sharing they must not get.
  const matches: FormMatch[] = isSurfaceScopedCapability(capability)
    ? [{ lk: deps.langKey(deps.language, deps.hashWordSync(word.trim())) }]
    : buildFormMatches(word, deps);
  for (const match of matches) {
    const record = deps.wordKnowledge[match.lk]?.access?.[capability];
    if (!record) continue;
    const result: AccessStatusResult = {
      status: record.claim ?? record.status,
      ease: record.ease,
      source: record.claim !== undefined ? 'Manual' : record.source,
      lastStatusChange: record.lastStatusChange,
      ...(record.claim !== undefined
        ? { basis: 'claim' as const, claim: record.claim }
        : { basis: 'evidence' as const }),
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

export interface AccessWriteInput {
  capability: CapabilityKey;
  status: WordStatus;
  ease: number;
  source: WordKnowledgeSource;
  now: number;
}

/**
 * Task-mediated traversal decomposition for a rating row — the accesses this
 * measurement proves were traversed, given how the learner was cued.
 * Attribution-time evidence only; never stored-state implication.
 */
export function demonstratesFor(capability: CapabilityKind, cue: AccessCue = 'written-form'): readonly CapabilityKind[] {
  return demonstratesOf(capability, cue);
}

/**
 * The legacy aspect value for a capability's journal events, when the mapping
 * is lossless. Capabilities without a legacy aspect (spoken-recognition,
 * character-reading, morpheme-recognition) write no aspect field — the
 * event's targetRef.capability is the only address.
 */
export function legacyAspectFor(capability: CapabilityKey): KnowledgeAspect | undefined {
  for (const [key, aspect] of Object.entries(CAPABILITY_ASPECT)) {
    if (key === capability) return aspect;
  }
  return undefined;
}

export function aspectSourceToDisplay(source: KnowledgeSource | 'manual'): WordKnowledgeSource {
  return KNOWLEDGE_SOURCE_DISPLAY_NAMES[source];
}

/**
 * Apply a direct access write onto ONE wordKnowledge entry (caller iterates
 * every surface-form hash per the split-hash rule, except surface-scoped
 * accesses). Accesses are independent stored state: no downgrade propagation,
 * no inherited seeding — access-path decomposition governs attribution-time
 * evidence only (what a measurement's traversal demonstrates), never
 * stored-state implication. Combos like sense unknown + reading known are
 * valid and must survive any write.
 */
export function applyAccessWrite(
  entry: PassiveWordKnowledge,
  input: AccessWriteInput,
): void {
  if (!entry.access) entry.access = {};
  entry.access[input.capability] = {
    status: input.status,
    ease: input.ease,
    source: input.source,
    lastStatusChange: input.now,
    updatedAt: input.now,
  };
}
