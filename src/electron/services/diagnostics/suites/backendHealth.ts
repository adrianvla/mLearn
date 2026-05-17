/**
 * Backend Health Diagnostics Suite
 */

import { PYTHON_BACKEND_PORT, PROXY_SERVER_PORT } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { httpGet, wsConnect } from '../utils';

registerDiagnosticSuite({
  name: SUITE_NAMES.BACKEND_HEALTH,
  tests: [
    {
      name: 'python-backend-ping',
      timeoutMs: 10_000,
      async fn() {
        const { status, body } = await httpGet(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/health`);
        if (status !== 200) {
          throw new Error(`Python backend returned status ${status}`);
        }
        const data = JSON.parse(body);
        if (!data || typeof data !== 'object') {
          throw new Error('Python backend returned invalid JSON');
        }
      },
    },
    {
      name: 'python-backend-tokenize',
      timeoutMs: 10_000,
      async fn() {
        const { status } = await httpGet(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/tokenize`, 10_000);
        // tokenize requires POST, so we expect a method-not-allowed or similar,
        // but the endpoint exists if we get a structured response.
        if (status === 404) {
          throw new Error('Python backend /tokenize endpoint not found');
        }
      },
    },
    {
      name: 'web-server-ping',
      timeoutMs: 10_000,
      async fn() {
        const { status } = await httpGet(`http://127.0.0.1:${PROXY_SERVER_PORT}/`, 10_000);
        if (status !== 200) {
          throw new Error(`Web server returned status ${status}`);
        }
      },
    },
    {
      name: 'web-server-ws',
      timeoutMs: 10_000,
      async fn() {
        await wsConnect(`ws://127.0.0.1:${PROXY_SERVER_PORT}`);
      },
    },
  ],
});
