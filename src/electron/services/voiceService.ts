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
import { execFile, spawn, type ChildProcess } from 'child_process';
import { IPC_CHANNELS, API_ENDPOINTS } from '../../shared/constants';
import { limitConsecutiveDots, stripBracketedTtsAnnotations } from '../../shared/utils/textUtils';
import type {
  VoiceModelStatus,
  VoiceSTTResult,
  VoiceVadEvent,
  VoiceMode,
  VoiceSample,
  VoiceTtsAudio,
  VoiceTtsRequestIdentity,
  VoiceTtsStopScope,
} from '../../shared/types';
import {
  getResourcePath,
  getPipExecutablePath,
  getPythonExecutablePath,
  isLinux,
  isMac,
  isWindows,
} from '../utils/platform';
import { loadLangData } from './settings';
import { getQuitToken, onQuitTokenAvailable, readResourceFile } from './pythonBackend';
import WebSocket from 'ws';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.voiceService');

function normalizeVadEventType(event: unknown): VoiceVadEvent['type'] {
  if (event === 'speech_start') return 'speech-start';
  if (event === 'speech_end') return 'speech-end';
  return event === 'speech-end' ? 'speech-end' : 'speech-start';
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// ============================================================================
// Platform detection & static STT model fallback
// ============================================================================

const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64';

// Static fallback used before the Python backend is reachable. The backend
// returns the authoritative `modelName` and `engine` via /voice/stt/status.
const DEFAULT_STT_MODEL_NAME = isAppleSilicon
  ? 'mlx-community/whisper-large-v3-turbo-asr-fp16'
  : 'openai/whisper-small';

// ============================================================================
// Paths
// ============================================================================

const VOICE_SAMPLES_DIR = 'voice-samples';
const VOICE_SAMPLES_MANIFEST = 'voice-samples.json';
const DEFAULT_VOICE_SILENCE_THRESHOLD = 0.8;

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

export async function ensureVoiceSampleTranscript(
  sample: VoiceSample,
  _samples: VoiceSample[],
  language: string,
  force = false,
  signal?: AbortSignal,
): Promise<{ text: string; language: string }> {
  const commitTranscript = (transcript: string, detectedLanguage?: string): void => {
    if (signal?.aborted) throw new Error('Voice sample transcription cancelled');
    const latest = loadSamplesManifest();
    const current = latest.find(item => item.id === sample.id);
    if (!current || current.filename !== sample.filename || current.createdAt !== sample.createdAt
      || current.transcript !== sample.transcript || current.language !== sample.language) {
      throw new Error('Voice sample changed during transcription');
    }
    fs.writeFileSync(getVoiceSampleTranscriptPath(current), transcript, 'utf-8');
    current.transcript = transcript;
    if (detectedLanguage) current.language = detectedLanguage;
    saveSamplesManifest(latest);
    sample.transcript = current.transcript;
    sample.language = current.language;
  };
  if (signal?.aborted) throw new Error('Voice sample transcription cancelled');
  if (!force && typeof sample.transcript === 'string' && sample.transcript.trim()) {
    commitTranscript(sample.transcript.trim());
    return { text: sample.transcript.trim(), language: sample.language || language };
  }

  const txtPath = getVoiceSampleTranscriptPath(sample);
  if (!force && fs.existsSync(txtPath)) {
    const transcript = fs.readFileSync(txtPath, 'utf-8').trim();
    if (transcript) {
      commitTranscript(transcript);
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

  commitTranscript(transcript, result.language);
  return { text: transcript, language: result.language || language };
}

// ============================================================================
// HTTP Helpers
// ============================================================================

function fetchJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const token = getQuitToken();
    const urlObj = new URL(url);
    const req = http.get(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: `${urlObj.pathname}${urlObj.search}`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) {
            log.error("error", e);
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
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
    const token = getQuitToken();
    const req = http.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

function loadPackageGroup(group: string): string[] {
  try {
    const data = readResourceFile('pip_requirements.json');
    const config = JSON.parse(data) as Record<string, string[]>;
    return config[group] ?? [];
  } catch {
    log.error(`Failed to load '${group}' voice package config from any known path`);
    return [];
  }
}

/**
 * Ordered pip package groups for the voice stack, per platform. The first
 * group is essential (voice / voice-windows); later groups are engine
 * add-ons. Apple Silicon keeps the mlx groups; every other platform uses
 * the torch-based qwen3 group instead.
 */
export function resolveVoiceInstallGroupNames(
  appleSilicon: boolean,
  windows: boolean,
  includeQwen3: boolean,
  includeMlxStt: boolean,
): string[] {
  if (appleSilicon) {
    const groups = ['voice'];
    if (includeQwen3) groups.push('qwen3-tts');
    if (includeMlxStt) groups.push('mlx-stt');
    return groups;
  }
  const groups = [windows ? 'voice-windows' : 'voice'];
  if (includeQwen3) groups.push('qwen3-tts-torch');
  return groups;
}

// Windows torch wheels pinned to CUDA builds (torch==*+cu128) resolve only
// from the PyTorch CUDA index — PyPI ships CPU-only Windows wheels.
const PYTORCH_CUDA_INDEX_URL = 'https://download.pytorch.org/whl/cu128';

/**
 * pip argv for one package group. Windows installs go through the bundled
 * python (-m pip); CUDA-bearing groups additionally need the PyTorch index.
 */
export function buildPipArgs(windows: boolean, group: string, packages: string[]): string[] {
  if (!windows) {
    return ['install', ...packages];
  }
  const needsCudaIndex = group === 'voice-windows' || group === 'qwen3-tts-torch';
  return [
    '-m',
    'pip',
    'install',
    ...packages,
    ...(needsCudaIndex ? ['--extra-index-url', PYTORCH_CUDA_INDEX_URL] : []),
  ];
}

// close(null) means pip died by signal. Only an intentional cancel counts as
// a clean abort; a null exit code without that flag is an unexpected failure.
let pipAbortRequested = false;
let activePipProcess: ChildProcess | null = null;

/** Marks the in-flight voice package install as aborted and kills its pip process. */
export function cancelVoicePackageInstall(): void {
  if (!activePipProcess) return;
  pipAbortRequested = true;
  try {
    activePipProcess.kill('SIGKILL');
  } catch (e) {
    log.error('[VoiceService] Failed to kill pip process:', e);
  }
}

async function installVoicePackages(
  onProgress: (status: VoiceModelStatus) => void,
  includeQwen3 = false,
  includeMlxStt = false,
): Promise<boolean> {
  const groups = resolveVoiceInstallGroupNames(isAppleSilicon, isWindows, includeQwen3, includeMlxStt)
    .map((name) => ({ name, packages: loadPackageGroup(name) }))
    .filter((group) => group.packages.length > 0);
  if (groups.length === 0) {
    return true;
  }

  pipAbortRequested = false;
  const totalPackages = groups.reduce((sum, group) => sum + group.packages.length, 0);
  const pipExecutable = getPipExecutablePath();
  const envPath = path.join(getResourcePath(), 'env');

  // Shared across groups so combined pip progress spans 0-50% of the whole install.
  const seenPackages = new Set<string>();

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Track progress via "Collecting" lines
    const collectingMatch = trimmed.match(/^Collecting\s+(\S+)/i);
    if (collectingMatch) {
      seenPackages.add(collectingMatch[1].replace(/[>=<!].*$/, '').toLowerCase());
    }

    const satisfiedMatch = trimmed.match(/^Requirement already satisfied:\s+(\S+)/i);
    if (satisfiedMatch) {
      seenPackages.add(satisfiedMatch[1].replace(/[>=<!].*$/, '').toLowerCase());
    }

    // Emit progress — pip install spans 0-50% of the total, across all groups.
    onProgress({
      sttDownloaded: false,
      ttsDownloaded: false,
      vadDownloaded: true,
      downloading: true,
      progress: Math.min(seenPackages.size / Math.max(totalPackages, 1), 1) * 0.5,
      statusMessage: trimmed,
      sttModelName: DEFAULT_STT_MODEL_NAME,
      ttsModelName: 'Kokoro-82M',
    });
  };

  const installGroup = (group: { name: string; packages: string[] }): Promise<boolean> =>
    new Promise((resolve) => {
      const pipArgs = buildPipArgs(isWindows, group.name, group.packages);
      const executable = isWindows ? getPythonExecutablePath() : pipExecutable;

      log.info(`[VoiceService] Installing voice package group '${group.name}':`, group.packages.join(', '));

      const pipProcess = spawn(executable, pipArgs, { cwd: envPath });
      activePipProcess = pipProcess;

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
        if (activePipProcess === pipProcess) {
          activePipProcess = null;
        }
        if (code === 0) {
          log.info(`[VoiceService] Voice package group '${group.name}' installed successfully`);
          resolve(true);
          return;
        }
        if (code === null && pipAbortRequested) {
          // Killed by an intentional cancel — not an install error.
          log.info(`[VoiceService] Voice package group '${group.name}' install aborted`);
          resolve(false);
          return;
        }
        if (code === null) {
          log.error(`[VoiceService] pip install for group '${group.name}' terminated unexpectedly without an exit code`);
        } else {
          log.error(`[VoiceService] pip install for group '${group.name}' failed with code:`, code);
        }
        resolve(false);
      });

      pipProcess.on('error', (err) => {
        log.error(`[VoiceService] Failed to spawn pip for group '${group.name}':`, err);
        resolve(false);
      });
    });

  const failedGroups: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const ok = await installGroup(groups[i]);
    if (ok) continue;
    if (pipAbortRequested) {
      // Intentional cancel — do not start the remaining groups.
      return false;
    }
    failedGroups.push(groups[i].name);
    if (i === 0) {
      // The first group (voice / voice-windows) is essential — abort.
      return false;
    }
  }

  if (failedGroups.length > 0) {
    // Non-essential groups failed: keep going, but surface which ones.
    onProgress({
      sttDownloaded: false,
      ttsDownloaded: false,
      vadDownloaded: true,
      downloading: true,
      progress: 0.5,
      statusMessage: `Some voice packages failed to install: ${failedGroups.join(', ')}`,
      sttModelName: DEFAULT_STT_MODEL_NAME,
      ttsModelName: 'Kokoro-82M',
    });
  }
  return true;
}

// ============================================================================
// WebSocket Session State
// ============================================================================

let activeWs: WebSocket | null = null;
let activeSession = false;
let activeSender: Electron.WebContents | null = null;

const MAX_QUEUED_AUDIO_CHUNKS = 256;
let pendingAudioChunks: Float32Array[] = [];
let pendingTokenCleanup: (() => void) | null = null;
let sessionGeneration = 0;

// ============================================================================
// TTS Abort
// ============================================================================

let ttsAbortController: AbortController | null = null;
let activeTtsWs: WebSocket | null = null;
let activeSystemTtsProcess: ChildProcess | null = null;

interface TtsRequestOwner {
  sender: Electron.WebContents;
  identity?: VoiceTtsRequestIdentity;
  controller: AbortController;
  completed?: boolean;
  removeDestroyedListener?: () => void;
}

let activeTtsRequest: TtsRequestOwner | null = null;

function ownsTtsRequest(owner: TtsRequestOwner): boolean {
  return activeTtsRequest === owner && !owner.completed && !owner.controller.signal.aborted && !owner.sender.isDestroyed();
}

function sendOwnedTts(owner: TtsRequestOwner, channel: string, payload: object): void {
  if (!ownsTtsRequest(owner)) return;
  if (channel === IPC_CHANNELS.VOICE_TTS_STATUS && 'generating' in payload && payload.generating === false) {
    owner.completed = true;
    log.info('[VoiceService] TTS request finished', { ...owner.identity, failed: 'error' in payload });
  }
  owner.sender.send(channel, { ...payload, ...owner.identity });
}

function normalizeTtsRequest(value: unknown): VoiceTtsRequestIdentity | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid TTS request identity');
  const request = value as Record<string, unknown>;
  const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256;
  if (!validId(request.sessionId) || !validId(request.requestId)
    || (request.utteranceId !== undefined && !validId(request.utteranceId))
    || (request.actorId !== undefined && !validId(request.actorId))) throw new Error('Invalid TTS request identity');
  return { sessionId: request.sessionId, requestId: request.requestId,
    ...(request.utteranceId !== undefined ? { utteranceId: request.utteranceId } : {}),
    ...(request.actorId !== undefined ? { actorId: request.actorId } : {}) };
}

function getLanguageTtsRuntime(language: string) {
  return loadLangData()[language]?.runtime?.tts ?? {};
}

function stopSystemTTS(): void {
  if (activeSystemTtsProcess) {
    try {
      activeSystemTtsProcess.kill('SIGKILL');
    } catch (e) {
      log.error('[VoiceService] Failed to kill system TTS process:', e);
    }
    activeSystemTtsProcess = null;
  }
}

// ============================================================================
// Model Status Check
// ============================================================================

type VoiceDevice = 'cuda' | 'mps' | 'cpu';

/**
 * VoiceModelStatus as relayed over IPC. `device` comes straight from the
 * shared type (backend-reported inference device); `cpuWarning` is derived
 * locally when the TTS backend reports device 'cpu' and is intentionally
 * not part of the shared VoiceModelStatus type.
 */
interface VoiceModelStatusPayload extends VoiceModelStatus {
  cpuWarning?: boolean;
}

function parseBackendDevice(value: unknown): VoiceDevice | undefined {
  return value === 'cuda' || value === 'mps' || value === 'cpu' ? value : undefined;
}

interface VoiceDeviceHints {
  device?: VoiceDevice;
  cpuWarning?: boolean;
}

/**
 * Single source of truth for device hints relayed to the renderer: `device`
 * is the display device (TTS wins, STT fallback), `cpuWarning` fires when
 * either model runs on cpu - STT is the time-critical stage of the realtime
 * voice agent and must not be masked by a GPU TTS.
 */
function deriveDeviceHints(
  sttRes: Record<string, unknown> | null,
  ttsRes: Record<string, unknown> | null,
): VoiceDeviceHints {
  const ttsDevice = ttsRes ? parseBackendDevice(ttsRes.device) : undefined;
  const sttDevice = sttRes ? parseBackendDevice(sttRes.device) : undefined;
  const hints: VoiceDeviceHints = {};
  const device = ttsDevice ?? sttDevice;
  if (device) {
    hints.device = device;
  }
  if (ttsDevice === 'cpu' || sttDevice === 'cpu') {
    hints.cpuWarning = true;
  }
  return hints;
}

async function checkModelStatus(language: string): Promise<VoiceModelStatusPayload> {
  const status: VoiceModelStatusPayload = {
    sttDownloaded: false,
    ttsDownloaded: false,
    vadDownloaded: true, // VAD is loaded via torch.hub, always "available" if voice deps installed
    downloading: false,
    progress: 0,
    sttModelName: '',
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
    const backendSttModel = typeof sttRes.modelName === 'string' ? sttRes.modelName : '';
    status.sttModelName = backendSttModel || DEFAULT_STT_MODEL_NAME;
    const backendSttEngine = typeof sttRes.engine === 'string' ? sttRes.engine : '';
    if (backendSttEngine) {
      status.sttEngine = backendSttEngine;
    }
    const hints = deriveDeviceHints(sttRes, ttsRes);
    if (hints.device) {
      status.device = hints.device;
    }
    if (hints.cpuWarning) {
      status.cpuWarning = true;
    }
  } catch (err) {
    log.error("error", err);
    status.error = err instanceof Error ? err.message : String(err);
    status.sttModelName = DEFAULT_STT_MODEL_NAME;
  }

  return status;
}

async function isQwen3TtsEngine(language: string): Promise<boolean> {
  try {
    const ttsStatus = await fetchJson(withQuery(API_ENDPOINTS.voiceTtsStatus, { language }));
    const modelName = String(ttsStatus.modelName ?? '');
    return modelName.startsWith('Qwen3');
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
  ttsProvider?: string,
): void {
  log.info('[VoiceService] Starting voice session', { language, mode, silenceThreshold, ttsProvider });
  stopSession();

  const token = getQuitToken();
  if (!token) {
    sendSessionStatus(sender, {
      stage: 'backend',
      message: 'Waiting for local Python backend…',
      progress: 0.01,
    });
    waitForQuitTokenAndStart(language, mode, silenceThreshold, sender, ttsProvider);
    return;
  }

  doStartSession(language, mode, silenceThreshold, sender, token, ttsProvider);
}

function sendSessionStatus(
  sender: Electron.WebContents,
  status: {
    stage: 'starting' | 'backend' | 'websocket' | 'vad' | 'stt' | 'tts' | 'ready';
    message: string;
    progress: number;
    modelName?: string;
  },
): void {
  if (sender.isDestroyed()) return;
  log.info('[VoiceService] Voice session status', status);
  sender.send(IPC_CHANNELS.VOICE_SESSION_STATUS, status);
}

function waitForQuitTokenAndStart(
  language: string,
  mode: VoiceMode,
  silenceThreshold: number,
  sender: Electron.WebContents,
  ttsProvider?: string,
): void {
  pendingTokenCleanup?.();
  const generation = sessionGeneration;
  pendingTokenCleanup = onQuitTokenAvailable((token) => {
    if (generation !== sessionGeneration) return;
    sessionGeneration += 1;
    pendingTokenCleanup?.();
    pendingTokenCleanup = null;
    if (sender.isDestroyed()) return;
    doStartSession(language, mode, silenceThreshold, sender, token, ttsProvider);
  });
}

function doStartSession(
  language: string,
  mode: VoiceMode,
  silenceThreshold: number,
  sender: Electron.WebContents,
  token: string,
  ttsProvider?: string,
): void {
  const ttsProviderQuery = ttsProvider ? `&tts_provider=${encodeURIComponent(ttsProvider)}` : '';
  const wsUrl = `${API_ENDPOINTS.voiceStream}?language=${encodeURIComponent(language)}&silence=${silenceThreshold}&mode=${encodeURIComponent(mode)}${ttsProviderQuery}`;

  try {
    sendSessionStatus(sender, {
      stage: 'websocket',
      message: 'Opening local voice stream…',
      progress: 0.02,
    });
    const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}` } });
    activeWs = ws;
    activeSession = true;
    activeSender = sender;
    const ownsSession = () => activeWs === ws && activeSender === sender;
    const failSession = (error: string, closeSocket = true) => {
      if (!ownsSession()) return;
      // Detach before notifying or closing: neither a late callback nor an
      // intentional teardown may clear or send events to the next session.
      activeWs = null;
      activeSession = false;
      activeSender = null;
      pendingAudioChunks = [];
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, { error });
      if (closeSocket) {
        try { ws.close(); } catch (closeError) { log.warn('[VoiceService] Failed to close voice stream:', closeError); }
      }
    };

    ws.on('open', () => {
      if (!ownsSession() || sender.isDestroyed()) return;
      log.info('[VoiceService] WebSocket connected to Python backend');
      if (activeSender && !activeSender.isDestroyed()) {
        sendSessionStatus(activeSender, {
          stage: 'websocket',
          message: 'Connected to local voice stream…',
          progress: 0.03,
        });
      }
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
      if (!ownsSession() || !activeSender || activeSender.isDestroyed()) return;
      try {
        const msg = JSON.parse(rawData.toString());
        switch (msg.type) {
          case 'ready':
            log.info('[VoiceService] Voice session ready');
            activeSender.send(IPC_CHANNELS.VOICE_SESSION_READY, { ready: true });
            break;
          case 'loading':
            sendSessionStatus(activeSender, {
              stage: msg.stage,
              message: msg.message,
              progress: msg.progress,
              modelName: msg.modelName,
            });
            break;
          case 'vad': {
            const vadEvent: VoiceVadEvent = {
              type: normalizeVadEventType(msg.event),
              reason: typeof msg.reason === 'string' ? msg.reason : undefined,
              speechProb: optionalNumber(msg.speechProb),
              threshold: optionalNumber(msg.threshold),
              silenceSeconds: optionalNumber(msg.silenceSeconds),
              silenceThreshold: optionalNumber(msg.silenceThreshold),
              speechSeconds: optionalNumber(msg.speechSeconds),
              chunkSeconds: optionalNumber(msg.chunkSeconds),
            };
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
            failSession(typeof msg.message === 'string' ? msg.message : 'Voice stream reported an error');
            break;
        }
      } catch (e) {
        log.error('[VoiceService] Failed to parse WS message:', e);
      }
    });

    ws.on('error', (err) => {
      if (!ownsSession()) return;
      log.error('[VoiceService] WebSocket error:', err);
      failSession(err.message || 'WebSocket connection error');
    });

    ws.on('close', () => {
      if (!ownsSession()) return;
      log.info('[VoiceService] WebSocket closed');
      failSession('Voice stream disconnected', false);
    });
  } catch (err) {
    log.error('[VoiceService] Failed to connect:', err);
    sender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function stopSession(): void {
  sessionGeneration += 1;
  activeSession = false;
  activeSender = null;
  pendingAudioChunks = [];
  pendingTokenCleanup?.();
  pendingTokenCleanup = null;
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

function sendTtsState(active: boolean): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
  try {
    activeWs.send(JSON.stringify({ type: 'tts_state', active }));
  } catch (e) {
    log.error('[VoiceService] Failed to send TTS state:', e);
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
  request?: VoiceTtsRequestIdentity,
): Promise<void> {
  const identity = normalizeTtsRequest(request);
  if (sender.isDestroyed()) return;
  if (activeTtsRequest) sendOwnedTts(activeTtsRequest, IPC_CHANNELS.VOICE_TTS_STATUS, {
    generating: false, playing: false, error: 'Speech stopped because another speech request started.',
  });
  stopTTS();
  const abortController = new AbortController();
  const owner: TtsRequestOwner = { sender, identity, controller: abortController };
  activeTtsRequest = owner;
  ttsAbortController = abortController;
  const onDestroyed = () => { if (activeTtsRequest === owner) stopTTS(); };
  sender.once('destroyed', onDestroyed);
  owner.removeDestroyedListener = () => sender.removeListener('destroyed', onDestroyed);
  // Sanitize consecutive dots to prevent TTS backend failures
  const sanitizedText = limitConsecutiveDots(stripBracketedTtsAnnotations(text));
  log.info('[VoiceService] TTS generate requested', {
    ...identity,
    provider,
    language,
    chars: sanitizedText.length,
    hasVoiceSample: Boolean(voiceSampleId),
  });
  if (!sanitizedText) {
    sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
    return;
  }

  if (provider === 'system') {
    await generateSystemTTS(sanitizedText, language, owner);
    return;
  }

  if (provider === 'cloud') {
    sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false,
      error: 'Cloud realtime TTS is temporarily disabled. Choose a local TTS provider.',
    });
    return;
  }

  // Check if TTS model is loaded — if not, signal that model loading is in progress
  let modelLoading = false;
  let deviceHints: VoiceDeviceHints = {};
  try {
    const [sttStatus, ttsStatus] = await Promise.all([
      fetchJson(API_ENDPOINTS.voiceSttStatus),
      fetchJson(withQuery(API_ENDPOINTS.voiceTtsStatus, { language })),
    ]);
    modelLoading = !(ttsStatus.loaded as boolean);
    deviceHints = deriveDeviceHints(sttStatus, ttsStatus);
  } catch (e) {
    log.error("error", e);
    // If status checks fail, proceed without the hints
  }
  if (!ownsTtsRequest(owner)) return;

  sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, {
    generating: true,
    playing: false,
    modelLoading,
    ...(deviceHints.device ? { device: deviceHints.device } : {}),
    ...(deviceHints.cpuWarning ? { cpuWarning: true } : {}),
  });

  // Poll model loading progress while waiting for the TTS response
  let progressPollTimer: ReturnType<typeof setInterval> | null = null;
  if (modelLoading) {
    progressPollTimer = setInterval(async () => {
      if (!ownsTtsRequest(owner)) {
        if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
        return;
      }
      try {
        const [sttStatus, s] = await Promise.all([
          fetchJson(API_ENDPOINTS.voiceSttStatus),
          fetchJson(withQuery(API_ENDPOINTS.voiceTtsStatus, { language })),
        ]);
        const hints = deriveDeviceHints(sttStatus, s);
        sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, {
          generating: true,
          playing: false,
          modelLoading: !(s.loaded as boolean) || ((s.downloading as boolean) ?? false),
          downloadProgress: s.progress as number ?? 0,
          ...(hints.device ? { device: hints.device } : {}),
          ...(hints.cpuWarning ? { cpuWarning: true } : {}),
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
          await ensureVoiceSampleTranscript(sample, samples, language, false, abortController.signal);
        }
        voiceSamplePath = getVoiceSamplePath(sample);
      }
    }
    if (!ownsTtsRequest(owner)) throw new Error('TTS request cancelled');

    const body: Record<string, unknown> = {
      text: sanitizedText,
      language,
      speed,
      provider: requestedProvider,
    };
    if (voiceSamplePath) {
      body.voiceSamplePath = voiceSamplePath;
    }

    await streamLocalTTS(body, owner);
  } catch (err) {
    if (!abortController.signal.aborted) {
      log.error('[VoiceService] TTS generation error:', err);
      sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, {
        generating: false,
        playing: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
  if (ttsAbortController === abortController) {
    ttsAbortController = null;
  }
  sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
}

function generateSystemTTS(
  text: string,
  language: string,
  owner: TtsRequestOwner,
): Promise<void> {
  stopSystemTTS();

  const sanitized = text.replace(/\n/g, ' ').trim().substring(0, 500);
  if (!sanitized) {
    sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
    return Promise.resolve();
  }

  const runtime = getLanguageTtsRuntime(language);
  let commandChain: string[];
  let args: string[];
  if (isMac) {
    commandChain = ['say'];
    args = runtime.macosVoice ? ['-v', runtime.macosVoice, sanitized] : [sanitized];
  } else if (isLinux) {
    // Probe espeak-ng first; older distros only ship the legacy espeak binary.
    commandChain = ['espeak-ng', 'espeak'];
    args = ['-v', runtime.espeakVoice || language, sanitized];
  } else {
    commandChain = ['powershell'];
    const voice = runtime.windowsVoice;
    const voiceCommand = typeof voice === 'string' && voice.trim()
      ? `$s.SelectVoice('${voice.replace(/'/g, "''")}'); `
      : '';
    args = [
      '-Command',
      `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voiceCommand}$s.Speak('${sanitized.replace(/'/g, "''")}')`,
    ];
  }

  sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, { generating: true, playing: true });

  return new Promise((resolve) => {
    const speakWith = (index: number): void => {
      if (!ownsTtsRequest(owner)) { resolve(); return; }
      const command = commandChain[index];
      const child = execFile(command, args, (err) => {
        if (!ownsTtsRequest(owner)) { resolve(); return; }
        if (activeSystemTtsProcess === child) {
          activeSystemTtsProcess = null;
        }
        const missing = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
        if (missing && index + 1 < commandChain.length) {
          log.warn(`[VoiceService] '${command}' not found, falling back to '${commandChain[index + 1]}'`);
          speakWith(index + 1);
          return;
        }
        if (missing && commandChain.length > 1) {
          // Exhausted the system TTS probe chain (Linux) — surface the failure
          // instead of silently resolving.
          sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, {
            generating: false,
            playing: false,
            error: 'System TTS unavailable: no espeak-ng or espeak binary found. Install espeak-ng to enable system text-to-speech.',
          });
          resolve();
          return;
        }
        sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false,
          ...(err ? { error: err.message || 'System speech failed' } : {}),
        });
        resolve();
      });
      activeSystemTtsProcess = child;
    };
    speakWith(0);
  });
}

function streamLocalTTS(
  body: Record<string, unknown>,
  owner: TtsRequestOwner,
): Promise<void> {
  const signal = owner.controller.signal;
  return new Promise((resolve, reject) => {
    const token = getQuitToken();
    const ws = new WebSocket(API_ENDPOINTS.voiceTtsStream, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    activeTtsWs = ws;
    let streamCompleted = false;
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
      sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_AUDIO, audio);
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
      if (!ownsTtsRequest(owner)) {
        ws.close();
        return;
      }
      log.info('[VoiceService] Local TTS stream opened', {
        provider: body.provider,
        language: body.language,
        chars: typeof body.text === 'string' ? body.text.length : undefined,
        hasVoiceSample: Boolean(body.voiceSamplePath),
      });
      ws.send(JSON.stringify(body));
    });

    ws.on('message', (rawData: WebSocket.RawData, isBinary: boolean) => {
      if (!ownsTtsRequest(owner)) return;
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
            log.info('[VoiceService] Local TTS audio chunk received', {
              sampleRate: pendingAudioMeta.sampleRate,
              samples: samples.length,
              sentenceIndex: pendingAudioMeta.sentenceIndex,
            });
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
            log.info('[VoiceService] Local TTS status', msg);
            sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, {
              generating: msg.generating !== false,
              playing: false,
              modelLoading: msg.modelLoading,
              downloadProgress: msg.downloadProgress,
            });
            break;
          case 'done':
            streamCompleted = true;
            log.info('[VoiceService] Local TTS stream done');
            ws.close();
            break;
          case 'error':
            log.error('[VoiceService] Local TTS stream error:', msg.message);
            sendOwnedTts(owner, IPC_CHANNELS.VOICE_TTS_STATUS, {
              generating: false,
              playing: false,
              error: String(msg.message || 'TTS stream error'),
            });
            reject(new Error(String(msg.message || 'TTS stream error')));
            ws.close();
            break;
        }
      } catch (e) {
        log.error('[VoiceService] Failed to parse TTS stream message:', e);
      }
    });

	    ws.on('error', (error) => {
	      log.error('[VoiceService] Local TTS websocket error:', error);
	      reject(error);
	    });
	    ws.on('close', () => {
	      log.info('[VoiceService] Local TTS websocket closed', { aborted: signal.aborted });
	      signal.removeEventListener('abort', abortStream);
      if (activeTtsWs === ws) {
        activeTtsWs = null;
      }
      if (streamCompleted || signal.aborted || owner.completed) resolve();
      else reject(new Error('Speech stream disconnected before generation completed'));
    });
  });
}

function stopTTS(): void {
  const owner = activeTtsRequest;
  activeTtsRequest = null;
  owner?.removeDestroyedListener?.();
  stopSystemTTS();
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
        sttModelName: DEFAULT_STT_MODEL_NAME,
        ttsModelName: 'Kokoro-82M',
      });

      // Step 1: Check if voice packages are installed
      const initialStatus = await checkModelStatus(language);
      const needsPackageInstall = !initialStatus.sttDownloaded || !initialStatus.ttsDownloaded;
      const includeQwen3 = !initialStatus.ttsDownloaded && await isQwen3TtsEngine(language);
      const includeMlxStt = isAppleSilicon;

      if (needsPackageInstall) {
        // Install voice pip packages first
        const pipSuccess = await installVoicePackages(emitProgress, includeQwen3, includeMlxStt);
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
        sttModelName: initialStatus.sttModelName || DEFAULT_STT_MODEL_NAME,
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
    (event, language: string, mode: VoiceMode, silenceThreshold?: number, ttsProvider?: string) => {
      startSession(language, mode, silenceThreshold ?? DEFAULT_VOICE_SILENCE_THRESHOLD, event.sender, ttsProvider);
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

  // Notify backend when local TTS playback is active so VAD can adapt.
  ipcMain.on(IPC_CHANNELS.VOICE_TTS_STATE, (_event, active: boolean) => {
    if (activeSession) {
      sendTtsState(active);
    }
  });

  // TTS generation request
  ipcMain.on(
    IPC_CHANNELS.VOICE_TTS_GENERATE,
    (event, text: string, language: string, speed?: number, voiceSampleId?: string, provider?: string, _cloudAuthToken?: string, request?: VoiceTtsRequestIdentity) => {
      generateTTS(text, language, speed ?? 1.0, voiceSampleId, event.sender, provider, request).catch((err) => {
        log.error('[VoiceService] TTS error:', err);
      });
    },
  );

  // TTS stop
  ipcMain.on(IPC_CHANNELS.VOICE_TTS_STOP, (event, scope?: VoiceTtsStopScope) => {
    const owner = activeTtsRequest;
    if (owner && (owner.sender !== event.sender || (scope && (owner.identity?.sessionId !== scope.sessionId
      || (scope.requestId !== undefined && owner.identity?.requestId !== scope.requestId))))) return;
    if (!owner && scope) return;
    const identity = owner?.identity;
    log.info('[VoiceService] TTS request stopped', { ...identity });
    stopTTS();
    if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false, ...identity });
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
