/**
 * Voice Service — relays audio between renderer IPC and Python backend
 * for STT (faster-whisper), TTS (Kokoro / Qwen3-TTS / Cloud), and VAD (Silero).
 *
 * All speech models run in the Python backend (server.py).
 * Audio streams from renderer via IPC → this service → Python WebSocket.
 * TTS is requested via HTTP POST, audio returned and forwarded to renderer.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { spawn } from 'child_process';
import { IPC_CHANNELS, API_ENDPOINTS, DEFAULT_CLOUD_API_URL } from '../../shared/constants';
import { limitConsecutiveDots } from '../../shared/utils/textUtils';
import type {
  VoiceModelStatus,
  VoiceSTTResult,
  VoiceVadEvent,
  VoiceMode,
  VoiceSample,
  VoiceTtsAudio,
  PipRequirementsConfig,
} from '../../shared/types';
import {
  getResourcePath,
  getPipExecutablePath,
  getPythonExecutablePath,
  isWindows,
} from '../utils/platform';
import { loadSettings } from './settings';
import { getQuitToken, readResourceFile } from './pythonBackend';
import WebSocket from 'ws';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.voiceService');

// ============================================================================
// Paths
// ============================================================================

const VOICE_SAMPLES_DIR = 'voice-samples';
const VOICE_SAMPLES_MANIFEST = 'voice-samples.json';

function getVoiceSamplesDir(): string {
  return path.join(app.getPath('userData'), VOICE_SAMPLES_DIR);
}

function getManifestPath(): string {
  return path.join(app.getPath('userData'), VOICE_SAMPLES_MANIFEST);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Voice Sample Management
// ============================================================================

export function loadSamplesManifest(): VoiceSample[] {
  const manifestPath = getManifestPath();
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    log.error("error", e);
    return [];
  }
}

function saveSamplesManifest(samples: VoiceSample[]): void {
  fs.writeFileSync(getManifestPath(), JSON.stringify(samples, null, 2), 'utf-8');
}

export function getVoiceSamplePath(sample: VoiceSample): string {
  return path.join(getVoiceSamplesDir(), sample.filename);
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function fetchJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) {
          log.error("error", e);
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{ data: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => { chunks.push(chunk); });
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 400) {
            const detail = data.toString('utf-8').slice(0, 500);
            reject(new Error(`HTTP ${res.statusCode}: ${detail}`));
          } else {
            resolve({ data, headers: res.headers });
          }
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ============================================================================
// Voice Package Installation
// ============================================================================

function loadVoicePackages(): string[] {
  try {
    const data = readResourceFile('pip_requirements.json');
    const config: PipRequirementsConfig = JSON.parse(data);
    return config.voice ?? [];
  } catch {
    log.error('Failed to load voice package config from any known path');
    return [];
  }
}

function loadQwen3Packages(): string[] {
  try {
    const data = readResourceFile('pip_requirements.json');
    const config = JSON.parse(data) as Record<string, string[]>;
    return config['qwen3-tts'] ?? [];
  } catch {
    log.error('Failed to load Qwen3 package config from any known path');
    return [];
  }
}

function installVoicePackages(
  onProgress: (status: VoiceModelStatus) => void,
  includeQwen3 = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    const packages = [
      ...loadVoicePackages(),
      ...(includeQwen3 ? loadQwen3Packages() : []),
    ];
    if (packages.length === 0) {
      resolve(true);
      return;
    }

    const pipExecutable = getPipExecutablePath();
    const pipArgs = isWindows
      ? ['-m', 'pip', 'install', ...packages]
      : ['install', ...packages];
    const executable = isWindows ? getPythonExecutablePath() : pipExecutable;
    const envPath = path.join(getResourcePath(), 'env');

    log.info('[VoiceService] Installing voice packages:', packages.join(', '));

    const pipProcess = spawn(executable, pipArgs, { cwd: envPath });

    const seenPackages = new Set<string>();

    const processLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Track progress via "Collecting" lines
      const collectingMatch = trimmed.match(/^Collecting\s+(\S+)/i);
      if (collectingMatch) {
        const pkgName = collectingMatch[1].replace(/[>=<!].*$/, '');
        seenPackages.add(pkgName.toLowerCase());
      }

      const satisfiedMatch = trimmed.match(/^Requirement already satisfied:\s+(\S+)/i);
      if (satisfiedMatch) {
        const pkgName = satisfiedMatch[1].replace(/[>=<!].*$/, '');
        seenPackages.add(pkgName.toLowerCase());
      }

      // Emit progress — pip install is 0-50% of total
      const pipProgress = Math.min(seenPackages.size / Math.max(packages.length, 1), 1);
      onProgress({
        sttDownloaded: false,
        ttsDownloaded: false,
        vadDownloaded: true,
        downloading: true,
        progress: pipProgress * 0.5,
        statusMessage: trimmed,
        sttModelName: 'openai/whisper-small',
        ttsModelName: 'Kokoro-82M',
      });
    };

    let outputBuffer = '';

    pipProcess.stdout.on('data', (data: Buffer) => {
      const text = data.toString('utf8');
      log.info('[VoiceService] pip:', text);
      outputBuffer += text;
      const lines = outputBuffer.split(/\r?\n/);
      outputBuffer = lines.pop() || '';
      for (const line of lines) processLine(line);
    });

    pipProcess.stderr.on('data', (data: Buffer) => {
      log.error('[VoiceService] pip error:', data.toString());
    });

    pipProcess.on('close', (code) => {
      if (outputBuffer.trim()) processLine(outputBuffer);
      if (code === 0 || code === null) {
        log.info('[VoiceService] Voice packages installed successfully');
        resolve(true);
      } else {
        log.error('[VoiceService] pip install failed with code:', code);
        resolve(false);
      }
    });

    pipProcess.on('error', (err) => {
      log.error('[VoiceService] Failed to spawn pip:', err);
      resolve(false);
    });
  });
}

// ============================================================================
// WebSocket Session State
// ============================================================================

let activeWs: WebSocket | null = null;
let activeSession = false;
let activeSender: Electron.WebContents | null = null;

const MAX_QUEUED_AUDIO_CHUNKS = 256;
let pendingAudioChunks: Float32Array[] = [];
let pendingTokenTimer: NodeJS.Timeout | null = null;

// ============================================================================
// TTS Abort
// ============================================================================

let ttsAbortController: AbortController | null = null;

// ============================================================================
// Model Status Check
// ============================================================================

async function checkModelStatus(_language: string): Promise<VoiceModelStatus> {
  const status: VoiceModelStatus = {
    sttDownloaded: false,
    ttsDownloaded: false,
    vadDownloaded: true, // VAD is loaded via torch.hub, always "available" if voice deps installed
    downloading: false,
    progress: 0,
    sttModelName: 'openai/whisper-small',
    ttsModelName: 'Kokoro-82M',
  };

  try {
    const [sttRes, ttsRes] = await Promise.all([
      fetchJson(API_ENDPOINTS.voiceSttStatus),
      fetchJson(API_ENDPOINTS.voiceTtsStatus),
    ]);
    status.sttDownloaded = (sttRes.downloaded as boolean) ?? false;
    status.ttsDownloaded = (ttsRes.downloaded as boolean) ?? false;
    status.downloading =
      ((sttRes.downloading as boolean) ?? false) ||
      ((ttsRes.downloading as boolean) ?? false);
    status.progress =
      (((sttRes.progress as number) ?? 0) + ((ttsRes.progress as number) ?? 0)) / 2;
  } catch (err) {
    log.error("error", err);
    status.error = err instanceof Error ? err.message : String(err);
  }

  return status;
}

// ============================================================================
// WebSocket Session Management
// ============================================================================

function startSession(
  language: string,
  mode: VoiceMode,
  silenceThreshold: number,
  sender: Electron.WebContents,
): void {
  if (activeWs) {
    stopSession();
  }

  const token = getQuitToken();
  if (!token) {
    waitForQuitTokenAndStart(language, mode, silenceThreshold, sender);
    return;
  }

  doStartSession(language, mode, silenceThreshold, sender, token);
}

function waitForQuitTokenAndStart(
  language: string,
  mode: VoiceMode,
  silenceThreshold: number,
  sender: Electron.WebContents,
): void {
  const startTime = Date.now();
  const TIMEOUT = 5000;
  const POLL_INTERVAL = 100;

  const poll = () => {
    const token = getQuitToken();
    if (token) {
      doStartSession(language, mode, silenceThreshold, sender, token);
      return;
    }
    if (Date.now() - startTime >= TIMEOUT) {
      sender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
        error: 'Voice backend is not ready. Please wait a moment and try again.',
      });
      return;
    }
    pendingTokenTimer = setTimeout(poll, POLL_INTERVAL);
  };

  poll();
}

function doStartSession(
  language: string,
  mode: VoiceMode,
  silenceThreshold: number,
  sender: Electron.WebContents,
  token: string,
): void {
  const wsUrl = `${API_ENDPOINTS.voiceStream}?language=${encodeURIComponent(language)}&silence=${silenceThreshold}&mode=${encodeURIComponent(mode)}&token=${encodeURIComponent(token)}`;

  try {
    const ws = new WebSocket(wsUrl);
    activeWs = ws;
    activeSession = true;
    activeSender = sender;

    ws.on('open', () => {
      log.info('[VoiceService] WebSocket connected to Python backend');
      for (const chunk of pendingAudioChunks) {
        try {
          ws.send(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        } catch (e) {
          log.error('[VoiceService] Failed to send queued audio chunk:', e);
        }
      }
      pendingAudioChunks = [];
    });

    ws.on('message', (rawData: WebSocket.RawData) => {
      if (!activeSender || activeSender.isDestroyed()) return;
      try {
        const msg = JSON.parse(rawData.toString());
        switch (msg.type) {
          case 'ready':
            activeSender.send(IPC_CHANNELS.VOICE_SESSION_READY, { ready: true });
            break;
          case 'vad': {
            const vadEvent: VoiceVadEvent = { type: msg.event };
            activeSender.send(IPC_CHANNELS.VOICE_VAD_EVENT, vadEvent);
            break;
          }
          case 'stt': {
            const sttResult: VoiceSTTResult = {
              text: msg.text,
              isFinal: msg.isFinal,
              isPartial: msg.isPartial ?? !msg.isFinal,
            };
            activeSender.send(IPC_CHANNELS.VOICE_STT_RESULT, sttResult);
            break;
          }
          case 'ping':
            // Respond to server keepalive pings
            break;
          case 'error':
            log.error('[VoiceService] Backend error:', msg.message);
            activeSender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
              error: msg.message,
            });
            break;
        }
      } catch (e) {
        log.error('[VoiceService] Failed to parse WS message:', e);
      }
    });

    ws.on('error', (err) => {
      log.error('[VoiceService] WebSocket error:', err);
      if (activeSender) {
        activeSender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
          error: err.message || 'WebSocket connection error',
        });
      }
    });

    ws.on('close', () => {
      log.info('[VoiceService] WebSocket closed');
      if (activeWs === ws) {
        activeWs = null;
        activeSession = false;
        activeSender = null;
      }
    });
  } catch (err) {
    log.error('[VoiceService] Failed to connect:', err);
    sender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function stopSession(): void {
  activeSession = false;
  activeSender = null;
  pendingAudioChunks = [];
  if (pendingTokenTimer) {
    clearTimeout(pendingTokenTimer);
    pendingTokenTimer = null;
  }
  if (activeWs) {
    try { activeWs.close(); } catch (e) {
      log.error("error", e);
    }
    activeWs = null;
  }
}

function sendAudioChunk(samples: Float32Array): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) {
    if (pendingAudioChunks.length < MAX_QUEUED_AUDIO_CHUNKS) {
      pendingAudioChunks.push(samples);
    }
    return;
  }
  try {
    activeWs.send(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  } catch (e) {
    log.error('[VoiceService] Failed to send audio chunk:', e);
  }
}

function sendFlush(): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
  try {
    activeWs.send(JSON.stringify({ type: 'flush' }));
  } catch (e) {
    log.error('[VoiceService] Failed to send flush command:', e);
  }
}

function sendSilenceThresholdUpdate(threshold: number): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
  try {
    activeWs.send(JSON.stringify({ type: 'silence_threshold', value: threshold }));
  } catch (e) {
    log.error('[VoiceService] Failed to send silence threshold update:', e);
  }
}

// ============================================================================
// TTS Generation via Cloud (BFF Worker → Modal)
// ============================================================================

async function generateCloudTTS(
  text: string,
  language: string,
  sender: Electron.WebContents,
  cloudAuthToken?: string,
): Promise<void> {
  ttsAbortController = new AbortController();
  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: true, playing: false });

  try {
    const settings = loadSettings();
    const authToken = cloudAuthToken || settings.cloudAuthAccessToken || settings.cloudAuthToken;
    if (!authToken) {
      throw new Error('Cloud TTS requires authentication. Please sign in to mLearn Cloud.');
    }

    const baseUrl = ((settings.overrideCloudEndpointUrl && settings.cloudApiUrl)
      ? settings.cloudApiUrl
      : DEFAULT_CLOUD_API_URL).replace(/\/+$/, '');

    // Step 1: Request stream URL from BFF
    const streamUrlObj = new URL(`${baseUrl}/api/tts/stream`);
    const body = JSON.stringify({ text, language, provider: 'moss-realtime' });

    const streamInfo = await new Promise<{ streamUrl: string }>((resolve, reject) => {
      if (ttsAbortController?.signal.aborted) { reject(new Error('Aborted')); return; }
      const proto = streamUrlObj.protocol === 'https:' ? https : http;
      const req = proto.request(
        {
          hostname: streamUrlObj.hostname,
          port: streamUrlObj.port,
          path: streamUrlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'Authorization': `Bearer ${authToken}`,
          },
          timeout: 30000,
        },
        (res: http.IncomingMessage) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Cloud TTS setup failed: HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              const url = data.actions?.stream_url;
              if (!url) {
                reject(new Error('Cloud TTS: no stream_url in response'));
                return;
              }
              resolve({ streamUrl: url });
            } catch (e) {
              log.error("error", e);
              reject(e);
            }
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Cloud TTS setup timeout')); });
      req.write(body);
      req.end();
    });

    if (ttsAbortController?.signal.aborted) return;

    // Step 2: Stream audio from Modal endpoint
    // The Modal endpoint returns chunked WAV — each chunk is a separate WAV file (~100ms of PCM_16 @ 24kHz)
    const sampleRate = 24000;
    const WAV_HEADER_SIZE = 44;

    const streamAudio = (streamUrl: string, redirectsLeft = 5): Promise<void> => {
      return new Promise((resolve, reject) => {
        if (redirectsLeft <= 0) {
          reject(new Error('Too many redirects'));
          return;
        }
        if (ttsAbortController?.signal.aborted) { resolve(); return; }

        const url = new URL(streamUrl);
        const proto = url.protocol === 'https:' ? https : http;
        const req = proto.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: 'GET',
            timeout: 120000,
          },
          (res: http.IncomingMessage) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              res.resume();
              streamAudio(new URL(res.headers.location, url.toString()).toString(), redirectsLeft - 1)
                .then(resolve, reject);
              return;
            }

            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(`Cloud TTS stream failed: HTTP ${res.statusCode}`));
              return;
            }

            // Accumulate incoming data and extract WAV chunks.
            // Each chunk from Modal is a full WAV file (header + PCM data).
            let pending = Buffer.alloc(0);
            let sentenceIndex = 0;

            res.on('data', (chunk: Buffer) => {
              if (ttsAbortController?.signal.aborted) {
                res.destroy();
                return;
              }
              pending = Buffer.concat([pending, chunk]);

              // Try to extract complete WAV chunks from the buffer
              while (pending.length > WAV_HEADER_SIZE) {
                // Read data size from WAV header bytes 40-43 (little-endian uint32)
                const dataSize = pending.readUInt32LE(40);
                const totalSize = WAV_HEADER_SIZE + dataSize;
                if (pending.length < totalSize) break;

                // Extract this WAV chunk's PCM data
                const pcmData = pending.subarray(WAV_HEADER_SIZE, totalSize);
                pending = pending.subarray(totalSize);

                // Convert Int16 PCM to Float32
                const int16View = new Int16Array(
                  pcmData.buffer,
                  pcmData.byteOffset,
                  pcmData.byteLength / 2,
                );
                const float32Samples = new Float32Array(int16View.length);
                for (let i = 0; i < int16View.length; i++) {
                  float32Samples[i] = int16View[i] / 32768;
                }

                const audio: VoiceTtsAudio = {
                  samples: float32Samples,
                  sampleRate,
                  sentenceIndex: sentenceIndex++,
                  sentenceText: sentenceIndex === 1 ? text : '',
                  totalSentences: 1,
                };
                sender.send(IPC_CHANNELS.VOICE_TTS_AUDIO, audio);
              }
            });

            res.on('end', resolve);
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Cloud TTS stream timeout')); });
        req.end();
      });
    };

    await streamAudio(streamInfo.streamUrl);
  } catch (err) {
    if (!ttsAbortController?.signal.aborted) {
      log.error('[VoiceService] Cloud TTS error:', err);
    }
  }

  ttsAbortController = null;
  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
}

// ============================================================================
// TTS Generation via Python Backend
// ============================================================================

async function generateTTS(
  text: string,
  language: string,
  speed: number,
  voiceSampleId: string | undefined,
  sender: Electron.WebContents,
  provider?: string,
  cloudAuthToken?: string,
): Promise<void> {
  // Sanitize consecutive dots to prevent TTS backend failures
  const sanitizedText = limitConsecutiveDots(text);

  // Cloud TTS has a completely different path — BFF → Modal streaming
  if (provider === 'cloud') {
    return generateCloudTTS(sanitizedText, language, sender, cloudAuthToken);
  }

  ttsAbortController = new AbortController();

  // Check if TTS model is loaded — if not, signal that model loading is in progress
  let modelLoading = false;
  try {
    const ttsStatus = await fetchJson(API_ENDPOINTS.voiceTtsStatus);
    modelLoading = !(ttsStatus.loaded as boolean);
  } catch (e) {
    log.error("error", e);
    // If status check fails, proceed without the flag
  }

  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: true, playing: false, modelLoading });

  // Poll model loading progress while waiting for the TTS response
  let progressPollTimer: ReturnType<typeof setInterval> | null = null;
  if (modelLoading) {
    progressPollTimer = setInterval(async () => {
      if (ttsAbortController?.signal.aborted) {
        if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
        return;
      }
      try {
        const s = await fetchJson(API_ENDPOINTS.voiceTtsStatus);
        sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, {
          generating: true,
          playing: false,
          modelLoading: !(s.loaded as boolean),
          downloadProgress: s.progress as number ?? 0,
        });
      } catch (e) {
        log.error("error", e);
      }
    }, 2000);
  }

  try {
    // Resolve voice sample path if provided
    let voiceSamplePath: string | undefined;
    if (voiceSampleId) {
      const samples = loadSamplesManifest();
      const sample = samples.find((s) => s.id === voiceSampleId);
      if (sample) {
        voiceSamplePath = getVoiceSamplePath(sample);
      }
    }

    const body: Record<string, unknown> = { text: sanitizedText, language, speed };
    if (voiceSamplePath) {
      body.voiceSamplePath = voiceSamplePath;
    }
    if (provider) {
      body.provider = provider;
    }

    const { data, headers } = await postJson(API_ENDPOINTS.voiceTts, body);

    if (ttsAbortController?.signal.aborted) return;

    // Parse sentence boundaries from response header
    const boundariesHeader = headers['x-sentence-boundaries'];
    const sampleRateHeader = headers['x-sample-rate'];
    const sampleRate = sampleRateHeader ? parseInt(sampleRateHeader as string, 10) : 24000;

    let boundaries: Array<{
      index: number;
      text: string;
      sampleOffset: number;
      sampleCount: number;
    }> = [];

    if (boundariesHeader) {
      try { boundaries = JSON.parse(boundariesHeader as string); } catch (e) {
        log.error("error", e);
      }
    }

    // Extract WAV PCM data (skip 44-byte WAV header)
    const wavHeader = 44;
    const pcmData = data.subarray(wavHeader);

    // Convert Int16 PCM to Float32
    const int16View = new Int16Array(
      pcmData.buffer,
      pcmData.byteOffset,
      pcmData.byteLength / 2,
    );
    const float32Samples = new Float32Array(int16View.length);
    for (let i = 0; i < int16View.length; i++) {
      float32Samples[i] = int16View[i] / 32768;
    }

    if (ttsAbortController?.signal.aborted) return;

    if (boundaries.length > 0) {
      // Send audio per-sentence for precise interruption tracking
      for (const boundary of boundaries) {
        if (ttsAbortController?.signal.aborted) break;

        const sentenceSamples = float32Samples.slice(
          boundary.sampleOffset,
          boundary.sampleOffset + boundary.sampleCount,
        );

        const audio: VoiceTtsAudio = {
          samples: sentenceSamples,
          sampleRate,
          sentenceIndex: boundary.index,
          sentenceText: boundary.text,
          totalSentences: boundaries.length,
          sampleOffset: boundary.sampleOffset,
          sampleCount: boundary.sampleCount,
        };
        sender.send(IPC_CHANNELS.VOICE_TTS_AUDIO, audio);
      }
    } else {
      // Fallback: send entire audio at once
      const audio: VoiceTtsAudio = { samples: float32Samples, sampleRate };
      sender.send(IPC_CHANNELS.VOICE_TTS_AUDIO, audio);
    }
  } catch (err) {
    if (!ttsAbortController?.signal.aborted) {
      log.error('[VoiceService] TTS generation error:', err);
    }
  }

  if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
  ttsAbortController = null;
  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
}

function stopTTS(): void {
  if (ttsAbortController) {
    ttsAbortController.abort();
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function setupVoiceIPC(): void {
  // Model status
  ipcMain.handle(IPC_CHANNELS.VOICE_MODEL_STATUS, async (_event, language: string) => {
    const status = await checkModelStatus(language);
    log.info('[VoiceService] Model status for', language, ':', JSON.stringify(status));
    return status;
  });

  // Trigger model pre-download in Python backend
  ipcMain.on(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD, async (event, language: string) => {
    try {
      const emitProgress = (s: VoiceModelStatus) => {
        event.sender.send(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD_PROGRESS, s);
      };

      emitProgress({
        sttDownloaded: false,
        ttsDownloaded: false,
        vadDownloaded: true,
        downloading: true,
        progress: 0,
        statusMessage: 'Installing voice dependencies…',
        sttModelName: 'openai/whisper-small',
        ttsModelName: 'Kokoro-82M',
      });

      // Step 1: Check if voice packages are installed
      const initialStatus = await checkModelStatus(language);
      const needsPackageInstall = !initialStatus.sttDownloaded || !initialStatus.ttsDownloaded;

      if (needsPackageInstall) {
        // Install voice pip packages first
        const pipSuccess = await installVoicePackages(emitProgress);
        if (!pipSuccess) {
          emitProgress({
            sttDownloaded: false,
            ttsDownloaded: false,
            vadDownloaded: false,
            downloading: false,
            progress: 0,
            error: 'voice-packages-install-failed',
          });
          return;
        }
      }

      // Step 2: Load/download model weights via Python backend
      emitProgress({
        sttDownloaded: false,
        ttsDownloaded: false,
        vadDownloaded: true,
        downloading: true,
        progress: 0.5,
        statusMessage: 'Downloading voice models…',
        sttModelName: 'openai/whisper-small',
        ttsModelName: 'Kokoro-82M',
      });

      await postJson(API_ENDPOINTS.voiceModelsDownload, {});

      const finalStatus = await checkModelStatus(language);
      if (!finalStatus.sttDownloaded || !finalStatus.ttsDownloaded) {
        finalStatus.error = finalStatus.error || 'voice-models-install-failed';
      }
      emitProgress(finalStatus);
    } catch (err) {
      log.error('[VoiceService] Model download failed:', err);
      event.sender.send(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD_PROGRESS, {
        sttDownloaded: false,
        ttsDownloaded: false,
        vadDownloaded: false,
        downloading: false,
        progress: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Start voice session
  ipcMain.on(
    IPC_CHANNELS.VOICE_START_SESSION,
    (event, language: string, mode: VoiceMode, silenceThreshold?: number) => {
      startSession(language, mode, silenceThreshold ?? 1.5, event.sender);
    },
  );

  // Stop voice session
  ipcMain.on(IPC_CHANNELS.VOICE_STOP_SESSION, () => {
    stopSession();
  });

  // Receive audio chunk from renderer
  ipcMain.on(IPC_CHANNELS.VOICE_AUDIO_CHUNK, (_event, samples: Float32Array) => {
    if (activeSession) {
      sendAudioChunk(new Float32Array(samples));
    }
  });

  // Flush buffered speech (PTT release)
  ipcMain.on(IPC_CHANNELS.VOICE_FLUSH, () => {
    if (activeSession) {
      sendFlush();
    }
  });

  // Update silence threshold at runtime
  ipcMain.on(IPC_CHANNELS.VOICE_UPDATE_SILENCE_THRESHOLD, (_event, threshold: number) => {
    if (activeSession) {
      sendSilenceThresholdUpdate(threshold);
    }
  });

  // TTS generation request
  ipcMain.on(
    IPC_CHANNELS.VOICE_TTS_GENERATE,
    (event, text: string, language: string, speed?: number, voiceSampleId?: string, provider?: string, cloudAuthToken?: string) => {
      generateTTS(text, language, speed ?? 1.0, voiceSampleId, event.sender, provider, cloudAuthToken).catch((err) => {
        log.error('[VoiceService] TTS error:', err);
      });
    },
  );

  // TTS stop
  ipcMain.on(IPC_CHANNELS.VOICE_TTS_STOP, (event) => {
    stopTTS();
    event.sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
  });

  // ========== Voice Sample Management ==========

  ipcMain.handle(IPC_CHANNELS.VOICE_SAMPLE_LIST, () => {
    // Reconcile manifest with actual files on disk
    const samples = loadSamplesManifest();
    const dir = getVoiceSamplesDir();
    const validSamples = samples.filter((s) => {
      const filePath = path.join(dir, s.filename);
      return fs.existsSync(filePath);
    });
    if (validSamples.length !== samples.length) {
      saveSamplesManifest(validSamples);
    }
    return validSamples;
  });

  ipcMain.handle(
    IPC_CHANNELS.VOICE_SAMPLE_UPLOAD,
    async (_event, sourcePath: string, name: string) => {
      ensureDir(getVoiceSamplesDir());
      const id = crypto.randomUUID();
      const ext = path.extname(sourcePath) || '.wav';
      const filename = `${id}${ext}`;
      const destPath = path.join(getVoiceSamplesDir(), filename);

      fs.copyFileSync(sourcePath, destPath);

      const sample: VoiceSample = { id, name, filename, createdAt: Date.now() };
      const samples = loadSamplesManifest();
      samples.push(sample);
      saveSamplesManifest(samples);

      return sample;
    },
  );

  ipcMain.handle(IPC_CHANNELS.VOICE_SAMPLE_DELETE, (_event, id: string) => {
    const samples = loadSamplesManifest();
    const idx = samples.findIndex((s) => s.id === id);
    if (idx === -1) return false;

    const sample = samples[idx];
    const filePath = getVoiceSamplePath(sample);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    samples.splice(idx, 1);
    saveSamplesManifest(samples);
    return true;
  });

  ipcMain.handle(
    IPC_CHANNELS.VOICE_SAMPLE_RENAME,
    (_event, id: string, newName: string) => {
      const samples = loadSamplesManifest();
      const sample = samples.find((s) => s.id === id);
      if (!sample) return false;

      sample.name = newName;
      saveSamplesManifest(samples);
      return true;
    },
  );

  // Transcribe a voice sample via Python STT
  ipcMain.handle(
    IPC_CHANNELS.VOICE_SAMPLE_TRANSCRIBE,
    async (_event, id: string) => {
      const samples = loadSamplesManifest();
      const sample = samples.find((s) => s.id === id);
      if (!sample) throw new Error('Voice sample not found');

      const samplePath = getVoiceSamplePath(sample);
      const { data } = await postJson(API_ENDPOINTS.voiceTranscribe, {
        voiceSamplePath: samplePath,
      });
      const parsed = JSON.parse(data.toString('utf-8'));
      if (parsed.detail) {
        throw new Error(typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail));
      }
      const result = parsed as { text: string; language: string };
      if (!result.text) {
        throw new Error('Transcription returned empty text');
      }

      // Save transcript as sidecar .txt file
      const txtPath = samplePath.replace(/\.[^.]+$/, '.txt');
      fs.writeFileSync(txtPath, result.text, 'utf-8');

      // Update manifest with transcript
      sample.transcript = result.text;
      saveSamplesManifest(samples);

      return result;
    },
  );

  // Return a data URL for a voice sample so the renderer can play it
  ipcMain.handle(
    IPC_CHANNELS.VOICE_SAMPLE_GET_PATH,
    async (_event, id: string) => {
      const samples = loadSamplesManifest();
      const sample = samples.find((s) => s.id === id);
      if (!sample) return null;

      const samplePath = getVoiceSamplePath(sample);
      if (!fs.existsSync(samplePath)) return null;

      const buffer = fs.readFileSync(samplePath);
      const ext = path.extname(sample.filename).slice(1) || 'wav';
      const mimeMap: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4' };
      const mime = mimeMap[ext] || `audio/${ext}`;
      return `data:${mime};base64,${buffer.toString('base64')}`;
    },
  );
}
