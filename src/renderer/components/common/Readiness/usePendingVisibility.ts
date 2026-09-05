/**
 * Central anti-flicker policy for pending placeholders.
 *
 * This is the *only* sanctioned delay/min-display implementation. Components
 * must not sprinkle `setTimeout`s to suppress flicker — route fast
 * readiness through here so the policy stays uniform and tunable.
 *
 * Behavior:
 *   - A pending placeholder appears only once pending has lasted
 *     `delayMs`; brief readiness gaps never flash a skeleton.
 *   - Once shown, the placeholder stays at least `minDisplayMs`, so the
 *     reveal of real content is not a jarring blink.
 *   - Genuinely ready content is never delayed beyond an already-visible
 *     placeholder's minimum display window.
 */
import { createEffect, createSignal, onCleanup } from 'solid-js';

const DEFAULT_DELAY_MS = 150;
const DEFAULT_MIN_DISPLAY_MS = 400;

export interface PendingVisibilityOptions {
  /** How long pending must last before the placeholder appears. */
  delayMs?: number;
  /** How long the placeholder stays visible once shown. */
  minDisplayMs?: number;
}

/** Reactive visibility flag for a pending placeholder. */
export type PendingVisibility = () => boolean;

export function usePendingVisibility(
  pending: () => boolean,
  options: PendingVisibilityOptions = {},
): PendingVisibility {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const minDisplayMs = options.minDisplayMs ?? DEFAULT_MIN_DISPLAY_MS;
  const [visible, setVisible] = createSignal(false);
  let shownAt = 0;
  let timer: number | undefined;

  createEffect(() => {
    const isPending = pending();
    clearTimeout(timer);
    if (isPending) {
      timer = window.setTimeout(() => {
        shownAt = Date.now();
        setVisible(true);
      }, delayMs);
      return;
    }
    const remaining = shownAt === 0 ? 0 : minDisplayMs - (Date.now() - shownAt);
    if (remaining <= 0) {
      shownAt = 0;
      setVisible(false);
      return;
    }
    timer = window.setTimeout(() => {
      shownAt = 0;
      setVisible(false);
    }, remaining);
  });

  onCleanup(() => clearTimeout(timer));

  return visible;
}
