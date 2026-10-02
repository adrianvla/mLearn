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

// Activation order belongs to this renderer window. Non-dismissible surfaces
// still reserve Escape while busy, and cleanup restores the previous owner.
const escapeOwners: symbol[] = [];

export interface DismissOptions {
  /** Dismissal is only wired up while this is true. */
  active: Accessor<boolean>;
  /** Called when the user backs out (Escape, or a pointer press outside). */
  onDismiss: (reason: 'escape' | 'outside-pointer') => void;
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
  } = options;

  createEffect(() => {
    if (!active()) return;
    const owner = Symbol('dismiss');
    escapeOwners.push(owner);

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || escapeOwners.at(-1) !== owner) return;
      // Consume before onDismiss can unmount the panel or restore focus; that
      // same key must not reach the next surface or an underlying study action.
      event.preventDefault();
      event.stopPropagation();
      if (options.closeOnEscape ?? true) onDismiss('escape');
    };

    document.addEventListener('keydown', handleKeydown);
    onCleanup(() => {
      document.removeEventListener('keydown', handleKeydown);
      const index = escapeOwners.indexOf(owner);
      if (index !== -1) escapeOwners.splice(index, 1);
    });
  });

  // Pointer-policy changes must not reorder Escape ownership while open.
  createEffect(() => {
    if (!active() || !(options.closeOnOutsidePointer ?? false)) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const keepInside = (inside?.() ?? []).some((node) => node?.contains(target));
      if (keepInside) return;
      onDismiss('outside-pointer');
    };

    document.addEventListener('pointerdown', handlePointerDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown);
    });
  });
}
