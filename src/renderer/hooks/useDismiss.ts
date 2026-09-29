/**
 * Dismiss Hook
 *
 * Canonical owner for "close this transient surface when the user backs out of
 * it". Several components independently re-registered an Escape listener (and,
 * for the floating ones, an outside-pointerdown listener), so the behavior of
 * pressing Escape was decided once per component and had drifted apart.
 *
 * A surface composes this hook and adds only what is genuinely its own —
 * Popover, for example, restores focus to its anchor; Tooltip dismisses only
 * while pinned. Neither re-implements the dismissal test itself.
 */
import { createEffect, onCleanup, type Accessor } from 'solid-js';

export interface DismissOptions {
  /** Dismissal is only wired up while this is true. */
  active: Accessor<boolean>;
  /** Called when the user backs out (Escape, or a pointer press outside). */
  onDismiss: () => void;
  /**
   * Elements that count as "inside" the surface. A pointer press within any of
   * them does not dismiss. Ignored when `closeOnOutsidePointer` is false.
   */
  inside?: Accessor<readonly (Node | null | undefined)[]>;
  /** Escape dismisses. Defaults to true. */
  closeOnEscape?: boolean;
  /** A pointer press outside `inside` dismisses. Defaults to false. */
  closeOnOutsidePointer?: boolean;
}

/**
 * Wires Escape and (optionally) outside-pointer dismissal for as long as
 * `active()` is true. Listeners are attached to `document` and removed on
 * cleanup, matching the per-component behavior this replaces.
 */
export function useDismiss(options: DismissOptions): void {
  const {
    active,
    onDismiss,
    inside,
    closeOnEscape = true,
    closeOnOutsidePointer = false,
  } = options;

  createEffect(() => {
    if (!active()) return;

    const handleKeydown = (event: KeyboardEvent) => {
      if (closeOnEscape && event.key === 'Escape') onDismiss();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!closeOnOutsidePointer) return;
      const target = event.target as Node | null;
      if (!target) return;
      const keepInside = (inside?.() ?? []).some((node) => node?.contains(target));
      if (keepInside) return;
      onDismiss();
    };

    document.addEventListener('keydown', handleKeydown);
    if (closeOnOutsidePointer) document.addEventListener('pointerdown', handlePointerDown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeydown);
      document.removeEventListener('pointerdown', handlePointerDown);
    });
  });
}
