/**
 * Opt-in latency tracer for the flashcard rating transition.
 *
 * The learner-facing rating path is an interaction-critical surface: the
 * interval between one card and the next must not grow when the durable write
 * behind it gets slower on a larger library. These switches exist so that a
 * regression is observable in the real app rather than only in a benchmark.
 *
 * Enable from the DevTools console with `window.__mlearnTrace = true`, or set
 * `localStorage.mlearn.ratingTrace = '1'`; disable by setting either back.
 */
const TRACE_FLAG = '__mlearnTrace';

/** Whether the opt-in latency tracer is on. Never throws. */
export function ratingLatencyTraceOn(): boolean {
  try {
    if ((globalThis as unknown as Record<string, unknown>)[TRACE_FLAG] === true) return true;
    if (!globalThis.localStorage) return false;
    // A storage identifier, not a locale key.
    return localStorage.getItem('mlearn.ratingTrace') === '1';
  } catch {
    // A window with no accessible global or storage simply is not tracing.
    return false;
  }
}
