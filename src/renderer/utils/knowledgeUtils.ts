import type { Flashcard, FlashcardStore, PassiveWordKnowledge, IgnoredWordEntry } from '../../shared/types';

/** Anki-bank status keys folded into the O(n) set builders (structural — produced by services/ankiWordsCache). */
export interface AnkiWordStatusKeys {
  known: ReadonlySet<string>;
  learning: ReadonlySet<string>;
}

/**
 * Builds a Set of language-prefixed word hashes that are Tier-2 known.
 * O(n) to build, O(1) to query.
 *
 * Known rule (mirrors effectiveKnowledge.ts exactly):
 * - wordKnowledge entries with an explicit claim === 'known' (user statement)
 * - OR entries whose ease >= threshold AND hasActiveEvidence === true
 *   (SRS review / Anki / attempt / migration evidence). Pure passive exposure
 *   never establishes Known — the ease must be backed by active evidence.
 * An explicit claim wins regardless of ease; a 'learning'/'unknown' claim
 * keeps the word out even if ease is high.
 *
 * Flashcards in 'review' state are NOT knowledge on their own: their reviews
 * are evidence events, and legacy review cards were migration-backfilled into
 * wordKnowledge — so the wordKnowledge projection decides. Cards still count
 * only when the co-located wordKnowledge entry qualifies (their reviews are
 * what made hasActiveEvidence true).
 *
 * knownUntracked is unioned only as legacy residue: stores migrated from
 * pre-Tier-2 keep orphan hashes there, and dropping them would silently
 * un-know words the user once marked. New code never writes knownUntracked —
 * claims land in wordKnowledge instead.
 *
 * anki bank keys are kept when supplied: Anki activity is active evidence.
 *
 * ignoredWords deliberately NOT included: exclusion is teaching policy, not
 * knowledge. Use store.ignoredWords keys directly where selection needs them.
 *
 * remaining legacy params (flashcards/wordToCardMap) are accepted for caller
 * compatibility but no longer consulted — the co-located word knowledge
 * projection is the single source of truth.
 */
export function buildKnownWordSet(
  _flashcards: Record<string, Flashcard>,
  _wordToCardMap: Record<string, string[]>,
  knownUntracked: Record<string, boolean>,
  _ignoredWords: Record<string, IgnoredWordEntry>,
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  knownEaseThreshold: number,
  ankiKnownKeys?: ReadonlySet<string>,
): Set<string> {
  // Legacy residue: pre-Tier-2 stores keep orphan hashes here. Union preserves
  // past user "known" marks; never written by new code.
  const known = new Set<string>(Object.keys(knownUntracked));

  const threshold = knownEaseThreshold / 1000;
  for (const [lk, knowledge] of Object.entries(wordKnowledge)) {
    // An active claim overrides the evidence classification (claim ?? evidence):
    // only a 'known' claim admits the word; a 'learning'/'unknown' claim keeps
    // it out even when the ease is high and evidence is active.
    if (knowledge.claim === 'known') {
      known.add(lk);
    } else if (knowledge.claim === undefined && knowledge.ease >= threshold && knowledge.hasActiveEvidence === true) {
      known.add(lk);
    }
  }

  if (ankiKnownKeys) for (const lk of ankiKnownKeys) known.add(lk);

  return known;
}

/**
 * Quick check if a language-prefixed word key is known using a pre-built Set.
 * Falls back to individual store checks (same Tier-2 rule as the Set builder)
 * for keys not in the Set.
 */
export function isWordKnown(
  lk: string,
  knownSet: Set<string>,
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  knownEaseThreshold: number,
): boolean {
  if (knownSet.has(lk)) return true;

  const knowledge = wordKnowledge[lk];
  if (!knowledge) return false;
  if (knowledge.claim === 'known') return true;
  if (knowledge.claim !== undefined) return false;
  return knowledge.ease >= knownEaseThreshold / 1000 && knowledge.hasActiveEvidence === true;
}

/**
 * Build a Set from the full FlashcardStore for convenience.
 */
export function buildKnownWordSetFromStore(
  store: FlashcardStore,
  knownEaseThreshold: number,
  ankiKnownKeys?: ReadonlySet<string>,
): Set<string> {
  return buildKnownWordSet(
    store.flashcards,
    store.wordToCardMap,
    store.knownUntracked,
    store.ignoredWords,
    store.wordKnowledge,
    knownEaseThreshold,
    ankiKnownKeys,
  );
}

export function buildTrackedWordSet(store: FlashcardStore, language: string, ankiKeys?: AnkiWordStatusKeys): Set<string> {
  const tracked = new Set<string>();
  const prefix = language + ':';
  for (const lk of Object.keys(store.wordToCardMap)) if (lk.startsWith(prefix)) tracked.add(lk);
  // Tier-2: claim-bearing entries are a primary knowledge source and must
  // always stay tracked (the wordKnowledge scan below also covers them; kept
  // explicit so a claim can never regress to 'untracked').
  for (const [lk, knowledge] of Object.entries(store.wordKnowledge)) {
    if (lk.startsWith(prefix) && knowledge.claim !== undefined) tracked.add(lk);
  }
  for (const lk of Object.keys(store.wordKnowledge)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.wordCandidates)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.knownUntracked)) if (lk.startsWith(prefix)) tracked.add(lk);
  for (const lk of Object.keys(store.ignoredWords)) if (lk.startsWith(prefix)) tracked.add(lk);
  if (ankiKeys) {
    for (const lk of ankiKeys.known) if (lk.startsWith(prefix)) tracked.add(lk);
    for (const lk of ankiKeys.learning) if (lk.startsWith(prefix)) tracked.add(lk);
  }
  return tracked;
}