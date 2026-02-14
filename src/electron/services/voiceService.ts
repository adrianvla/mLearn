/**
 * Voice Service — manages sherpa-onnx STT, TTS, and VAD engines
 * for the voice call mode in the Conversation Agent.
 *
 * All engines run in the main process. Audio is streamed from the
 * renderer via IPC as Float32Array PCM chunks at 16 kHz mono.
 */

import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '../../shared/constants';
import { downloadFileWithProgress } from '../utils/downloadManager';
import { getSTTModel, getTTSModel, VAD_MODEL } from '../../shared/voiceModels';
import type { VoiceModelStatus, VoiceSTTResult, VoiceVadEvent, VoiceMode } from '../../shared/types';

// sherpa-onnx-node is a CJS native addon — require it dynamically to
// avoid issues if the binary isn't available at build time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sherpaOnnx: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireSherpa(): any {
  if (!sherpaOnnx) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sherpaOnnx = require('sherpa-onnx-node');
  }
  return sherpaOnnx;
}

// ============================================================================
// Paths
// ============================================================================

const VOICE_MODELS_DIR = 'voice-models';

function getVoiceModelsDir(): string {
  return path.join(app.getPath('userData'), VOICE_MODELS_DIR);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Download State
// ============================================================================

let isDownloading = false;
let downloadProgress = 0;

function getModelStatus(language: string): VoiceModelStatus {
  return {
    sttDownloaded: isSTTDownloaded(language),
    ttsDownloaded: isTTSDownloaded(language),
    vadDownloaded: isVADDownloaded(),
    downloading: isDownloading,
    progress: downloadProgress,
  };
}

// ============================================================================
// Model Availability Checks
// ============================================================================

function isVADDownloaded(): boolean {
  const p = path.join(getVoiceModelsDir(), VAD_MODEL.filename);
  return fs.existsSync(p);
}

function isSTTDownloaded(language: string): boolean {
  const model = getSTTModel(language);
  const dir = path.join(getVoiceModelsDir(), model.dirName);
  if (!fs.existsSync(dir)) return false;
  const tokensPath = path.join(dir, model.files.tokens);
  return fs.existsSync(tokensPath);
}

function isTTSDownloaded(language: string): boolean {
  const model = getTTSModel(language);
  const dir = path.join(getVoiceModelsDir(), model.dirName);
  if (!fs.existsSync(dir)) return false;
  const modelPath = path.join(dir, model.files.model);
  return fs.existsSync(modelPath);
}

// ============================================================================
// Model Download
// ============================================================================

async function downloadModels(
  language: string,
  sender: Electron.WebContents
): Promise<void> {
  if (isDownloading) throw new Error('Download already in progress');

  isDownloading = true;
  downloadProgress = 0;
  const baseDir = getVoiceModelsDir();
  ensureDir(baseDir);

  const emitStatus = () => {
    sender.send(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD_PROGRESS, getModelStatus(language));
  };

  try {
    const steps: Array<{ url: string; dest: string }> = [];

    // VAD
    if (!isVADDownloaded()) {
      steps.push({
        url: VAD_MODEL.url,
        dest: path.join(baseDir, VAD_MODEL.filename),
      });
    }

    // STT
    if (!isSTTDownloaded(language)) {
      const stt = getSTTModel(language);
      if (stt.isArchive) {
        // Download archive then extract
        const archiveDest = path.join(baseDir, path.basename(stt.url));
        steps.push({ url: stt.url, dest: archiveDest });
      }
    }

    // TTS
    if (!isTTSDownloaded(language)) {
      const tts = getTTSModel(language);
      if (tts.isArchive) {
        const archiveDest = path.join(baseDir, path.basename(tts.url));
        // Avoid duplicate if STT and TTS use the same archive
        if (!steps.some(s => s.dest === archiveDest)) {
          steps.push({ url: tts.url, dest: archiveDest });
        }
      }
    }

    const totalSteps = steps.length;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await downloadFileWithProgress(step.url, step.dest, (p) => {
        downloadProgress = (i + p.progress) / totalSteps;
        emitStatus();
      });

      // Extract tar.bz2 archives using system tar (npm tar doesn't support bzip2)
      if (step.dest.endsWith('.tar.bz2')) {
        try {
          const { execFileSync } = require('child_process') as typeof import('child_process');
          execFileSync('tar', ['xjf', step.dest, '-C', baseDir]);
          fs.unlinkSync(step.dest);
        } catch (err) {
          console.error('Failed to extract archive:', err);
        }
      } else if (step.dest.endsWith('.tar.gz') || step.dest.endsWith('.tgz')) {
        try {
          const tar = require('tar') as typeof import('tar');
          await tar.extract({ file: step.dest, cwd: baseDir });
          fs.unlinkSync(step.dest);
        } catch (err) {
          console.error('Failed to extract archive:', err);
        }
      }
    }

    isDownloading = false;
    downloadProgress = 1;
    emitStatus();
  } catch (err) {
    isDownloading = false;
    const status = getModelStatus(language);
    status.error = err instanceof Error ? err.message : String(err);
    sender.send(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD_PROGRESS, status);
    throw err;
  }
}

// ============================================================================
// Engine State
// ============================================================================

// Use `any` for sherpa-onnx instance types since their constructors vary
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognizer: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognizerStream: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vad: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tts: any = null;

let activeSession = false;
let activeSender: Electron.WebContents | null = null;
let speechDetected = false;

// VAD circular buffer for feeding samples in window-sized chunks
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let vadBuffer: any = null;

// ============================================================================
// Engine Initialization
// ============================================================================

function initSTT(language: string): void {
  if (recognizer) return;

  const sherpa = requireSherpa();
  const model = getSTTModel(language);
  const baseDir = path.join(getVoiceModelsDir(), model.dirName);

  const config = {
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      transducer: {
        encoder: path.join(baseDir, model.files.encoder),
        decoder: path.join(baseDir, model.files.decoder),
        joiner: path.join(baseDir, model.files.joiner),
      },
      tokens: path.join(baseDir, model.files.tokens),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20,
  };

  recognizer = new sherpa.OnlineRecognizer(config);
  recognizerStream = recognizer.createStream();
}

function initVAD(): void {
  if (vad) return;

  const sherpa = requireSherpa();
  const vadModelPath = path.join(getVoiceModelsDir(), VAD_MODEL.filename);

  const config = {
    sileroVad: {
      model: vadModelPath,
      threshold: 0.5,
      minSilenceDuration: 0.25,
      minSpeechDuration: 0.25,
      windowSize: 512,
    },
    sampleRate: 16000,
    debug: 0,
    numThreads: 1,
  };

  vad = new sherpa.Vad(config, 30); // 30 second buffer
  vadBuffer = new sherpa.CircularBuffer(30 * 16000);
}

function initTTS(language: string): void {
  if (tts) return;

  const sherpa = requireSherpa();
  const model = getTTSModel(language);
  const baseDir = path.join(getVoiceModelsDir(), model.dirName);

  const config: Record<string, unknown> = {
    model: {
      kokoro: model.type === 'kokoro' ? {
        model: path.join(baseDir, model.files.model),
        voices: model.files.voices ? path.join(baseDir, model.files.voices) : '',
        tokens: path.join(baseDir, model.files.tokens),
        dataDir: model.files.dataDir ? path.join(baseDir, model.files.dataDir) : '',
        lang: model.kokoroLang || language,
        lengthScale: 1.0,
      } : undefined,
      vits: model.type === 'vits' ? {
        model: path.join(baseDir, model.files.model),
        tokens: path.join(baseDir, model.files.tokens),
        lexicon: model.files.lexicon ? path.join(baseDir, model.files.lexicon) : '',
        dataDir: model.files.dataDir ? path.join(baseDir, model.files.dataDir) : '',
        lengthScale: 1.0,
      } : undefined,
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    },
    maxNumSentences: 1,
  };

  tts = new sherpa.OfflineTts(config);
}

function destroyEngines(): void {
  if (recognizerStream) {
    try { recognizerStream.free(); } catch { /* ignore */ }
    recognizerStream = null;
  }
  if (recognizer) {
    try { recognizer.free(); } catch { /* ignore */ }
    recognizer = null;
  }
  if (vad) {
    try { vad.free(); } catch { /* ignore */ }
    vad = null;
  }
  if (vadBuffer) {
    try { vadBuffer.free(); } catch { /* ignore */ }
    vadBuffer = null;
  }
  if (tts) {
    try { tts.free(); } catch { /* ignore */ }
    tts = null;
  }
}

// ============================================================================
// Audio Processing
// ============================================================================

function processAudioChunk(samples: Float32Array): void {
  if (!activeSession || !activeSender) return;

  const sender = activeSender;

  // Feed VAD
  if (vad) {
    vad.acceptWaveform(samples);

    // Check for speech segments
    while (!vad.isEmpty()) {
      const segment = vad.front();

      if (!speechDetected) {
        speechDetected = true;
        const vadEvent: VoiceVadEvent = { type: 'speech-start' };
        sender.send(IPC_CHANNELS.VOICE_VAD_EVENT, vadEvent);
      }

      // Feed the speech segment to STT
      if (recognizerStream && recognizer) {
        recognizerStream.acceptWaveform(16000, segment.samples);

        while (recognizer.isReady(recognizerStream)) {
          recognizer.decode(recognizerStream);
        }

        const text = recognizer.getResult(recognizerStream).text;
        const isEndpoint = recognizer.isEndpoint(recognizerStream);

        if (text) {
          const result: VoiceSTTResult = {
            text,
            isFinal: isEndpoint,
            isEndpoint,
          };
          sender.send(IPC_CHANNELS.VOICE_STT_RESULT, result);
        }

        if (isEndpoint) {
          recognizer.reset(recognizerStream);
          speechDetected = false;
          const vadEvent: VoiceVadEvent = { type: 'speech-end' };
          sender.send(IPC_CHANNELS.VOICE_VAD_EVENT, vadEvent);
        }
      }

      vad.pop();
    }
  }

  // Also feed STT directly for partial results even without VAD speech detection
  if (recognizerStream && recognizer && !vad) {
    recognizerStream.acceptWaveform(16000, samples);

    while (recognizer.isReady(recognizerStream)) {
      recognizer.decode(recognizerStream);
    }

    const text = recognizer.getResult(recognizerStream).text;
    const isEndpoint = recognizer.isEndpoint(recognizerStream);

    if (text) {
      const result: VoiceSTTResult = {
        text,
        isFinal: isEndpoint,
        isEndpoint,
      };
      sender.send(IPC_CHANNELS.VOICE_STT_RESULT, result);
    }

    if (isEndpoint) {
      recognizer.reset(recognizerStream);
    }
  }
}

// ============================================================================
// TTS Generation
// ============================================================================

function generateTTS(
  text: string,
  language: string,
  speed: number,
  sender: Electron.WebContents
): void {
  if (!tts) {
    initTTS(language);
  }

  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: true, playing: false });

  try {
    const model = getTTSModel(language);
    const result = tts.generate({
      text,
      sid: model.speakerId,
      speed: speed || 1.0,
    });

    if (result && result.samples) {
      sender.send(IPC_CHANNELS.VOICE_TTS_AUDIO, {
        samples: result.samples,
        sampleRate: result.sampleRate || tts.sampleRate || 22050,
      });
    }
  } catch (err) {
    console.error('TTS generation error:', err);
  }

  sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
}

// ============================================================================
// IPC Handlers
// ============================================================================

export function setupVoiceIPC(): void {
  // Check model status
  ipcMain.handle(IPC_CHANNELS.VOICE_MODEL_STATUS, (_event, language: string) => {
    const status = getModelStatus(language);
    console.log('[VoiceService] Model status for', language, ':', JSON.stringify(status));
    return status;
  });

  // Download models
  ipcMain.on(IPC_CHANNELS.VOICE_MODEL_DOWNLOAD, (event, language: string) => {
    downloadModels(language, event.sender).catch((err) => {
      console.error('Voice model download failed:', err);
    });
  });

  // Start voice session
  ipcMain.on(IPC_CHANNELS.VOICE_START_SESSION, (event, language: string, _mode: VoiceMode) => {
    if (activeSession) {
      // Stop existing session first
      destroyEngines();
    }

    activeSession = true;
    activeSender = event.sender;
    speechDetected = false;

    try {
      initVAD();
      initSTT(language);
      initTTS(language);
    } catch (err) {
      console.error('Failed to start voice session:', err);
      activeSession = false;
      activeSender = null;
    }
  });

  // Stop voice session
  ipcMain.on(IPC_CHANNELS.VOICE_STOP_SESSION, () => {
    activeSession = false;
    activeSender = null;
    speechDetected = false;
    destroyEngines();
  });

  // Receive audio chunk from renderer
  ipcMain.on(IPC_CHANNELS.VOICE_AUDIO_CHUNK, (_event, samples: Float32Array) => {
    if (activeSession) {
      processAudioChunk(samples);
    }
  });

  // TTS generation request
  ipcMain.on(IPC_CHANNELS.VOICE_TTS_GENERATE, (event, text: string, language: string, speed?: number) => {
    generateTTS(text, language, speed ?? 1.0, event.sender);
  });

  // TTS stop (renderer handles stopping playback; we just acknowledge)
  ipcMain.on(IPC_CHANNELS.VOICE_TTS_STOP, (event) => {
    event.sender.send(IPC_CHANNELS.VOICE_TTS_STATUS, { generating: false, playing: false });
  });
}
