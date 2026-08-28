import { WINDOW_TYPES } from '../../shared/constants';
import { getBridge } from '../../shared/bridges';

/**
 * Open the Word Database editor, optionally focused on a surface via the
 * window context query. This is the full Tier-2 inspector entry point from
 * knowledge popups (Rate stays in place; deep inspection goes here).
 */
export function openWordDbEditor(query?: string): void {
  getBridge().window.openWindow({
    type: WINDOW_TYPES.WORD_DB_EDITOR,
    options: { width: 1080, height: 720 },
    ...(query && query.trim() ? { context: { query: query.trim() } } : {}),
  });
}
