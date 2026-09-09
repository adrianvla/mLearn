/**
 * Bounded renderer-side call-frequency instrumentation.
 *
 * Compiled in always, active only when VITE_MLEARN_PERF is truthy at build/
 * dev time AND window exists. Exposes `window.__mlearnPerf` for a CDP
 * harness: { counters, elapsedMs, snapshot(), reset() }. Counters are plain
 * increments (no timestamps), so the steady-state cost when disabled is one
 * falsy branch per call site; the module must stay allocation-free when
 * disabled.
 */

interface PerfState {
  counters: Record<string, number>;
  startedAt: number;
}

const state: PerfState = {
  counters: {},
  startedAt: typeof window !== 'undefined' ? window.performance.now() : 0,
};

export function perfCount(name: string, amount = 1): void {
  if (!enabled) return;
  state.counters[name] = (state.counters[name] ?? 0) + amount;
}
const enabled = typeof window !== 'undefined' && Boolean(import.meta.env.VITE_MLEARN_PERF);
export function perfTime<T>(name: string, fn: () => T): T {
  if (!enabled) return fn();
  const start = window.performance.now();
  try {
    return fn();
  } finally {
    const ms = window.performance.now() - start;
    state.counters[name] = (state.counters[name] ?? 0) + 1;
    state.counters[`${name}.ms`] = (state.counters[`${name}.ms`] ?? 0) + ms;
  }
}

export function perfSnapshot(): PerfState & { elapsedMs: number } {
  return {
    counters: { ...state.counters },
    startedAt: state.startedAt,
    elapsedMs: typeof window !== 'undefined' ? window.performance.now() - state.startedAt : 0,
  };
}

export function perfReset(): void {
  state.counters = {};
  state.startedAt = typeof window !== 'undefined' ? window.performance.now() : 0;
}

export function installPerfObserverCounters(): void {
  if (!enabled || typeof window === 'undefined') return;
  const w = window as unknown as {
    __mlearnPerf?: { snapshot: typeof perfSnapshot; reset: typeof perfReset };
    IntersectionObserver: typeof IntersectionObserver;
    ResizeObserver: typeof ResizeObserver;
    MutationObserver: typeof MutationObserver;
  };
  w.__mlearnPerf = { snapshot: perfSnapshot, reset: perfReset };

  class CountedIntersectionObserver extends w.IntersectionObserver {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      perfCount('observer.IntersectionObserver.created');
      perfCount('observer.IntersectionObserver.alive');
      const wrapped: IntersectionObserverCallback = (entries, obs) => {
        perfCount('observer.IntersectionObserver.callback');
        perfCount('observer.IntersectionObserver.entries', entries.length);
        callback(entries, obs);
      };
      super(wrapped, options);
    }
  }
  class CountedResizeObserver extends w.ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      perfCount('observer.ResizeObserver.created');
      perfCount('observer.ResizeObserver.alive');
      const wrapped: ResizeObserverCallback = (entries, obs) => {
        perfCount('observer.ResizeObserver.callback');
        callback(entries, obs);
      };
      super(wrapped);
    }
  }
  class CountedMutationObserver extends w.MutationObserver {
    constructor(callback: MutationCallback) {
      perfCount('observer.MutationObserver.created');
      const wrapped: MutationCallback = (mutations, obs) => {
        perfCount('observer.MutationObserver.callback');
        callback(mutations, obs);
      };
      super(wrapped);
    }
  }
  window.IntersectionObserver = CountedIntersectionObserver;
  window.ResizeObserver = CountedResizeObserver;
  window.MutationObserver = CountedMutationObserver;
}
