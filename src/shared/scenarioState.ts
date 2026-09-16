/**
 * Authoritative scenario state — one pure derivation of a persisted Scenario's
 * CURRENT truth from the durable evolution chain plus the journal's correction
 * tombstones. Canonical code owns eligibility (KNOW-07): consumers never trust
 * stored materialized state over this derivation.
 *
 * Rules:
 * - A development or goal change whose cited source events are all still valid
 *   contributes; cited sources that are tombstoned invalidate the entry.
 * - A retraction removes its target development from the current view; the
 *   retraction itself is ignored when its own sources are invalidated.
 * - The last surviving resolution/reopen entry determines current status;
 *   correcting a reopening restores the previous valid conclusion. Stored
 *   status is a materialized cache, never the lifecycle authority.
 * - Current goals = the participant's base goals plus the still-valid change
 *   chain, in order. Base goals are never mutated in place.
 *
 * History is never rewritten: the stored spec is returned UNTOUCHED and the
 * current view is a separate derivation. Nothing here persists anything. Pure:
 * no I/O, no clock, no randomness.
 */

import type { JournalEvent, ScenarioDevelopment, ScenarioGoalChange, ScenarioRetraction, ScenarioSpec } from './world';
import { tombstonedIds } from './memoryProjection';

export interface AuthoritativeScenario {
  /** The stored spec, intact: the durable evolution chain, never rewritten. */
  spec: ScenarioSpec;
  /** Current view: developments still in force. */
  developments: ScenarioDevelopment[];
  /** Current view: goal changes still in force. */
  goalChanges: ScenarioGoalChange[];
  /** Current view: retractions still in force. */
  retractions: ScenarioRetraction[];
  /** Derived current status ('concluded' only while a valid conclusion stands). */
  status: 'active' | 'concluded';
  /** Current private goals per participant id (temporary localId or existing participantId). */
  currentGoals: Record<string, string[]>;
}

export function authoritativeScenario(spec: ScenarioSpec, events: JournalEvent[]): AuthoritativeScenario {
  const tombstoned = tombstonedIds(events);
  const retractions = (spec.retractions ?? []).filter((retraction: ScenarioRetraction) =>
    !retraction.sourceEventIds.some((id) => tombstoned.has(id)));
  const retracted = new Set(retractions.map((retraction) => retraction.developmentId));
  const developments = (spec.developments ?? []).filter(
    (dev) => !retracted.has(dev.id) && !dev.sourceEventIds.some((id) => tombstoned.has(id))
  );
  const goalChanges = (spec.goalChanges ?? []).filter((change: ScenarioGoalChange) =>
    !change.sourceEventIds.some((id) => tombstoned.has(id)));

  // Replay surviving lifecycle entries, not the materialized status cache.
  // Retracting a reopening restores the preceding still-valid conclusion.
  const transition = developments.filter(dev => dev.kind === 'resolution' || dev.kind === 'reopen').at(-1);
  const status: 'active' | 'concluded' = transition?.kind === 'resolution' ? 'concluded' : 'active';

  const goals = new Map<string, string[]>();
  for (const item of spec.participants) {
    if (item.kind === 'temporary') goals.set(item.localId, [...item.profile.goals]);
    else goals.set(item.participantId, [...(item.goals ?? [])]);
  }
  for (const change of goalChanges) {
    const current = goals.get(change.participantId);
    if (!current) continue;
    goals.set(change.participantId, [
      ...current.filter((goal) => !change.remove.includes(goal)),
      ...change.add.filter((goal) => !current.includes(goal)),
    ]);
  }

  return {
    spec,
    developments,
    goalChanges,
    retractions,
    status,
    currentGoals: Object.fromEntries(goals),
  };
}
