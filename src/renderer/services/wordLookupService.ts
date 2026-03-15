/**
 * Word Lookup Service
 * Opens a dedicated OS window showing word definitions, pills, and flashcard actions.
 */

import { getBridge } from '../../shared/bridges';
import { WINDOW_TYPES } from '../../shared/constants';

/**
 * Open a word definition window for a given word.
 * Can be called from anywhere in the renderer.
 */
export function openWordLookup(word: string): void {
  const trimmed = word.trim();
  if (!trimmed) return;
  getBridge().window.openWindow({
    type: WINDOW_TYPES.WORD_DEFINITION,
    options: { width: 480, height: 400 },
    context: { word: trimmed },
  });
}

let bridgeListenerInitialized = false;

/**
 * Initialize the bridge listener for mlearn://lookup deep links.
 * Safe to call multiple times; only the first call has effect.
 */
export function initWordLookupBridge(): () => void {
  if (bridgeListenerInitialized) return () => {};
  bridgeListenerInitialized = true;
  return getBridge().window.onLookupDeepLink((word) => {
    openWordLookup(word);
  });
}
