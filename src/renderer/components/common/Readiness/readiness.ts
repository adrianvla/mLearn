/**
 * Readiness contract — the shared vocabulary for "is this data usable yet".
 *
 * Loading is a first-class application state, not an accidental transient.
 * Producers (contexts, hooks, local effects) keep owning their own async
 * signals; this module only standardizes how that state is *expressed* and
 * consumed, so surfaces never have to infer readiness from data shape
 * (`length === 0`, missing fields, default values) and can keep the
 * distinctions that matter:
 *
 *   empty ≠ unknown ≠ pending ≠ unavailable ≠ failed
 *
 *   - `pending`      initial load / hydration / reconstruction in flight;
 *                    previous content is absent, placeholders are honest.
 *   - `ready`        authoritative content is present.
 *   - `refreshing`   revalidating in the background while the previously
 *                    rendered content stays valid and visible.
 *   - `unavailable`  a dependency is genuinely absent (feature not installed
 *                    for this language, empty catalog) — a real state, not a
 *                    loading state; must render its own explanation.
 *   - `failed`       the load errored; must render an error/retry affordance.
 *
 * A `pending` state must always be transient by construction: producers
 * resolve to one of the four terminal states (ready/refreshing/unavailable/
 * failed) on success, absence, and error alike. Gates must never leave a
 * skeleton up for a terminal state.
 */

/** Lifecycle of an async dependency, expressed for UI consumption. */
export type Readiness = 'pending' | 'ready' | 'refreshing' | 'unavailable' | 'failed';

/** Reactive handle producing the current readiness of one dependency. */
export type ReadinessAccessor = () => Readiness;

/** True when previously rendered content is valid and may stay visible. */
export function isSettledReadiness(readiness: Readiness): boolean {
  return readiness === 'ready' || readiness === 'refreshing';
}

export interface ReadinessFlags {
  /** Initial load / hydration still in flight. */
  pending?: () => boolean | undefined;
  /** Dependency genuinely absent (not installed / not published). */
  unavailable?: () => boolean | undefined;
  /** Load failed. */
  failed?: () => boolean | undefined;
}

/**
 * Adapt existing boolean readiness signals (the common shape across
 * contexts: `isLoading`, `metaLoading`, …) to the shared contract without
 * forcing producers to restructure. Failure wins over absence wins over
 * pending, so a broken dependency is never masked by its placeholder.
 */
export function deriveReadiness(flags: ReadinessFlags): ReadinessAccessor {
  return () => {
    if (flags.failed?.()) return 'failed';
    if (flags.unavailable?.()) return 'unavailable';
    if (flags.pending?.()) return 'pending';
    return 'ready';
  };
}

/** Normalize a literal readiness or an accessor into an accessor. */
export function toReadinessAccessor(value: Readiness | ReadinessAccessor): ReadinessAccessor {
  return typeof value === 'function' ? value : () => value;
}
