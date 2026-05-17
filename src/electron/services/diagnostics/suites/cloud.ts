/**
 * Cloud Services Diagnostics Suite
 */

import { DEFAULT_CLOUD_LOGIN_URL, DEFAULT_CLOUD_API_URL, UPDATE_URL } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { loadSettings } from '../../settings';
import { httpGet, skipTest } from '../utils';

function isDnsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN') || msg.includes('getaddrinfo');
}

registerDiagnosticSuite({
  name: SUITE_NAMES.CLOUD,
  tests: [
    {
      name: 'login-endpoint-reachable',
      timeoutMs: 15_000,
      async fn() {
        const { status } = await httpGet(DEFAULT_CLOUD_LOGIN_URL, 15_000);
        if (status < 200 || status >= 500) {
          throw new Error(`Login endpoint returned status ${status}`);
        }
      },
    },
    {
      name: 'api-endpoint-reachable',
      timeoutMs: 15_000,
      async fn() {
        const { status } = await httpGet(`${DEFAULT_CLOUD_API_URL}/api/health`, 15_000);
        if (status !== 200) {
          throw new Error(`API endpoint returned status ${status}`);
        }
      },
    },
    {
      name: 'auth-token-valid',
      timeoutMs: 15_000,
      async fn() {
        const settings = loadSettings();
        if (!settings.cloudAuthAccessToken) {
          skipTest('No cloud auth token configured');
        }
        const { status } = await httpGet(`${DEFAULT_CLOUD_API_URL}/api/health`, 15_000);
        if (status !== 200) {
          throw new Error(`Authenticated API request returned status ${status}`);
        }
      },
    },
    {
      name: 'version-endpoint-reachable',
      timeoutMs: 15_000,
      async fn() {
        try {
          const { status, body } = await httpGet(UPDATE_URL, 15_000);
          if (status !== 200) {
            throw new Error(`Version endpoint returned status ${status}`);
          }
          try {
            JSON.parse(body);
          } catch {
            throw new Error('Version endpoint returned invalid JSON');
          }
        } catch (err) {
          if (isDnsError(err)) {
            skipTest('Version endpoint DNS not resolvable');
          }
          throw err;
        }
      },
    },
  ],
});
