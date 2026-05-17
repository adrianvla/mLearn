/**
 * Anki Diagnostics Suite
 */

import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { httpPost, skipTest, isConnectionRefused } from '../utils';

function ankiRequest(action: string, params?: object): Promise<{ status: number; body: string }> {
  return httpPost('http://localhost:8765', { action, version: 6, ...(params ? { params } : {}) }, 8_000);
}



registerDiagnosticSuite({
  name: SUITE_NAMES.ANKI,
  tests: [
    {
      name: 'anki-connect-reachable',
      timeoutMs: 8_000,
      async fn() {
        try {
          const { status, body } = await ankiRequest('version');
          if (status !== 200) {
            throw new Error(`AnkiConnect returned status ${status}`);
          }
          const data = JSON.parse(body);
          if (data.error) {
            throw new Error(`AnkiConnect error: ${data.error}`);
          }
          if (typeof data.result !== 'number') {
            throw new Error('AnkiConnect returned unexpected format');
          }
        } catch (err) {
          if (isConnectionRefused(err)) {
            skipTest('Anki is not running');
          }
          throw err;
        }
      },
    },
    {
      name: 'anki-deck-list',
      timeoutMs: 8_000,
      async fn() {
        try {
          const { status, body } = await ankiRequest('deckNames');
          if (status !== 200) {
            throw new Error(`AnkiConnect returned status ${status}`);
          }
          const data = JSON.parse(body);
          if (data.error) {
            throw new Error(`AnkiConnect error: ${data.error}`);
          }
          if (!Array.isArray(data.result)) {
            throw new Error('AnkiConnect deckNames returned unexpected format');
          }
        } catch (err) {
          if (isConnectionRefused(err)) {
            skipTest('Anki is not running');
          }
          throw err;
        }
      },
    },
    {
      name: 'anki-model-list',
      timeoutMs: 8_000,
      async fn() {
        try {
          const { status, body } = await ankiRequest('modelNames');
          if (status !== 200) {
            throw new Error(`AnkiConnect returned status ${status}`);
          }
          const data = JSON.parse(body);
          if (data.error) {
            throw new Error(`AnkiConnect error: ${data.error}`);
          }
          if (!Array.isArray(data.result)) {
            throw new Error('AnkiConnect modelNames returned unexpected format');
          }
        } catch (err) {
          if (isConnectionRefused(err)) {
            skipTest('Anki is not running');
          }
          throw err;
        }
      },
    },
  ],
});
