/**
 * ReadinessGate — the standard consumer of the Readiness contract.
 *
 * Maps one `Readiness` to UI:
 *   - `ready` / `refreshing` render `children`. A background refresh keeps
 *     the previously valid content on screen instead of swapping in a
 *     placeholder — readiness ≠ blankness.
 *   - `pending` renders `fallback`, held through the central anti-flicker
 *     policy (usePendingVisibility) so sub-150 ms loads never flash a
 *     skeleton and an already-shown skeleton never vanishes in a blink.
 *     Pass `instant` to skip the hold for gates that are slow by design.
 *   - `unavailable` / `failed` render their explicit slots. A gate renders
 *     nothing for a terminal state with no slot — it must never keep a
 *     pending placeholder up forever. Surfaces that cannot explain absence
 *     should not gate at all; let a parent boundary own it.
 */
import { Component, JSX, Match, Show, Switch } from 'solid-js';
import { isSettledReadiness, toReadinessAccessor } from './readiness';
import type { Readiness, ReadinessAccessor } from './readiness';
import { usePendingVisibility } from './usePendingVisibility';

export interface ReadinessGateProps {
  /** Current readiness — literal value or accessor. */
  when: Readiness | ReadinessAccessor;
  children: JSX.Element;
  /** Placeholder for `pending`. */
  fallback?: JSX.Element;
  /** Explanation for `unavailable` (dependency genuinely absent). */
  unavailable?: JSX.Element;
  /** Error/retry affordance for `failed`. */
  failed?: JSX.Element;
  /** Skip the anti-flicker hold; show `fallback` for the whole pending window. */
  instant?: boolean;
}

export const ReadinessGate: Component<ReadinessGateProps> = (props) => {
  const readiness = (): Readiness => toReadinessAccessor(props.when)();
  const showPending = () => readiness() === 'pending';
  const held = usePendingVisibility(showPending);
  // While pending: show the fallback only once the anti-flicker delay has
  // elapsed (held() gates it). After a flip to ready/refreshing: keep an
  // already-visible placeholder up for its minimum display window, then
  // reveal children. Terminal states (unavailable/failed) surface their
  // slot immediately — they never wait out a placeholder's drain.
  const showFallback = () => {
    if (props.instant) return showPending();
    if (!showPending() && !isSettledReadiness(readiness())) return false;
    return held();
  };
  return (
    <Show when={!showFallback()} fallback={props.fallback}>
      <Switch>
        <Match when={isSettledReadiness(readiness())}>{props.children}</Match>
        <Match when={readiness() === 'unavailable'}>{props.unavailable}</Match>
        <Match when={readiness() === 'failed'}>{props.failed}</Match>
      </Switch>
    </Show>
  );
};
