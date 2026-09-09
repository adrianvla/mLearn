/**
 * Active-engagement timing for encounters.
 *
 * Wall-clock latency is not evidence of retrieval strength: a learner who tabs
 * away, minimizes the window, or leaves the machine mid-card must not produce
 * a four-minute "retrieval". This timer measures ACTIVE time — time while the
 * encounter surface was focused and document-visible — and records the
 * interruptions that paused it.
 *
 * Boundaries:
 * - window blur/focus (application switch, minimize on most platforms)
 * - document visibilitychange (tab switch, minimize where reported)
 *
 * Walking away while the window stays focused is not detectable without
 * aggressive idle heuristics, which would misread a thinking learner. The
 * only sanity mechanism is deliberately conservative: a focused-and-visible
 * stretch with NO input events for STALL_INTERRUPT_MS flags the attempt as
 * `interrupted` so consumers can discount its latency. The flagged time is
 * still counted — never silently subtracted.
 */

/** Provenance for one attempt's timing, written onto attempt evidence. */
export interface AttemptTiming {
  /** Time with the surface focused and document-visible. The latency learners actually spent retrieving. */
  activeLatencyMs: number;
  /** Raw presentation → outcome wall time. Kept for provenance; modeling consumes activeLatencyMs. */
  wallLatencyMs: number;
  /** Blur/visibility pauses plus flagged focus stalls during the attempt. */
  interruptionCount: number;
  /** True when any interruption (pause or conservative stall) occurred. */
  interrupted: boolean;
  /**
   * True when the conservative focus-stall sanity mechanism flagged the
   * attempt: a focused+visible stretch with no input exceeded
   * STALL_INTERRUPT_MS. Unlike a blur pause, the stalled time could NOT be
   * excluded, so such attempts carry no trustworthy latency.
   */
  stalled: boolean;
}

export interface EncounterTimer {
  /** Begins (or restarts) measurement. Safe to call once per encounter. */
  start(): void;
  /** Ends measurement and returns the attempt timing, or null when never started. Idempotent after stop. */
  stop(): AttemptTiming | null;
  /** Detaches listeners without producing a timing (encounter abandoned). */
  dispose(): void;
}

/** Minimal DOM surface the timer needs — structural, so no DOM lib is required to compile. */
export interface EncounterTimerEventTarget {
  addEventListener(type: string, listener: () => void, options?: { passive?: boolean }): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface EncounterTimerDocument extends EncounterTimerEventTarget {
  readonly hidden: boolean;
}

export interface EncounterTimerOptions {
  now?: () => number;
  win?: EncounterTimerEventTarget;
  doc?: EncounterTimerDocument;
  /** Focused+visible inactivity that flags the attempt interrupted. Conservative: thinking time stays under it. */
  stallInterruptMs?: number;
}

/** 10 minutes of zero input while focused and visible is not retrieval latency. */
export const STALL_INTERRUPT_MS = 10 * 60_000;

export function createEncounterTimer(options?: EncounterTimerOptions): EncounterTimer {
  const now = options?.now ?? Date.now;
  // Renderer surfaces run in a window; tests inject harnesses. globalThis
  // keeps this module compilable in DOM-lib-free tsconfig projects.
  const globalAsTarget = globalThis as unknown as EncounterTimerEventTarget & EncounterTimerDocument;
  const win = options?.win ?? globalAsTarget;
  const doc = options?.doc ?? globalAsTarget;
  const stallInterruptMs = options?.stallInterruptMs ?? STALL_INTERRUPT_MS;


  let startedAt = 0;
  let activeAccumMs = 0;
  let segmentStartedAt = 0;
  let running = false;
  let stopped = false;
  let started = false;
  let blurred = false;
  let lastEngagementAt = 0;
  let stallFlagged = false;
  let interruptionCount = 0;
  const activeWindow = (): boolean => !blurred && !doc.hidden;

  const pause = (): void => {
    if (!running) return;
    activeAccumMs += now() - segmentStartedAt;
    running = false;
  };

  const resume = (): void => {
    if (running || !started || stopped || !activeWindow()) return;
    segmentStartedAt = now();
    running = true;
  };

  // One pause/resume cycle that crosses into inactivity counts as ONE
  // interruption, even when blur and visibilitychange fire together.
  const onInactive = (): void => {
    const wasActive = running;
    pause();
    if (wasActive) interruptionCount += 1;
  };

  const onEngagement = (): void => {
    const t = now();
    if (started && !stopped && activeWindow() && lastEngagementAt !== 0 && t - lastEngagementAt >= stallInterruptMs) {
      // Conservative sanity flag only: the gap stays counted as active time.
      stallFlagged = true;
      interruptionCount += 1;
    }
    lastEngagementAt = t;
  };

  const onVisibilityChange = (): void => {
    if (doc.hidden) onInactive();
    else resume();
  };

  const onBlur = (): void => {
    blurred = true;
    onInactive();
  };

  const onFocus = (): void => {
    blurred = false;
    resume();
  };

  const attach = (): void => {
    win.addEventListener('blur', onBlur);
    win.addEventListener('focus', onFocus);
    win.addEventListener('pointermove', onEngagement, { passive: true });
    win.addEventListener('pointerdown', onEngagement, { passive: true });
    win.addEventListener('keydown', onEngagement, { passive: true });
    win.addEventListener('wheel', onEngagement, { passive: true });
    doc.addEventListener('visibilitychange', onVisibilityChange);
  };

  const detach = (): void => {
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('focus', onFocus);
    win.removeEventListener('pointermove', onEngagement);
    win.removeEventListener('pointerdown', onEngagement);
    win.removeEventListener('keydown', onEngagement);
    win.removeEventListener('wheel', onEngagement);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };

  return {
    start() {
      if (stopped) return;
      startedAt = now();
      segmentStartedAt = startedAt;
      lastEngagementAt = startedAt;
      started = true;
      running = activeWindow();
      blurred = false;
      interruptionCount = 0;
      stallFlagged = false;
      activeAccumMs = 0;
      attach();
    },
    stop() {
      if (!started || stopped) return null;
      if (running) {
        activeAccumMs += now() - segmentStartedAt;
        running = false;
      }
      let stalled = stallFlagged;
      // Trailing stall: the learner answered via an event that did not reach
      // our listeners (or never moved) after an unreasonable silent stretch.
      if (!stalled && activeWindow() && now() - lastEngagementAt >= stallInterruptMs) {
        interruptionCount += 1;
        stalled = true;
      }
      stopped = true;
      detach();
      return {
        activeLatencyMs: activeAccumMs,
        wallLatencyMs: now() - startedAt,
        interruptionCount,
        interrupted: interruptionCount > 0,
        stalled,
      };
    },
    dispose() {
      stopped = true;
      started = false;
      detach();
    },
  };
}

