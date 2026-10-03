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

/**
 * Reports long tasks that overlap a rating transition.
 *
 * The per-step stamps say WHICH step ran long; this says whether that step
 * actually blocked the main thread as one continuous task, or whether it was
 * many short tasks that merely summed to a large number. That is the
 * difference between "one expensive synchronous owner" and "the transition is
 * yielding to unrelated queued work", which need different fixes.
 */
export function watchLongTasks(): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask') !== true) return () => {};
  let observing = true;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration < 50) continue;
      // eslint-disable-next-line no-console
      console.log(`%c[LONG-TASK] ${(entry.duration).toFixed(1)}ms start=${entry.startTime.toFixed(1)}`,
        'color:#d33; font-weight:bold');
    }
  });
  observer.observe({ entryTypes: ['longtask'] });
  return () => {
    if (!observing) return;
    observing = false;
    observer.disconnect();
  };
}
