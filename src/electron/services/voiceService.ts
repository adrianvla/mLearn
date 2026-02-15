/**
 * Voice Service — relays audio between renderer IPC and Python backend
 * for STT (faster-whisper), TTS (Chatterbox), and VAD (Silero).
 *
 * All speech models run in the Python backend (server.py).
 * Audio streams from renderer via IPC → this service → Python WebSocket.
 * TTS is requested via HTTP POST, audio returned and forwarded to renderer.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { IPC_CHANNELS, API_ENDPOINTS } from '../../shared/constants';
import type {
  VoiceModelStatus,
  VoiceSTTResult,
  VoiceVadEvent,
  VoiceMode,
  VoiceSample,
  VoiceTtsAudio,
} from '../../shared/types';
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

function loadSamplesManifest(): VoiceSample[] {
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

function getVoiceSamplePath(sample: VoiceSample): string {
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
          resolve({ data: Buffer.concat(chunks), headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
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
    ttsModelName: 'Chatterbox-Multilingual',
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
      if (!activeSender) return;
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

// ============================================================================
// TTS Generation via Python Backend
// ============================================================================

async function generateTTS(
  text: string,
  language: string,
  speed: number,
  voiceSampleId: string | undefined,
  sender: Electron.WebContents,
): Promise<void> {
  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: true, playing: false });

  ttsAbortController = new AbortController();

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
        sttModelName: 'openai/whisper-small',
        ttsModelName: 'Chatterbox-Multilingual',
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

  // TTS generation request
  ipcMain.on(
    IPC_CHANNELS.VOICE_TTS_GENERATE,
    (event, text: string, language: string, speed?: number, voiceSampleId?: string) => {
      generateTTS(text, language, speed ?? 1.0, voiceSampleId, event.sender).catch((err) => {
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
    return loadSamplesManifest();
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
}
