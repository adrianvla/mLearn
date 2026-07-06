/**
 * Voice Service — relays audio between renderer IPC and Python backend
 * for STT (faster-whisper), local TTS (Kokoro / Qwen3-TTS), and VAD (Silero).
 *
 * All speech models run in the Python backend (server.py).
 * Audio streams from renderer via IPC → this service → Python WebSocket.
 * Realtime TTS streams from the local Python backend and is forwarded to renderer.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { spawn } from 'child_process';
import { IPC_CHANNELS, API_ENDPOINTS } from '../../shared/constants';
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

function getVoiceSampleTranscriptPath(sample: VoiceSample): string {
  return getVoiceSamplePath(sample).replace(/\.[^.]+$/, '.txt');
}

async function ensureVoiceSampleTranscript(
  sample: VoiceSample,
  samples: VoiceSample[],
  language: string,
  force = false,
): Promise<{ text: string; language: string }> {
  if (!force && typeof sample.transcript === 'string' && sample.transcript.trim()) {
    return { text: sample.transcript.trim(), language: sample.language || language };
  }

  const txtPath = getVoiceSampleTranscriptPath(sample);
  if (!force && fs.existsSync(txtPath)) {
    const transcript = fs.readFileSync(txtPath, 'utf-8').trim();
    if (transcript) {
      sample.transcript = transcript;
      saveSamplesManifest(samples);
      return { text: transcript, language: sample.language || language };
    }
  }

  const payload: { voiceSamplePath: string; language?: string } = {
    voiceSamplePath: getVoiceSamplePath(sample),
  };
  if (language) {
    payload.language = language;
  }
  const { data } = await postJson(API_ENDPOINTS.voiceTranscribe, payload);
  const parsed = JSON.parse(data.toString('utf-8'));
  if (parsed.detail) {
    throw new Error(typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail));
  }
  const result = parsed as { text?: string; language?: string };
  const transcript = result.text?.trim();
  if (!transcript) {
    throw new Error('Transcription returned empty text');
  }

  fs.writeFileSync(txtPath, transcript, 'utf-8');
  sample.transcript = transcript;
  if (result.language) {
    sample.language = result.language;
  }
  saveSamplesManifest(samples);
  return { text: transcript, language: result.language || language };
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

function withQuery(url: string, params: Record<string, string | undefined>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      parsed.searchParams.set(key, value);
    }
  }
  return parsed.toString();
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
        path: `${urlObj.pathname}${urlObj.search}`,
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
let activeTtsWs: WebSocket | null = null;

// ============================================================================
// Model Status Check
// ============================================================================

async function checkModelStatus(language: string): Promise<VoiceModelStatus> {
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
      fetchJson(withQuery(API_ENDPOINTS.voiceTtsStatus, { language })),
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

async function isQwen3TtsEngine(language: string): Promise<boolean> {
  try {
    const ttsStatus = await fetchJson(withQuery(API_ENDPOINTS.voiceTtsStatus, { language }));
    const modelName = String(ttsStatus.modelName ?? '');
    return modelName.toLowerCase().includes('qwen3');
  } catch (err) {
    log.error("error", err);
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function emitModelDownloadProgress(
  language: string,
  emitProgress: (status: VoiceModelStatus) => void,
): Promise<void> {
  const status = await checkModelStatus(language);
  emitProgress({
    ...status,
    downloading: true,
    progress: Math.min(0.5 + status.progress * 0.5, 0.99),
    statusMessage: 'Downloading voice models…',
  });
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
// TTS Generation via Python Backend
// ============================================================================

async function generateTTS(
  text: string,
  language: string,
  speed: number,
  voiceSampleId: string | undefined,
  sender: Electron.WebContents,
  provider?: string,
): Promise<void> {
  // Sanitize consecutive dots to prevent TTS backend failures
  const sanitizedText = limitConsecutiveDots(text);

  if (provider === 'cloud') {
    sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
    sender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
      error: 'Cloud realtime TTS is temporarily disabled. Choose a local TTS provider.',
    });
    return;
  }

  const abortController = new AbortController();
  ttsAbortController = abortController;

  // Check if TTS model is loaded — if not, signal that model loading is in progress
  let modelLoading = false;
  try {
    const ttsStatus = await fetchJson(withQuery(API_ENDPOINTS.voiceTtsStatus, { language }));
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
      if (abortController.signal.aborted) {
        if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
        return;
      }
      try {
        const s = await fetchJson(withQuery(API_ENDPOINTS.voiceTtsStatus, { language }));
        sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, {
          generating: true,
          playing: false,
          modelLoading: !(s.loaded as boolean) || ((s.downloading as boolean) ?? false),
          downloadProgress: s.progress as number ?? 0,
        });
      } catch (e) {
        log.error("error", e);
      }
    }, 2000);
  }

  try {
    // Resolve voice sample path if provided
    const requestedProvider = provider || 'qwen3';
    let voiceSamplePath: string | undefined;
    if (voiceSampleId) {
      const samples = loadSamplesManifest();
      const sample = samples.find((s) => s.id === voiceSampleId);
      if (sample) {
        if (requestedProvider === 'qwen3') {
          await ensureVoiceSampleTranscript(sample, samples, language);
        }
        voiceSamplePath = getVoiceSamplePath(sample);
      }
    }

    const body: Record<string, unknown> = {
      text: sanitizedText,
      language,
      speed,
      provider: requestedProvider,
    };
    if (voiceSamplePath) {
      body.voiceSamplePath = voiceSamplePath;
    }

    await streamLocalTTS(body, sender, abortController.signal);
  } catch (err) {
    if (!abortController.signal.aborted) {
      log.error('[VoiceService] TTS generation error:', err);
    }
  }

  if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
  if (ttsAbortController === abortController) {
    ttsAbortController = null;
  }
  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
}

function streamLocalTTS(
  body: Record<string, unknown>,
  sender: Electron.WebContents,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(API_ENDPOINTS.voiceTtsStream);
    activeTtsWs = ws;
    let pendingAudioMeta: {
      sampleRate: number;
      sentenceIndex?: number;
      sentenceText?: string;
      totalSentences?: number;
      sampleOffset?: number;
      sampleCount?: number;
      byteLength?: number;
    } | null = null;

    const rawDataToBuffer = (rawData: WebSocket.RawData): Buffer | null => {
      if (Buffer.isBuffer(rawData)) return rawData;
      if (rawData instanceof ArrayBuffer) return Buffer.from(rawData);
      if (Array.isArray(rawData)) return Buffer.concat(rawData);
      return null;
    };

    const emitTtsAudio = (samples: Float32Array, meta: typeof pendingAudioMeta) => {
      if (!meta || signal.aborted) return;
      const audio: VoiceTtsAudio = {
        samples,
        sampleRate: meta.sampleRate,
        sentenceIndex: meta.sentenceIndex,
        sentenceText: meta.sentenceText,
        totalSentences: meta.totalSentences,
        sampleOffset: meta.sampleOffset,
        sampleCount: meta.sampleCount ?? samples.length,
      };
      sender.send(IPC_CHANNELS.VOICE_TTS_AUDIO, audio);
    };

    const abortStream = () => {
      try {
        ws.close();
      } catch (e) {
        log.error("error", e);
      }
    };

    signal.addEventListener('abort', abortStream, { once: true });

    ws.on('open', () => {
      if (signal.aborted) {
        ws.close();
        return;
      }
      ws.send(JSON.stringify(body));
    });

    ws.on('message', (rawData: WebSocket.RawData, isBinary: boolean) => {
      if (sender.isDestroyed() || signal.aborted) return;
      try {
        if (pendingAudioMeta && isBinary) {
          const binaryFrame = rawDataToBuffer(rawData);
          if (binaryFrame) {
            if (typeof pendingAudioMeta.byteLength === 'number' && binaryFrame.byteLength !== pendingAudioMeta.byteLength) {
              log.warn(`[VoiceService] TTS binary frame length mismatch: expected ${pendingAudioMeta.byteLength}, got ${binaryFrame.byteLength}`);
            }
            const samples = new Float32Array(
              binaryFrame.buffer,
              binaryFrame.byteOffset,
              Math.floor(binaryFrame.byteLength / Float32Array.BYTES_PER_ELEMENT),
            );
            emitTtsAudio(new Float32Array(samples), pendingAudioMeta);
            pendingAudioMeta = null;
            return;
          }
        }

        const msg = JSON.parse(rawData.toString());
        switch (msg.type) {
          case 'audio': {
            pendingAudioMeta = {
              sampleRate: Number(msg.sampleRate) || 24000,
              sentenceIndex: typeof msg.sentenceIndex === 'number' ? msg.sentenceIndex : undefined,
              sentenceText: typeof msg.sentenceText === 'string' ? msg.sentenceText : undefined,
              totalSentences: typeof msg.totalSentences === 'number' ? msg.totalSentences : undefined,
              sampleOffset: typeof msg.sampleOffset === 'number' ? msg.sampleOffset : undefined,
              sampleCount: typeof msg.sampleCount === 'number' ? msg.sampleCount : undefined,
              byteLength: typeof msg.byteLength === 'number' ? msg.byteLength : undefined,
            };
            if (Array.isArray(msg.samples)) {
              const samples = Float32Array.from(msg.samples);
              emitTtsAudio(samples, pendingAudioMeta);
              pendingAudioMeta = null;
            }
            break;
          }
          case 'status':
            sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, {
              generating: msg.generating !== false,
              playing: false,
              modelLoading: msg.modelLoading,
              downloadProgress: msg.downloadProgress,
            });
            break;
          case 'done':
            ws.close();
            break;
          case 'error':
            reject(new Error(String(msg.message || 'TTS stream error')));
            ws.close();
            break;
        }
      } catch (e) {
        log.error('[VoiceService] Failed to parse TTS stream message:', e);
      }
    });

    ws.on('error', reject);
    ws.on('close', () => {
      signal.removeEventListener('abort', abortStream);
      if (activeTtsWs === ws) {
        activeTtsWs = null;
      }
      resolve();
    });
  });
}

function stopTTS(): void {
  if (ttsAbortController) {
    ttsAbortController.abort();
  }
  if (activeTtsWs) {
    try { activeTtsWs.close(); } catch (e) {
      log.error("error", e);
    }
    activeTtsWs = null;
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
      const includeQwen3 = !initialStatus.ttsDownloaded && await isQwen3TtsEngine(language);

      if (needsPackageInstall) {
        // Install voice pip packages first
        const pipSuccess = await installVoicePackages(emitProgress, includeQwen3);
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

      let downloadComplete = false;
      const downloadPromise = postJson(
        withQuery(API_ENDPOINTS.voiceModelsDownload, { language }),
        {},
      )
        .finally(() => {
          downloadComplete = true;
        });
      const downloadSettled = downloadPromise.then(() => undefined, () => undefined);

      while (!downloadComplete) {
        await Promise.race([downloadSettled, wait(1000)]);
        if (!downloadComplete) {
          await emitModelDownloadProgress(language, emitProgress);
        }
      }
      await downloadPromise;

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
    (event, text: string, language: string, speed?: number, voiceSampleId?: string, provider?: string, _cloudAuthToken?: string) => {
      generateTTS(text, language, speed ?? 1.0, voiceSampleId, event.sender, provider).catch((err) => {
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
    async (_event, id: string, language?: string) => {
      const samples = loadSamplesManifest();
      const sample = samples.find((s) => s.id === id);
      if (!sample) throw new Error('Voice sample not found');

      return ensureVoiceSampleTranscript(sample, samples, language || '', true);
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
