/**
 * Voice / TTS / STT Diagnostics Suite
 */

import { PYTHON_BACKEND_PORT } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { httpGet, wsConnect } from '../utils';

registerDiagnosticSuite({
  name: SUITE_NAMES.VOICE,
  tests: [
    {
      name: 'tts-status',
      timeoutMs: 10_000,
      async fn() {
        const { status, body } = await httpGet(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/status`, 10_000);
        if (status !== 200) {
          throw new Error(`TTS status returned status ${status}`);
        }
        const data = JSON.parse(body);
        // TTS status returns { downloaded, loaded, downloading, progress, modelName }
        if (typeof data.loaded !== 'boolean' && typeof data.downloaded !== 'boolean') {
          throw new Error('TTS status returned unexpected format');
        }
      },
    },
    {
      name: 'stt-status',
      timeoutMs: 10_000,
      async fn() {
        const { status, body } = await httpGet(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stt/status`, 10_000);
        if (status !== 200) {
          throw new Error(`STT status returned status ${status}`);
        }
        const data = JSON.parse(body);
        // STT status returns { downloaded, loaded, downloading, progress, modelName }
        if (typeof data.loaded !== 'boolean' && typeof data.downloaded !== 'boolean') {
          throw new Error('STT status returned unexpected format');
        }
      },
    },
    {
      name: 'voice-stream-connect',
      timeoutMs: 10_000,
      async fn() {
        try {
          await wsConnect(`ws://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stream`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 403 means the endpoint exists but requires auth token — server is functional
          if (msg.includes('403')) {
            return;
          }
          throw err;
        }
      },
    },
  ],
});
