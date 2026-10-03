import { createSignal } from 'solid-js';
import type { PolicyDecision } from '../learning/types';

/**
 * Pins one selection across an encounter (R20 review repair): the
 * selection memo re-runs on every unrelated reactive update (queue, card
 * store, settings subscriptions), but `selectNextEncounter` draws from an
 * unseeded rng by default — an unrelated re-run can silently replace the
 * displayed card, and after a reveal it can expose then rate a different
 * card. The scheduler fallback can itself change on an unrelated update
 * (including its random new/review interleaving). Pin the displayed identity
 * and its decision within a scope such as the active language, rather than
 * keying the encounter to that unstable fallback. Re-select only on an
 * explicit action, a scope change, or when the selection is no longer valid.
 *
 * Every explicit review action (rate/bury/remove/undo) increments the epoch
 * and clears the pin: a pinned decision must never outlive the action that
 * changed the pool — the displayed policy pick is often NOT the scheduler
 * fallback, so rating it must not replay it through a stale pin.
 */
export interface DecisionPin<Selection = PolicyDecision | null> {
  /** Retains the encounter's selection while it remains valid in this scope. */
  pin: (scopeId: string, compute: () => Selection, isValid?: (selection: Selection) => boolean) => Selection;
  /** Ends the active encounter so the next read selects afresh. */
  advance: () => void;
  peek: (scopeId: string) => Selection | undefined;
}

export function useDecisionPin<Selection = PolicyDecision | null>(): DecisionPin<Selection> {
  const [epoch, bumpEpoch] = createSignal(0);
  let pinned: { epoch: number; scopeId: string; selection: Selection } | undefined;
  return {
    peek(scopeId) { return pinned?.epoch === epoch() && pinned.scopeId === scopeId ? pinned.selection : undefined; },
    pin(scopeId, compute, isValid) {
      // Reading the epoch signal inside the caller's memo subscribes the
      // memo to `advance()` — an epoch bump forces a fresh selection.
      const currentEpoch = epoch();
      if (!pinned || pinned.epoch !== currentEpoch || pinned.scopeId !== scopeId
        || (isValid && !isValid(pinned.selection))) {
        pinned = { epoch: currentEpoch, scopeId, selection: compute() };
      }
      return pinned.selection;
    },
    advance() {
      pinned = undefined;
      bumpEpoch((current) => current + 1);
    },
  };
}
