/**
 * Windows Diagnostics Suite
 */

import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { createChildWindow } from '../../windowManager';
import type { WindowType } from '../../../../shared/constants';


const WINDOW_TYPES_TO_TEST: WindowType[] = [
  'settings',
  'flashcards',
  'statistics',
  'word-db-editor',
  'kanji-grid',
  'licenses',
  'conversation-agent',
  'word-definition',
  'word-sync',
];

function testWindow(type: WindowType, timeoutMs: number) {
  return {
    name: `window-${type}`,
    timeoutMs,
    async fn() {
      const win = createChildWindow(type, { show: false });
      if (!win) {
        throw new Error(`Failed to create ${type} window`);
      }

      // Wait for DOM ready
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!win.isDestroyed()) {
            win.close();
          }
          reject(new Error(`Window ${type} did not load in time`));
        }, timeoutMs);

        if (win.webContents.isLoading()) {
          win.webContents.once('did-finish-load', () => {
            clearTimeout(timer);
            resolve();
          });
        } else {
          clearTimeout(timer);
          resolve();
        }
      });

      // Give it a moment to initialize scripts
      await new Promise((r) => setTimeout(r, 500));

      if (!win.isDestroyed()) {
        win.close();
      }
    },
  };
}

registerDiagnosticSuite({
  name: SUITE_NAMES.WINDOWS,
  tests: WINDOW_TYPES_TO_TEST.map((type) => testWindow(type, 10_000)),
});
