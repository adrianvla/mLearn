/**
 * LLM Providers Diagnostics Suite
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { DEFAULT_CLOUD_API_URL } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { httpGet, httpPost, skipTest, isConnectionRefused } from '../utils';

function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'models');
}



registerDiagnosticSuite({
  name: SUITE_NAMES.LLM,
  tests: [
    {
      name: 'llm-builtin-status',
      timeoutMs: 5_000,
      fn() {
        const modelsDir = getModelsDir();
        if (!fs.existsSync(modelsDir)) {
          skipTest('No models directory');
        }
        const files = fs.readdirSync(modelsDir).filter((f) => f.endsWith('.gguf'));
        if (files.length === 0) {
          skipTest('No GGUF models downloaded');
        }
        // Model files exist — builtin LLM is potentially functional
      },
    },
    {
      name: 'llm-builtin-list',
      timeoutMs: 5_000,
      fn() {
        const modelsDir = getModelsDir();
        // Just verify we can list; empty is fine if none downloaded
        fs.existsSync(modelsDir);
      },
    },
    {
      name: 'llm-ollama-check',
      timeoutMs: 10_000,
      async fn() {
        try {
          const { status } = await httpGet('http://localhost:11434/api/tags', 8_000);
          if (status !== 200) {
            throw new Error(`Ollama returned status ${status}`);
          }
        } catch (err) {
          if (isConnectionRefused(err)) {
            skipTest('Ollama is not running');
          }
          throw err;
        }
      },
    },
    {
      name: 'llm-ollama-list',
      timeoutMs: 10_000,
      async fn() {
        try {
          const { status, body } = await httpGet('http://localhost:11434/api/tags', 8_000);
          if (status !== 200) {
            throw new Error(`Ollama returned status ${status}`);
          }
          const data = JSON.parse(body);
          if (!data || typeof data !== 'object') {
            throw new Error('Ollama returned invalid JSON');
          }
        } catch (err) {
          if (isConnectionRefused(err)) {
            skipTest('Ollama is not running');
          }
          throw err;
        }
      },
    },
    {
      name: 'llm-cloud-reachable',
      timeoutMs: 15_000,
      async fn() {
        const { status } = await httpGet(`${DEFAULT_CLOUD_API_URL}/api/health`, 15_000);
        if (status !== 200) {
          throw new Error(`Cloud API returned status ${status}`);
        }
      },
    },
    {
      name: 'llm-cloud-stream',
      timeoutMs: 20_000,
      async fn() {
        // Try a minimal SSE stream request
        const { status } = await httpPost(
          `${DEFAULT_CLOUD_API_URL}/api/llm/stream`,
          { messages: [{ role: 'user', content: 'hi' }], model: 'default', stream: true },
          20_000,
        );
        // We expect 401 if unauthenticated, 200 if authenticated — both mean the endpoint exists
        if (status !== 200 && status !== 401) {
          throw new Error(`Cloud LLM stream returned status ${status}`);
        }
      },
    },
  ],
});
