/**
 * Pure flashcard-store merge shared by the electron tether endpoint and the
 * renderer sync service.
 *
 * Mirrors the renderer-side merge semantics (`flashcardSyncService.mergeFlashcards`
 * and `FlashcardContext.mergeKnowledgeMaps`) so a tethered/mobile client POSTing a
 * whole `FlashcardStore` snapshot to `/api/flashcards` can no longer erase newer
 * desktop state with a stale snapshot. Collections merge per-key; collections
 * absent from the incoming store never delete current data.
 *
 * Tier-2 honesty: a sync snapshot carries materialized knowledge but not the
 * journal that proves it. `sanitizeSyncedKnowledgeEntry` strips the epistemic
 * truth fields a remote payload cannot vouch for (active-evidence markers,
 * explicit status-change markers), and `deriveSyncKnowledgeJournal` turns every
 * applied entry into provenance-marked journal events (passive-strength ease
 * rollups + explicit claims) so the receiving device's replay rebuilds exactly
 * what the merge materialized.
 *
 * Must stay importable from electron and renderer alike: no renderer/electron
 * imports, no fs access, and no wall-clock reads (fully deterministic).
 */

import type { KnowledgeEvent, KnowledgeEventLog } from '../knowledgeEvents';
import type {
  Flashcard,
  FlashcardStore,
  IgnoredWordEntry,
  PassiveWordKnowledge,
  WordCandidate,
} from '../types';

/**
 * Epistemic truth a sync payload cannot prove on the receiving device:
 * `hasActiveEvidence`/`lastEvidenceSource` gate the honest-Known display and
 * `lastStatusChange`/`statusChangedAtSeen` mark explicit status history — none
 * of it travels with a journal, so adopting it would let sync invent Tier-1
 * truth (REQ2 violation). The receiving device's own active-evidence markers
 * stay. `wordSyncRatedAt` is a re-ask policy marker (not knowledge truth) and
 * is preserved; `deriveSyncKnowledgeJournal` mirrors it as event provenance.
 */
export function sanitizeSyncedKnowledgeEntry(
  entry: PassiveWordKnowledge,
  local: PassiveWordKnowledge | undefined,
): PassiveWordKnowledge {
  const sanitized: PassiveWordKnowledge = { ...entry };
  delete sanitized.hasActiveEvidence;
  delete sanitized.lastEvidenceSource;
  delete sanitized.lastStatusChange;
  delete sanitized.statusChangedAtSeen;
  if (local?.hasActiveEvidence === true) {
    sanitized.hasActiveEvidence = true;
    if (local.lastEvidenceSource !== undefined) sanitized.lastEvidenceSource = local.lastEvidenceSource;
  }
  return sanitized;
}

/**
 * Journal projection of the epistemic state a merge applied from a remote
 * payload (keys are the store's `${language}:${hash}` keys):
 * - ease lands as a `passiveTracking` rollup — passive strength, never an
 *   active promotion, and `origin` carries the sync provenance ('word-sync'
 *   when the entry was explicitly rated in the word-sync channel, so replay
 *   restores the wordSyncRatedAt policy marker);
 * - an explicit claim lands as a `source: 'manual'` claim event with
 *   `origin: 'sync'`, stamped at the original claimAt so the claim semantics
 *   survive the hop. 'sync' is deliberately NOT a status source: claims are
 *   classification overrides, never evidence.
 * `source: 'sync'` itself is not a valid EvidenceSource and would be dropped
 * by the journal validator — the sources above are the contract.
 */
export function deriveSyncKnowledgeJournal(
  applied: ReadonlyArray<readonly [string, PassiveWordKnowledge]>,
): KnowledgeEventLog {
  const log: KnowledgeEventLog = {};
  for (const [lk, entry] of applied) {
    const events: KnowledgeEvent[] = [];
    const easeAnchor = entry.wordSyncRatedAt ?? entry.lastStatusChange ?? entry.lastSeen ?? 0;
    if (typeof entry.ease === 'number' && Number.isFinite(entry.ease)) {
      events.push({
        t: easeAnchor,
        kind: 'rollup',
        source: 'passiveTracking',
        aspect: 'meaning',
        easeAfter: entry.ease,
        origin: entry.wordSyncRatedAt !== undefined ? 'word-sync' : 'sync',
      });
    }
    if (entry.claim !== undefined) {
      events.push({
        t: entry.claimAt ?? easeAnchor,
        kind: 'claim',
        source: 'manual',
        aspect: 'meaning',
        origin: 'sync',
        toStatus: entry.claim,
      });
    }
    if (events.length > 0) {
      log[lk] = events.sort((a, b) => a.t - b.t);
    }
  }
  return log;
}

/**
 * Per-entry LWW: the entry with the higher recency anchor wins; on a tie the
 * current entry stays. Recency anchors are read from the RAW incoming entry
 * (before sanitization) so a remote explicit status change still counts as
 * recency even though the marker itself is not adopted. Applied entries are
 * returned so callers can journal them; sanitized entries carry no epistemic
 * truth the receiving device's journal lacks.
 */
function mergeWordKnowledge(
  current: Record<string, PassiveWordKnowledge>,
  incoming: Record<string, PassiveWordKnowledge>,
): Array<[string, PassiveWordKnowledge]> {
  const recency = (entry: PassiveWordKnowledge): number => entry.claimAt ?? entry.lastStatusChange ?? entry.lastSeen ?? 0;
  const applied: Array<[string, PassiveWordKnowledge]> = [];
  for (const [lk, entry] of Object.entries(incoming)) {
    const existing = current[lk];
    if (!existing || recency(entry) > recency(existing)) {
      const sanitized = sanitizeSyncedKnowledgeEntry(entry, existing);
      current[lk] = sanitized;
      applied.push([lk, sanitized]);
    }
  }
  return applied;
}

/**
 * Merge result plus the journal projection of every epistemic state the merge
 * applied from `incoming`.
 */
export interface MergeFlashcardStoresResult {
  store: FlashcardStore;
  /** Events keyed by `${language}:${hash}`; empty when nothing epistemic was applied. */
  journal: KnowledgeEventLog;
}

/**
 * Merge `incoming` (a client snapshot) into `current` (the persisted store)
 * without mutating either input. Returns the merged store AND the
 * provenance-marked journal events covering the applied epistemic state:
 * receivers append the journal (via appendEvents / appendKnowledgeEvents)
 * so replay rebuilds what the merge materialized instead of trusting an
 * unproven remote snapshot.
 */
export function mergeFlashcardStoresWithJournal(current: FlashcardStore, incoming: FlashcardStore): MergeFlashcardStoresResult {
  const merged: FlashcardStore = JSON.parse(JSON.stringify(current));

  // Defensive: stores persisted by older builds may lack newer collections.
  merged.flashcards ??= {};
  merged.wordCandidates ??= {};
  merged.knownUntracked ??= {};
  merged.ignoredWords ??= {};
  merged.wordKnowledge ??= {};
  merged.wordSyncSeen ??= {};

  const appliedKnowledge = mergeWordKnowledge(merged.wordKnowledge, incoming.wordKnowledge ?? {});
  for (const [lk, value] of Object.entries(incoming.knownUntracked ?? {})) {
    if (value && !merged.knownUntracked[lk]) merged.knownUntracked[lk] = value;
  }
  for (const [lk, entry] of Object.entries(incoming.ignoredWords ?? {})) {
    const existing: IgnoredWordEntry | undefined = merged.ignoredWords[lk];
    if (!existing || entry.ignoredAt > existing.ignoredAt) merged.ignoredWords[lk] = entry;
  }
  for (const [lk, seen] of Object.entries(incoming.wordSyncSeen ?? {})) {
    if (seen > (merged.wordSyncSeen[lk] ?? 0)) merged.wordSyncSeen[lk] = seen;
  }

  // Word candidates union-max (ported from flashcardSyncService). Legacy numeric
  // payloads carry no timestamp, so they cannot win the lastSeen comparison.
  for (const [key, value] of Object.entries(incoming.wordCandidates ?? {})) {
    const existing = merged.wordCandidates[key];
    const remote: WordCandidate = typeof value === 'number'
      ? { count: value, lastSeen: 0, word: key }
      : value;
    if (!existing) {
      merged.wordCandidates[key] = remote;
    } else {
      merged.wordCandidates[key] = {
        word: existing.word || remote.word || key,
        count: Math.max(existing.count || 0, remote.count || 0),
        lastSeen: Math.max(existing.lastSeen || 0, remote.lastSeen || 0),
        reading: existing.reading || remote.reading,
      };
    }
  }

  // Per-card merge (ported from flashcardSyncService): the side with more
  // reviews wins; on a review tie the newer lastUpdated wins; a card that only
  // carries a fresher lastUpdated contributes content fields; equal on both
  // keeps the current card. Content merges shallowly local-first, except
  // example (longer wins) and imageUrl (existing wins) on the reviews branch.
  for (const [cardId, remoteCard] of Object.entries(incoming.flashcards ?? {})) {
    const localCard: Flashcard | undefined = merged.flashcards[cardId];
    if (!localCard) {
      merged.flashcards[cardId] = { ...remoteCard, content: { ...remoteCard.content } };
      continue;
    }
    const localReviews = localCard.reviews || 0;
    const remoteReviews = remoteCard.reviews || 0;
    const localUpdated = localCard.lastUpdated || 0;
    const remoteUpdated = remoteCard.lastUpdated || 0;

    if (remoteReviews > localReviews ||
        (remoteReviews === localReviews && remoteUpdated > localUpdated)) {
      merged.flashcards[cardId] = {
        ...remoteCard,
        content: {
          ...localCard.content,
          ...remoteCard.content,
          example: (remoteCard.content.example?.length || 0) > (localCard.content.example?.length || 0)
            ? remoteCard.content.example
            : localCard.content.example,
          imageUrl: localCard.content.imageUrl || remoteCard.content.imageUrl,
        },
      };
    } else if (remoteUpdated > localUpdated) {
      merged.flashcards[cardId] = {
        ...localCard,
        content: { ...localCard.content, ...remoteCard.content },
        lastUpdated: remoteUpdated,
      };
    }
  }

  return { store: merged, journal: deriveSyncKnowledgeJournal(appliedKnowledge) };
}

/**
 * Store-only convenience wrapper; prefer `mergeFlashcardStoresWithJournal` at
 * sync ingestion sites so the journal travels with the merge.
 */
export function mergeFlashcardStores(current: FlashcardStore, incoming: FlashcardStore): FlashcardStore {
  return mergeFlashcardStoresWithJournal(current, incoming).store;
}
