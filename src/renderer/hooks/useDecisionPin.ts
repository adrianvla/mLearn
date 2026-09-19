import { createSignal } from 'solid-js';
import type { PolicyDecision } from '../learning/types';

/**
 * Pins one policy decision across an encounter (R20 review repair): the
 * selection memo re-runs on every unrelated reactive update (queue, card
 * store, settings subscriptions), but `selectNextEncounter` draws from an
 * unseeded rng by default — an unrelated re-run can silently replace the
 * displayed card, and after a reveal it can expose then rate a different
 * card. Each pin is keyed by `${epoch}:${fallbackId}` and re-served until an
 * explicit review action ends the encounter, so an unrelated reactive update
 * re-reads the SAME decision instead of re-drawing — including a fallback
 * that cycles A→B→A within one encounter without an action.
 *
 * Every explicit review action (rate/bury/remove/undo) increments the epoch
 * and clears the pins: a pinned decision must never outlive the action that
 * changed the pool — the displayed policy pick is often NOT the scheduler
 * fallback, so rating it must not replay it through a stale pin.
 */
export interface DecisionPin {
  /** Returns the pinned decision, computing it once per encounter+fallback. */
  pin: (fallbackId: string, compute: () => PolicyDecision | null) => PolicyDecision | null;
  /** Ends the active encounter: drops every pin so the next read selects afresh. */
  advance: () => void;
}

export function useDecisionPin(): DecisionPin {
  const [epoch, bumpEpoch] = createSignal(0);
  const pins = new Map<string, PolicyDecision | null>();
  return {
    pin(fallbackId, compute) {
      // Reading the epoch signal inside the caller's memo subscribes the
      // memo to `advance()` — an epoch bump re-runs the memo against
      // cleared pins and forces a fresh selection.
      const key = `${epoch()}:${fallbackId}`;
      if (!pins.has(key)) pins.set(key, compute());
      return pins.get(key)!;
    },
    advance() {
      pins.clear();
      bumpEpoch((current) => current + 1);
    },
  };
}
