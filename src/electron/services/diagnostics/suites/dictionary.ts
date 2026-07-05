/**
 * Dictionary Diagnostics Suite
 */

import { PROXY_SERVER_PORT, PYTHON_BACKEND_PORT } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import type { LanguageData } from '../../../../shared/types';
import { loadLangData, loadSettings } from '../../settings';
import { httpPost, skipTest } from '../utils';

function getDiagnosticSampleText(code: string, language: LanguageData): string {
  const sampleText = language.runtime?.diagnostics?.sampleText?.trim();
  if (sampleText) return sampleText;
  return language.name || code;
}

function getDictionaryDiagnosticContext(): { language: string; languageData: LanguageData } {
  const settings = loadSettings();
  const language = settings.language?.trim();
  if (!language) {
    skipTest('No learning language configured');
  }

  const languageData = loadLangData()[language];
  if (!languageData) {
    throw new Error(`Selected language ${language} is not installed`);
  }

  return { language, languageData };
}

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
        }
      },
    },
    {
      name: 'dictionary-lookup',
      timeoutMs: 10_000,
      async fn() {
        const { language, languageData } = getDictionaryDiagnosticContext();
        const { status, body } = await httpPost(
          `http://127.0.0.1:${PROXY_SERVER_PORT}/api/anki/card`,
          { word: getDiagnosticSampleText(language, languageData), language },
        );
        if (status !== 200) {
          throw new Error(`Dictionary lookup returned status ${status}`);
        }
        const response = JSON.parse(body);
        // /api/anki/card returns { cards: [...], error: boolean, poor: boolean }
        if (!response || !Array.isArray(response.cards)) {
          throw new Error('Dictionary lookup returned unexpected format');
        }
      },
    },
    {
      name: 'tokenization-works',
      timeoutMs: 10_000,
      async fn() {
        const { language, languageData } = getDictionaryDiagnosticContext();
        const { status, body } = await httpPost(
          `http://127.0.0.1:${PYTHON_BACKEND_PORT}/tokenize`,
          { text: getDiagnosticSampleText(language, languageData), language },
        );
        if (status !== 200) {
          throw new Error(`Tokenization returned status ${status}`);
        }
        const response = JSON.parse(body);
        const tokens = response.tokens || response;
        if (!Array.isArray(tokens) || tokens.length === 0) {
          throw new Error('Tokenization returned no tokens');
        }
      },
    },
  ],
});
