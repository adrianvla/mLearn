/** Shared ownership boundary for global study shortcuts. */

const studyOverlaySelector = '[role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], dialog[open]';
const editableControlSelector = 'input, textarea, select, [role="textbox"], [contenteditable="true"]';

export function isRatingKeyIgnored(e: KeyboardEvent): boolean {
  if (e.repeat) return true;
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
