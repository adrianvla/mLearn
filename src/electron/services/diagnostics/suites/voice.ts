/**
 * Voice / TTS / STT Diagnostics Suite
 */

import http from 'http';
import WebSocket from 'ws';
import { PYTHON_BACKEND_PORT } from '../../../../shared/constants';
import { SUITE_NAMES } from '../../../../shared/diagnostics/constants';
import { registerDiagnosticSuite } from '../../../../shared/diagnostics/registry';
import type { LanguageData, Settings } from '../../../../shared/types';
import { loadLangData, loadSettings } from '../../settings';
import { httpGet, wsConnect, skipTest } from '../utils';
import { backendSttStatusUrl, backendTtsStatusUrl } from '../voiceDiagnosticUrls';

function getVoiceDiagnosticContext(): {
  settings: Settings;
  language: string;
  languageData: LanguageData | undefined;
} {
  const settings = loadSettings();
  const language = settings.language?.trim();
  if (!language) {
    skipTest('No learning language configured');
  }
  return {
    settings,
    language,
    languageData: loadLangData()[language],
  };
}

function getDiagnosticText(language: string, languageData?: LanguageData): string {
  const configured = languageData?.runtime?.tts?.diagnosticText;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  return languageData?.name_translated || languageData?.name || language;
}

registerDiagnosticSuite({
  name: SUITE_NAMES.VOICE,
  tests: [
    {
      name: 'tts-status',
      timeoutMs: 10_000,
      async fn() {
        const { language } = getVoiceDiagnosticContext();
        const { status, body } = await httpGet(backendTtsStatusUrl(language), 10_000);
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
        const { language } = getVoiceDiagnosticContext();
        const { status, body } = await httpGet(backendSttStatusUrl(language), 10_000);
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
        const { language } = getVoiceDiagnosticContext();
        const url = new URL(`ws://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/stream`);
        url.searchParams.set('language', language);
        try {
          await wsConnect(url.toString());
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
        const { settings, language, languageData } = getVoiceDiagnosticContext();
        const provider = settings.ttsProvider;
        if (provider === 'cloud') {
          skipTest('Local TTS provider is not selected');
        }
        const { status: statusStatus, body: statusBody } = await httpGet(
          backendTtsStatusUrl(language),
          10_000,
        );
        if (statusStatus !== 200) {
          throw new Error(`TTS status check failed with status ${statusStatus}`);
        }
        const statusData = JSON.parse(statusBody);
        if (statusData.error) {
          skipTest(`TTS unavailable for ${language}: ${statusData.error}`);
        }
        if (!statusData.downloaded) {
          skipTest('TTS model not downloaded');
        }
        if (!statusData.loaded) {
          skipTest('TTS model still loading');
        }

        const payload = JSON.stringify({
          text: getDiagnosticText(language, languageData),
          language,
          provider,
        });
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
      name: 'tts-local-stream',
      timeoutMs: 60_000,
      async fn() {
        const { settings, language, languageData } = getVoiceDiagnosticContext();
        if (settings.ttsProvider !== 'qwen3') {
          skipTest('Qwen3-TTS is not selected');
        }

        const { status: statusStatus, body: statusBody } = await httpGet(
          backendTtsStatusUrl(language),
          10_000,
        );
        if (statusStatus !== 200) {
          throw new Error(`TTS status check failed with status ${statusStatus}`);
        }
        const statusData = JSON.parse(statusBody);
        if (statusData.error) {
          skipTest(`TTS unavailable for ${language}: ${statusData.error}`);
        }
        if (!statusData.downloaded) {
          skipTest('Qwen3-TTS model not downloaded');
        }
        if (!statusData.loaded) {
          skipTest('Qwen3-TTS model still loading');
        }

        const payload = JSON.stringify({
          text: getDiagnosticText(language, languageData),
          language,
          provider: 'qwen3',
        });
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${PYTHON_BACKEND_PORT}/voice/tts/stream`);
          const timer = setTimeout(() => {
            ws.terminate();
            reject(new Error('Local Qwen3-TTS stream timed out'));
          }, 60_000);
          let sawAudioMeta = false;
          let sawAudioBytes = false;

          ws.on('open', () => {
            ws.send(payload);
          });
          ws.on('message', (data, isBinary) => {
            if (isBinary) {
              const byteLength = Array.isArray(data)
                ? Buffer.concat(data).byteLength
                : Buffer.byteLength(data);
              sawAudioBytes = sawAudioBytes || byteLength >= Float32Array.BYTES_PER_ELEMENT;
              return;
            }
            const message = JSON.parse(data.toString());
            if (message.type === 'error') {
              clearTimeout(timer);
              ws.close();
              reject(new Error(String(message.message || 'Local Qwen3-TTS stream returned an error')));
              return;
            }
            if (message.type === 'audio') {
              if (message.encoding !== 'f32le') {
                clearTimeout(timer);
                ws.close();
                reject(new Error(`Local Qwen3-TTS stream returned unexpected encoding ${message.encoding}`));
                return;
              }
              sawAudioMeta = true;
              return;
            }
            if (message.type === 'done') {
              clearTimeout(timer);
              ws.close();
              if (!sawAudioMeta || !sawAudioBytes) {
                reject(new Error('Local Qwen3-TTS stream ended before audio was received'));
                return;
              }
              resolve();
            }
          });
          ws.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
      },
    },
  ],
});
