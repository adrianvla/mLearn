import { createComputed, createMemo, createSignal, mapArray, onCleanup, type Accessor } from 'solid-js';
import type { FlashcardStore, PassiveWordKnowledge } from '../../shared/types';
import type { EffectiveThresholds } from '../../shared/knowledge/effectiveKnowledge';
import { getEffectiveWordStateForKeys } from './comprehensiveKnowledge';

/** Index canonical lexical state; card ownership and legacy markers are not evidence. */
export function buildKnownWordSet(
  wordKnowledge: Record<string, PassiveWordKnowledge>,
  thresholds: EffectiveThresholds,
  keysForEntry?: (key: string, entry: PassiveWordKnowledge) => readonly string[],
): Set<string> {
  const known = new Set<string>();
  for (const lk of Object.keys(wordKnowledge)) {
    if (getEffectiveWordStateForKeys(keysForEntry?.(lk, wordKnowledge[lk]) ?? [lk], wordKnowledge, thresholds).status === 'known') {
      known.add(lk);
    }
  }

  return known;
}

/**
 * Build a Set from the full FlashcardStore for convenience.
 */
export function buildKnownWordSetFromStore(
  store: FlashcardStore,
  thresholds: EffectiveThresholds,
  keysForEntry?: (key: string, entry: PassiveWordKnowledge) => readonly string[],
): Set<string> {
  return buildKnownWordSet(store.wordKnowledge, thresholds, keysForEntry);
}

/** Keep each family's dependencies separate so one rating resolves only that family. */
export function createKnownWordSet(
  wordKnowledge: Accessor<Record<string, PassiveWordKnowledge>>,
  thresholds: Accessor<EffectiveThresholds>,
  keysForEntry: (key: string, entry: PassiveWordKnowledge) => readonly string[],
): Accessor<Set<string>> {
  const members = new Set<string>();
  const [revision, setRevision] = createSignal(0);
  const setMembership = (key: string, known: boolean): void => {
    if (members.has(key) === known) return;
    if (known) members.add(key);
    else members.delete(key);
    setRevision(value => value + 1);
  };
  const entries = mapArray(() => Object.keys(wordKnowledge()), (key) => {
    createComputed(() => {
      const knowledge = wordKnowledge();
      const entry = knowledge[key];
      setMembership(key, entry !== undefined
        && getEffectiveWordStateForKeys(keysForEntry(key, entry), knowledge, thresholds()).status === 'known');
    });
    onCleanup(() => setMembership(key, false));
    return key;
  });
  // Drive key ownership once, rather than giving the aggregate memo a reactive
  // dependency on every row. A changed family updates only its Set membership.
  createComputed(() => entries());
  return createMemo(() => {
    revision();
    return new Set(members);
  });
}

export function buildTrackedWordSet(store: FlashcardStore, language: string): Set<string> {
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
  // Orphan legacy markers have neither a recoverable word nor canonical evidence.
  // The existing migration adds recoverable claims to wordKnowledge above.
  for (const lk of Object.keys(store.ignoredWords)) if (lk.startsWith(prefix)) tracked.add(lk);
  return tracked;
}
