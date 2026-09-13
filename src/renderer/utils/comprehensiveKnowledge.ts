import { LEXICAL_IDENTITY_CAPABILITIES } from '../../shared/graph/access';
import { KNOWLEDGE_SOURCE_DISPLAY_NAMES, type KnowledgeSource, type WordStatus, type WordKnowledgeSource } from '../../shared/constants';
import type { IgnoredWordEntry, PassiveWordKnowledge } from '../../shared/types';
import { effectiveStateFromEntry, type EffectiveWordState, type EffectiveThresholds, type KnowledgeBasis } from '../../shared/knowledge/effectiveKnowledge';
/**
 * Comprehensive synchronous word status — Tier-2 semantics.
 *
 * effective status = active explicit claim ?? evidence projection.
 *
 * There is exactly ONE resolution path: the materialized projection of the
 * evidence journal (+ claims). Legacy bank voting (knownWordsList / srs / anki /
 * passiveTracking with order/highest/lowest modes) is deleted — those banks are
 * now *writers* (claims/evidence/migration backfill), never readers.
 *
 * `excluded` (ignored words) is teaching policy, not knowledge: status stays
 * honest and selection consumers gate on the flag.
 */

export interface ComprehensiveKnowledgeDeps {
  getCanonicalForm: (word: string) => string;
  getWordForms?: (word: string) => string[];
  hashWordSync: (word: string) => string;
  langKey: (language: string, hash: string) => string;
  language: string;
  ignoredWords: Record<string, IgnoredWordEntry>;
  wordKnowledge: Record<string, PassiveWordKnowledge>;
  knownEaseThreshold: number;
  learningThreshold: number;
}

export interface ComprehensiveWordStatusResult {
  status: WordStatus;
  basis: KnowledgeBasis;
  /** Classification of the underlying evidence alone (claim ignored). */
  evidenceStatus: WordStatus;
  /** Active explicit claim when basis === 'claim'. */
  claim?: WordStatus;
  source: WordKnowledgeSource;
  timesSeen: number;
  matchedWord?: string;
  ease?: number;
  /**
   * Teaching-policy exclusion (user said "do not select/teach/test this").
   * Exclusion is NOT knowledge: status stays honest ('unknown') and selection
   * surfaces must check this flag instead of treating the word as known.
   */
  excluded?: boolean;
}

interface WordFormMatch {
  word: string;
  lk: string;
}

function buildWordFormMatches(word: string, deps: ComprehensiveKnowledgeDeps): WordFormMatch[] {
  const forms = deps.getWordForms?.(word) ?? (() => {
    const canonical = deps.getCanonicalForm(word);
    return canonical && canonical !== word ? [canonical, word] : [word];
  })();
  const matches: WordFormMatch[] = [];
  const seen = new Set<string>();

  for (const form of forms) {
    const normalized = form.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    matches.push({
      word: normalized,
      lk: deps.langKey(deps.language, deps.hashWordSync(normalized)),
    });
  }

  return matches;
}

const STATUS_RANK: Record<WordStatus, number> = { unknown: 0, learning: 1, known: 2 };

function sourceLabel(basis: KnowledgeBasis, evidenceSource: string | undefined): WordKnowledgeSource {
  if (basis === 'claim') return 'Manual';
  if (basis === 'unmeasured') return 'None';
  return KNOWLEDGE_SOURCE_DISPLAY_NAMES[(evidenceSource ?? 'passiveTracking') as KnowledgeSource] ?? 'PassiveTracking';
}

interface ClaimCandidate {
  claimAt: number;
  effective: EffectiveWordState;
  matchedWord: string;
  timesSeen: number;
}

interface EvidenceCandidate {
  effective: EffectiveWordState;
  matchedWord: string;
  evidenceSource: string | undefined;
  timesSeen: number;
}
export function getComprehensiveWordStatusWithSource(
  word: string,
  deps: ComprehensiveKnowledgeDeps,
  scope: 'lexical' | 'sense' = 'lexical',
): ComprehensiveWordStatusResult {
  return resolveWordMatches(buildWordFormMatches(word, deps), deps, scope);
}

/** Already-addressed materialized keys use the same lexical resolver as text readers. */
export function getEffectiveWordStateForKeys(
  keys: readonly string[],
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  thresholds: EffectiveThresholds,
): ComprehensiveWordStatusResult {
  return resolveWordMatches(keys.map(lk => ({ lk, word: wordKnowledge[lk]?.word ?? lk })), {
    wordKnowledge, ignoredWords: {},
    learningThreshold: thresholds.learning, knownEaseThreshold: thresholds.known,
  }, 'lexical');
}

function resolveWordMatches(
  matches: readonly WordFormMatch[],
  deps: Pick<ComprehensiveKnowledgeDeps, 'wordKnowledge' | 'ignoredWords' | 'learningThreshold' | 'knownEaseThreshold'>,
  scope: 'lexical' | 'sense',
): ComprehensiveWordStatusResult {
  const thresholds = { learning: deps.learningThreshold, known: deps.knownEaseThreshold };

  let excluded = false;
  let bestEvidence: EvidenceCandidate | null = null;
  let bestClaim: ClaimCandidate | null = null;

  for (const match of matches) {
    if (deps.ignoredWords[match.lk]) excluded = true;
    const entry = deps.wordKnowledge[match.lk];
    const effective = effectiveStateFromEntry(entry, thresholds);

    // Claims are whole-identity statements: the latest claim across the
    // surface-form family wins — word-level and access-level claims compete
    // by the same recency rule.
    if (effective.basis === 'claim'
      && (!bestClaim || (entry?.claimAt ?? 0) > bestClaim.claimAt)) {
      bestClaim = {
        claimAt: entry?.claimAt ?? 0,
        effective,
        matchedWord: match.word,
        timesSeen: entry?.timesSeen ?? 0,
      };
    }

    // Learner-overlay promotion: a LEXICAL IDENTITY access with active
    // evidence or a claim makes the lexical object at least that known — a
    // word known by sound with a missing written-form bridge is NOT a wholly
    // unknown word. Non-identity accesses (prosody, reading) never promote
    // the word.
    //
    // Claims and evidence promote differently:
    // - CLAIMS about the lexical object come from the spoken access only
    //   ("I know this word when I hear it"). A surface-recognition claim is a
    //   statement about the written BRIDGE ("I have never seen this form") —
    //   it marks the bridge missing but must never demote the lexical
    //   object's summary. Sense claims are word-level (above).
    // - EVIDENCE promotes from every lexical identity access: written-path
    //   attempts and spoken attempts are equally measurements of the object.
    for (const capability of LEXICAL_IDENTITY_CAPABILITIES) {
      if (scope === 'sense') continue;
      const record = entry?.access?.[capability];
      if (!record) continue;
      const promotesClaims = capability === 'spoken-recognition';
      if (record.claim !== undefined && promotesClaims
        && (!bestClaim || (record.claimAt ?? 0) > bestClaim.claimAt)) {
        bestClaim = {
          claimAt: record.claimAt ?? 0,
          effective: {
            status: record.claim,
            basis: 'claim',
            evidenceStatus: record.status,
            claim: record.claim,
            hasEvidence: true,
            ease: record.ease,
          },
          matchedWord: match.word,
          timesSeen: entry?.timesSeen ?? 0,
        };
      }
      // Access records are written only by active attempts/claims — never
      // by passive exposure — so they satisfy the honesty gate by
      // construction. Strongest evidence wins; a weaker word-level read
      // never hides a stronger lexical access. A claim's UNDERLYING evidence
      // (record.status) still participates.
      if (!bestEvidence || STATUS_RANK[record.status] > STATUS_RANK[bestEvidence.effective.evidenceStatus]) {
        bestEvidence = {
          effective: {
            status: record.status,
            basis: 'evidence',
            evidenceStatus: record.status,
            hasEvidence: true,
            ease: record.ease,
          },
          matchedWord: match.word,
          evidenceSource: record.source,
          timesSeen: entry?.timesSeen ?? 0,
        };
      }
    }

    // Evidence resolves to the strongest form (fan-out writes keep forms in
    // sync; legacy entries may differ and the strongest is the honest read).
    if (
      effective.hasEvidence
      && (!bestEvidence || STATUS_RANK[effective.evidenceStatus] > STATUS_RANK[bestEvidence.effective.evidenceStatus]
        || (bestEvidence.effective.basis === 'unmeasured' && effective.basis !== 'unmeasured'))
    ) {
      bestEvidence = {
        effective,
        matchedWord: match.word,
        evidenceSource: entry?.lastEvidenceSource,
        timesSeen: entry?.timesSeen ?? 0,
      };
    }
  }

  if (bestClaim) {
    return {
      status: bestClaim.effective.status,
      basis: 'claim',
      evidenceStatus: bestClaim.effective.evidenceStatus,
      claim: bestClaim.effective.claim,
      source: 'Manual',
      timesSeen: bestClaim.timesSeen,
      matchedWord: bestClaim.matchedWord,
      ease: bestClaim.effective.ease,
      ...(excluded ? { excluded } : {}),
    };
  }

  if (bestEvidence) {
    // The effective basis rides along: pure passive entries (familiarity only,
    // REQ13) resolve unmeasured/unknown — Untracked — never evidence-backed
    // Learning/Unknown. Active evidence keeps basis 'evidence'.
    return {
      status: bestEvidence.effective.status,
      basis: bestEvidence.effective.basis,
      evidenceStatus: bestEvidence.effective.evidenceStatus,
      source: sourceLabel(bestEvidence.effective.basis, bestEvidence.evidenceSource),
      timesSeen: bestEvidence.timesSeen,
      matchedWord: bestEvidence.matchedWord,
      ease: bestEvidence.effective.ease,
      ...(excluded ? { excluded } : {}),
    };
  }

  return {
    status: 'unknown',
    basis: 'unmeasured',
    evidenceStatus: 'unknown',
    source: 'None',
    timesSeen: 0,
    ...(excluded ? { excluded } : {}),
  };
}

/**
 * Comprehensive synchronous word status check.
 */
export function getComprehensiveWordStatus(
  word: string,
  deps: ComprehensiveKnowledgeDeps
): WordStatus {
  return getComprehensiveWordStatusWithSource(word, deps).status;
}

/**
 * Selection-policy view of a resolved status for "should we suggest/capture
 * this word" — same effective status; kept as a named read so policy callsites
 * stay explicit.
 */
export function toSelectionBlockingStatus(resolved: ComprehensiveWordStatusResult): WordStatus {
  return resolved.status;
}

/**
 * Shorthand: is the word effectively known (claim or evidence)?
 */
export function isWordKnownComprehensive(
  word: string,
  deps: ComprehensiveKnowledgeDeps
): boolean {
  return getComprehensiveWordStatusWithSource(word, deps).status === 'known';
}
