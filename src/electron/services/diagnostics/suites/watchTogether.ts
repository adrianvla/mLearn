/**
 * Watch Together Diagnostics Suite
 */

import { PROXY_SERVER_PORT, DEFAULT_CLOUD_API_URL } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { loadSettings } from '../../settings';
import { httpPost, skipTest, isConnectionRefused } from '../utils';
import { wsConnect } from '../utils';

registerDiagnosticSuite({
  name: SUITE_NAMES.WATCH_TOGETHER,
  tests: [
    {
      name: 'watch-together-local-ws',
      timeoutMs: 10_000,
      async fn() {
        await wsConnect(`ws://127.0.0.1:${PROXY_SERVER_PORT}`);
      },
    },
    {
      name: 'watch-together-cloud-api',
      timeoutMs: 15_000,
      async fn() {
        const settings = loadSettings();
        const baseUrl = settings.cloudApiUrl || DEFAULT_CLOUD_API_URL;
        try {
          // Try creating a room without auth — we expect 401 (endpoint exists)
          const { status } = await httpPost(
            `${baseUrl}/api/watch-together/rooms`,
            { currentTime: 0, paused: true, playbackRate: 1 },
            15_000,
          );
          if (status !== 200 && status !== 401) {
            throw new Error(`Watch Together API returned status ${status}`);
          }
        } catch (err) {
          if (isConnectionRefused(err)) {
            skipTest('Cloud API unreachable');
          }
          throw err;
        }
      },
    },
    {
      name: 'watch-together-cloud-rooms-join',
      timeoutMs: 15_000,
      async fn() {
        const settings = loadSettings();
        const baseUrl = settings.cloudApiUrl || DEFAULT_CLOUD_API_URL;
        try {
          // Try joining a room without auth — we expect 401 (endpoint exists)
          const { status } = await httpPost(
            `${baseUrl}/api/watch-together/rooms/join`,
            { roomCode: 'TEST00' },
            15_000,
          );
          if (status !== 200 && status !== 401) {
            throw new Error(`Watch Together join returned status ${status}`);
          }
        } catch (err) {
          if (isConnectionRefused(err)) {
            skipTest('Cloud API unreachable');
          }
          throw err;
        }
      },
    },
  ],
});
