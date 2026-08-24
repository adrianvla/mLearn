/**
 * Shared rating-surface keyboard contract (flashcard review + Word Sync):
 * a rating press is ONE keydown — held-down OS auto-repeat never dispatches a
 * rating, and keystrokes while typing in an editable/control element never do
 * either. Both surfaces route their keydown guard through this so the
 * interaction stays identical and the repeat guard cannot drift again.
 */

export function isRatingKeyIgnored(e: KeyboardEvent): boolean {
  if (e.repeat) return true;
  const target = e.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.matches('input, textarea, select, button, [role="textbox"], [role="button"]');
}

export function isUndoShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';
}
