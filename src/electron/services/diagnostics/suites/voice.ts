/**
 * Voice / TTS / STT Diagnostics Suite
 */

import http from 'http';
import https from 'https';
import { PYTHON_BACKEND_PORT, DEFAULT_CLOUD_API_URL } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import { loadSettings } from '../../settings';
import { httpGet, wsConnect, skipTest } from '../utils';

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
    {
      name: 'tts-local-generate',
      timeoutMs: 60_000,
      async fn() {
        const { status: statusStatus, body: statusBody } = await httpGet(
          `http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/status`,
          10_000,
        );
        if (statusStatus !== 200) {
          throw new Error(`TTS status check failed with status ${statusStatus}`);
        }
        const statusData = JSON.parse(statusBody);
        if (!statusData.downloaded) {
          skipTest('TTS model not downloaded');
        }
        if (!statusData.loaded) {
          skipTest('TTS model still loading');
        }

        const payload = JSON.stringify({ text: 'Hello', language: 'en', provider: 'kokoro' });
        const url = new URL(`http://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts`);
        const res = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
          const req = http.request(
            {
              hostname: url.hostname,
              port: url.port,
              path: url.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              },
              timeout: 60_000,
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on('data', (chunk: Buffer) => chunks.push(chunk));
              response.on('end', () => {
                resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) });
              });
              response.on('error', reject);
            },
          );
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Local TTS generation timed out'));
          });
          req.write(payload);
          req.end();
        });

        if (res.status !== 200) {
          throw new Error(`Local TTS generation returned status ${res.status}: ${res.body.toString().slice(0, 200)}`);
        }
        if (res.body.length < 100) {
          throw new Error(`Local TTS generation returned empty or truncated audio (${res.body.length} bytes)`);
        }
      },
    },
    {
      name: 'tts-cloud-stream',
      timeoutMs: 30_000,
      async fn() {
        const settings = loadSettings();
        const authToken = settings.cloudAuthAccessToken || settings.cloudAuthToken;
        if (!authToken) {
          skipTest('No cloud auth token configured');
        }
        const baseUrl = (settings.overrideCloudEndpointUrl && settings.cloudApiUrl
          ? settings.cloudApiUrl
          : DEFAULT_CLOUD_API_URL).replace(/\/+$/, '');

        const payload = JSON.stringify({ text: 'Hello', language: 'en', provider: 'moss-realtime' });
        const url = new URL(`${baseUrl}/api/tts/stream`);
        const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const proto = url.protocol === 'https:' ? https : http;
          const req = proto.request(
            {
              hostname: url.hostname,
              port: url.port,
              path: url.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization': `Bearer ${authToken}`,
              },
              timeout: 30_000,
            },
            (response) => {
              let responseBody = '';
              response.on('data', (chunk: Buffer) => { responseBody += chunk; });
              response.on('end', () => {
                resolve({ status: response.statusCode ?? 0, body: responseBody });
              });
              response.on('error', reject);
            },
          );
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Cloud TTS stream setup timed out'));
          });
          req.write(payload);
          req.end();
        });

        if (res.status !== 200) {
          throw new Error(`Cloud TTS stream setup returned status ${res.status}: ${res.body.slice(0, 200)}`);
        }
        const data = JSON.parse(res.body);
        const streamUrl = data.actions?.stream_url;
        if (!streamUrl) {
          throw new Error('Cloud TTS stream setup returned no stream_url');
        }

        const streamRes = await new Promise<{ status: number; bytes: number }>((resolve, reject) => {
          const streamUrlObj = new URL(streamUrl);
          const proto = streamUrlObj.protocol === 'https:' ? https : http;
          const req = proto.request(
            {
              hostname: streamUrlObj.hostname,
              port: streamUrlObj.port,
              path: streamUrlObj.pathname + streamUrlObj.search,
              method: 'GET',
              timeout: 10_000,
            },
            (response) => {
              let byteCount = 0;
              response.on('data', (chunk: Buffer) => {
                byteCount += chunk.length;
                if (byteCount >= 1024) {
                  req.destroy();
                  resolve({ status: response.statusCode ?? 0, bytes: byteCount });
                }
              });
              response.on('end', () => {
                resolve({ status: response.statusCode ?? 0, bytes: byteCount });
              });
              response.on('error', reject);
            },
          );
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Cloud TTS stream data fetch timed out'));
          });
          req.end();
        });

        if (streamRes.status !== 200) {
          throw new Error(`Cloud TTS stream returned status ${streamRes.status}`);
        }
        if (streamRes.bytes < 100) {
          throw new Error(`Cloud TTS stream returned only ${streamRes.bytes} bytes`);
        }
      },
    },
    {
      name: 'tts-cloud-batch',
      timeoutMs: 60_000,
      async fn() {
        const settings = loadSettings();
        const authToken = settings.cloudAuthAccessToken || settings.cloudAuthToken;
        if (!authToken) {
          skipTest('No cloud auth token configured');
        }
        const baseUrl = (settings.overrideCloudEndpointUrl && settings.cloudApiUrl
          ? settings.cloudApiUrl
          : DEFAULT_CLOUD_API_URL).replace(/\/+$/, '');

        const payload = JSON.stringify({ text: 'Hello', language: 'en', provider: 'qwen3' });
        const url = new URL(`${baseUrl}/api/tts/jobs`);
        const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const proto = url.protocol === 'https:' ? https : http;
          const req = proto.request(
            {
              hostname: url.hostname,
              port: url.port,
              path: url.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'Authorization': `Bearer ${authToken}`,
              },
              timeout: 60_000,
            },
            (response) => {
              let responseBody = '';
              response.on('data', (chunk: Buffer) => { responseBody += chunk; });
              response.on('end', () => {
                resolve({ status: response.statusCode ?? 0, body: responseBody });
              });
              response.on('error', reject);
            },
          );
          req.on('error', reject);
          req.on('timeout', () => {
            req.destroy();
            reject(new Error('Cloud TTS batch job creation timed out'));
          });
          req.write(payload);
          req.end();
        });

        if (res.status !== 200) {
          throw new Error(`Cloud TTS batch job creation returned status ${res.status}: ${res.body.slice(0, 200)}`);
        }
        const data = JSON.parse(res.body);
        const jobId = data.jobId;
        if (!jobId) {
          throw new Error('Cloud TTS batch job creation returned no jobId');
        }
      },
    },
  ],
});
