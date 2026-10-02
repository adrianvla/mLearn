/** Shared ownership boundary for global study shortcuts. */

const studyOverlaySelector = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], dialog[open]';
const editableControlSelector = 'input, textarea, select, [role="textbox"], [contenteditable="true"]';

export function isRatingKeyIgnored(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.repeat) return true;
  if (typeof document !== 'undefined' && document.querySelector(studyOverlaySelector)) return true;
  const target = e.target;
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest(editableControlSelector) !== null;
}

export function isNativeActivationTarget(e: KeyboardEvent): boolean {
  const target = e.target;
  return target instanceof HTMLElement
    && target.closest('button, a[href], summary, [role="button"], [role="link"]') !== null;
}

export function isUndoShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
}

/**
 * The study surfaces share one keyboard policy; only their actions differ.
 *
 * Two rules were previously re-decided per surface and had drifted:
 *
 * 1. A durable write in flight must block *undo* (it would retract an attempt
 *    that is still being filed), but must not swallow unrelated shortcuts —
 *    burying or removing a card is still meaningful while a rating saves.
 * 2. Space/Enter reveals only from the `question` phase, and only when focus
 *    is not on a control that natively activates on those keys.
 */

/** True while the event should not reach any study shortcut. */
export function isStudyKeyIgnored(e: KeyboardEvent): boolean {
  return isRatingKeyIgnored(e);
}

/**
 * Whether a write-in-flight blocks this shortcut.
 *
 * Undo rewrites the journal the write is appending to, so it must wait. Every
 * other shortcut is unaffected by a pending write.
 */
export function isBlockedByPendingWrite(shortcut: 'undo' | 'other', writePending: boolean): boolean {
  return writePending && shortcut === 'undo';
}

/** Space/Enter, the shared reveal key. Not a native activation target. */
export function isRevealKey(e: KeyboardEvent): boolean {
  return (e.key === ' ' || e.key === 'Enter') && !isNativeActivationTarget(e);
}
