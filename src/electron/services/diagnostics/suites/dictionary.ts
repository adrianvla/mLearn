/**
 * Dictionary Diagnostics Suite
 */

import { PYTHON_BACKEND_PORT } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { loadLangData } from '../../settings';
import { httpPost } from '../utils';

registerDiagnosticSuite({
  name: SUITE_NAMES.DICTIONARY,
  tests: [
    {
      name: 'lang-data-discovered',
      timeoutMs: 5_000,
      fn() {
        const data = loadLangData();
        const codes = Object.keys(data);
        if (codes.length === 0) {
          throw new Error('No language data discovered');
        }
        if (!codes.includes('ja')) {
          throw new Error('Japanese language data not found');
        }
      },
    },
    {
      name: 'lang-data-valid',
      timeoutMs: 5_000,
      fn() {
        const data = loadLangData();
        for (const [code, lang] of Object.entries(data)) {
          if (!lang.name) {
            throw new Error(`Language ${code} missing 'name'`);
          }
          if (!lang.name_translated) {
            throw new Error(`Language ${code} missing 'name_translated'`);
          }
        }
      },
    },
    {
      name: 'dictionary-lookup',
      timeoutMs: 10_000,
      async fn() {
        const { status, body } = await httpPost(
          `http://127.0.0.1:${PYTHON_BACKEND_PORT}/getCard`,
          { word: 'hello', language: 'en' },
        );
        if (status !== 200) {
          throw new Error(`Dictionary lookup returned status ${status}`);
        }
        const data = JSON.parse(body);
        // /getCard returns { cards: [...], error: boolean, poor: boolean }
        if (!data || !Array.isArray(data.cards)) {
          throw new Error('Dictionary lookup returned unexpected format');
        }
      },
    },
    {
      name: 'tokenization-works',
      timeoutMs: 10_000,
      async fn() {
        const { status, body } = await httpPost(
          `http://127.0.0.1:${PYTHON_BACKEND_PORT}/tokenize`,
          { text: '日本語', language: 'ja' },
        );
        if (status !== 200) {
          throw new Error(`Tokenization returned status ${status}`);
        }
        const data = JSON.parse(body);
        const tokens = data.tokens || data;
        if (!Array.isArray(tokens) || tokens.length === 0) {
          throw new Error('Tokenization returned no tokens');
        }
      },
    },
  ],
});
