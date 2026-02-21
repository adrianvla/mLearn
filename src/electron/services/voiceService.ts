/**
 * Voice Service — relays audio between renderer IPC and Python backend
 * for STT (faster-whisper), TTS (Kokoro / Qwen3-TTS / Remote), and VAD (Silero).
 *
 * All speech models run in the Python backend (server.py).
 * Audio streams from renderer via IPC → this service → Python WebSocket.
 * TTS is requested via HTTP POST, audio returned and forwarded to renderer.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { spawn } from 'child_process';
import { IPC_CHANNELS, API_ENDPOINTS } from '../../shared/constants';
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
  getAppPath,
  getResourcePath,
  getPipExecutablePath,
  getPythonExecutablePath,
  isWindows,
} from '../utils/platform';
import WebSocket from 'ws';

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
  } catch {
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
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
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
  const appPath = getAppPath();
  const configPath = path.join(appPath, 'pip_requirements.json');
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    const config: PipRequirementsConfig = JSON.parse(data);
    return config.voice ?? [];
  } catch {
    // Fallback: try resource path (development mode)
    const resPath = getResourcePath();
    const fallbackPath = path.join(resPath, 'pip_requirements.json');
    try {
      const data = fs.readFileSync(fallbackPath, 'utf-8');
      const config: PipRequirementsConfig = JSON.parse(data);
      return config.voice ?? [];
    } catch {
      return [];
    }
  }
}

function loadQwen3Packages(): string[] {
  const appPath = getAppPath();
  const configPath = path.join(appPath, 'pip_requirements.json');
  try {
    const data = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(data) as Record<string, string[]>;
    return config['qwen3-tts'] ?? [];
  } catch {
    const resPath = getResourcePath();
    const fallbackPath = path.join(resPath, 'pip_requirements.json');
    try {
      const data = fs.readFileSync(fallbackPath, 'utf-8');
      const config = JSON.parse(data) as Record<string, string[]>;
      return config['qwen3-tts'] ?? [];
    } catch {
      return [];
    }
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

    console.log('[VoiceService] Installing voice packages:', packages.join(', '));

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
      console.log('[VoiceService] pip:', text);
      outputBuffer += text;
      const lines = outputBuffer.split(/\r?\n/);
      outputBuffer = lines.pop() || '';
      for (const line of lines) processLine(line);
    });

    pipProcess.stderr.on('data', (data: Buffer) => {
      console.error('[VoiceService] pip error:', data.toString());
    });

    pipProcess.on('close', (code) => {
      if (outputBuffer.trim()) processLine(outputBuffer);
      if (code === 0 || code === null) {
        console.log('[VoiceService] Voice packages installed successfully');
        resolve(true);
      } else {
        console.error('[VoiceService] pip install failed with code:', code);
        resolve(false);
      }
    });

    pipProcess.on('error', (err) => {
      console.error('[VoiceService] Failed to spawn pip:', err);
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
    status.error = err instanceof Error ? err.message : String(err);
  }

  return status;
}

// ============================================================================
// WebSocket Session Management
// ============================================================================

function startSession(
  language: string,
  _mode: VoiceMode,
  silenceThreshold: number,
  sender: Electron.WebContents,
): void {
  if (activeWs) {
    stopSession();
  }

  const wsUrl = `${API_ENDPOINTS.voiceStream}?language=${encodeURIComponent(language)}&silence=${silenceThreshold}`;

  try {
    const ws = new WebSocket(wsUrl);
    activeWs = ws;
    activeSession = true;
    activeSender = sender;

    ws.on('open', () => {
      console.log('[VoiceService] WebSocket connected to Python backend');
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
            console.error('[VoiceService] Backend error:', msg.message);
            activeSender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
              error: msg.message,
            });
            break;
        }
      } catch (e) {
        console.error('[VoiceService] Failed to parse WS message:', e);
      }
    });

    ws.on('error', (err) => {
      console.error('[VoiceService] WebSocket error:', err);
      if (activeSender) {
        activeSender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
          error: err.message || 'WebSocket connection error',
        });
      }
    });

    ws.on('close', () => {
      console.log('[VoiceService] WebSocket closed');
      if (activeWs === ws) {
        activeWs = null;
        activeSession = false;
      }
    });
  } catch (err) {
    console.error('[VoiceService] Failed to connect:', err);
    sender.send(IPC_CHANNELS.VOICE_SESSION_ERROR, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function stopSession(): void {
  activeSession = false;
  activeSender = null;
  if (activeWs) {
    try { activeWs.close(); } catch { /* ignore */ }
    activeWs = null;
  }
}

function sendAudioChunk(samples: Float32Array): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
  try {
    activeWs.send(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  } catch (e) {
    console.error('[VoiceService] Failed to send audio chunk:', e);
  }
}

function sendFlush(): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
  try {
    activeWs.send(JSON.stringify({ type: 'flush' }));
  } catch (e) {
    console.error('[VoiceService] Failed to send flush command:', e);
  }
}

function sendSilenceThresholdUpdate(threshold: number): void {
  if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;
  try {
    activeWs.send(JSON.stringify({ type: 'silence_threshold', value: threshold }));
  } catch (e) {
    console.error('[VoiceService] Failed to send silence threshold update:', e);
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
  ttsAbortController = new AbortController();

  // Check if TTS model is loaded — if not, signal that model loading is in progress
  let modelLoading = false;
  try {
    const ttsStatus = await fetchJson(API_ENDPOINTS.voiceTtsStatus);
    modelLoading = !(ttsStatus.loaded as boolean);
  } catch {
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
      } catch { /* ignore */ }
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

    const body: Record<string, unknown> = { text, language, speed };
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
      try { boundaries = JSON.parse(boundariesHeader as string); } catch { /* ignore */ }
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
      console.error('[VoiceService] TTS generation error:', err);
    }
  }

  if (progressPollTimer) { clearInterval(progressPollTimer); progressPollTimer = null; }
  ttsAbortController = null;
  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
}

function stopTTS(): void {
  if (ttsAbortController) {
    ttsAbortController.abort();
    ttsAbortController = null;
  }
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function setupVoiceIPC(): void {
  // Model status
  ipcMain.handle(IPC_CHANNELS.VOICE_MODEL_STATUS, async (_event, language: string) => {
    const status = await checkModelStatus(language);
    console.log('[VoiceService] Model status for', language, ':', JSON.stringify(status));
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
      console.error('[VoiceService] Model download failed:', err);
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
    (event, text: string, language: string, speed?: number, voiceSampleId?: string, provider?: string) => {
      generateTTS(text, language, speed ?? 1.0, voiceSampleId, event.sender, provider).catch((err) => {
        console.error('[VoiceService] TTS error:', err);
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
