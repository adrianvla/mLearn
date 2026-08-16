/**
 * Speaker selection — conversational runtime overhaul Phase 1.
 *
 * Deterministic harness logic: given the room roster and model-derived
 * signals computed during normal cognition, pick ONE participant to speak
 * after a user turn. Pure function of its inputs — no inference, no
 * randomness, no I/O, no module state.
 *
 * Contract source: .sisyphus/plans/conversational-runtime-overhaul.md
 * Phase 1 (D2+ selector consumes model-derived state; D17+ eligibility is
 * computed from facets, never from a role taxonomy).
 */

import type { Participant } from './world';

/** Model-derived signals gathered during cognition; every field optional. */
export interface SpeakerSignals {
  /** Text of the most recent message event (used for direct-address detection). */
  lastEventText?: string;
  /** Participant id of whoever spoke last. */
  lastSpeakerId?: string;
  /** participantId → 0..1 openness/urgency to speak; model-derived. */
  openLoopUrgency?: Record<string, number>;
  /** participantId → 0..1 pull toward the conversation; model-derived. */
  relationshipPull?: Record<string, number>;
}

/** Tunables for `selectSpeaker`. */
export interface SpeakerSelectionConfig {
  /** Minimum `speaking_propensity` for a participant to be eligible. */
  propensityFloor: number;
}

export const DEFAULT_SPEAKER_SELECTION_CONFIG: SpeakerSelectionConfig = {
  propensityFloor: 0.1,
};

/**
 * Pick the next speaker for a user turn.
 *
 * Eligibility (computed from facets, no role taxonomy):
 *   propensity(p)  = Number(p.facets?.speaking_propensity ?? 1)  — missing facet = full propensity
 *   addressedByName(p) = signals.lastEventText contains p.displayName, case-insensitive
 *   eligible(p) ⟺ addressedByName(p) OR propensity(p) >= floor
 *
 * Score (higher wins; ties break on lexicographically smallest id):
 *   2*propensity + openLoopUrgency[p.id] + relationshipPull[p.id]
 *   + (addressedByName ? 10 : 0)
 *   − 1 if p is the last speaker AND at least one other participant is eligible
 *     (the penalty must never silence a 1-on-1 room's only eligible voice).
 *
 * @param participants Room roster. Empty → null.
 * @param signals Optional model-derived signals; all fields optional.
 * @param config Optional overrides (merged over defaults).
 * @returns Winning participant id, or null when nobody is eligible (silence is valid).
 */
export function selectSpeaker(
  participants: Participant[],
  signals?: SpeakerSignals,
  config?: Partial<SpeakerSelectionConfig>,
): string | null {
  const { propensityFloor } = { ...DEFAULT_SPEAKER_SELECTION_CONFIG, ...config };
  const lastEventText = signals?.lastEventText?.toLowerCase();

  const eligible = new Map<string, boolean>();
  for (const p of participants) {
    eligible.set(p.id, isEligible(p, lastEventText, propensityFloor));
  }
  const anyOtherEligible = (id: string): boolean =>
    [...eligible.entries()].some(([otherId, e]) => e && otherId !== id);

  let winner: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const p of participants) {
    if (!eligible.get(p.id)) continue;
    const score = scoreParticipant(p, signals, lastEventText, anyOtherEligible(p.id));
    if (score > bestScore || (score === bestScore && (winner === null || p.id < winner))) {
      bestScore = score;
      winner = p.id;
    }
  }
  return winner;
}

function isEligible(
  p: Participant,
  lastEventText: string | undefined,
  floor: number,
): boolean {
  return (
    lastEventText !== undefined && lastEventText.includes(p.displayName.toLowerCase())
  ) || propensity(p) >= floor;
}

function propensity(p: Participant): number {
  return Number(p.facets?.speaking_propensity ?? 1);
}

function scoreParticipant(
  p: Participant,
  signals: SpeakerSignals | undefined,
  lastEventText: string | undefined,
  penalizeAsLastSpeaker: boolean,
): number {
  const prop = propensity(p);
  let score =
    2 * prop +
    (signals?.openLoopUrgency?.[p.id] ?? 0) +
    (signals?.relationshipPull?.[p.id] ?? 0);
  if (lastEventText !== undefined && lastEventText.includes(p.displayName.toLowerCase())) {
    score += 10;
  }
  if (penalizeAsLastSpeaker && signals?.lastSpeakerId === p.id) {
    score -= 1;
  }
  return score;
}
