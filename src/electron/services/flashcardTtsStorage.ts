/**
 * Flashcard TTS Storage Service
 * Manages .ogg audio files for flashcard word and example TTS.
 * Files stored in {userData}/flashcard-audio/{cardId}-{field}.ogg
 */

import fs from 'fs';
import path from 'path';
import { ipcMain, protocol, net } from 'electron';
import { IPC_CHANNELS, API_ENDPOINTS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';
import { loadSamplesManifest, getVoiceSamplePath } from './voiceService';
import http from 'http';

const SCHEME = 'flashcard-audio';

/** Get the directory for flashcard audio */
function getAudioDir(): string {
  return path.join(getUserDataPath(), 'flashcard-audio');
}

/** Ensure the audio directory exists */
function ensureAudioDir(): void {
  const dir = getAudioDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Build the filename for a card's audio */
function audioFilename(cardId: string, field: 'word' | 'example'): string {
  return `${cardId}-${field}.ogg`;
}

/** Build the metadata filename for a card's audio */
function metaFilename(cardId: string, field: 'word' | 'example'): string {
  return `${cardId}-${field}.meta.json`;
}

/** Get the full path for a card's audio file */
function audioPath(cardId: string, field: 'word' | 'example'): string {
  return path.join(getAudioDir(), audioFilename(cardId, field));
}

/** Get the full path for a card's metadata file */
function metaPath(cardId: string, field: 'word' | 'example'): string {
  return path.join(getAudioDir(), metaFilename(cardId, field));
}

/** Write TTS metadata alongside the audio file */
function writeMetadata(cardId: string, field: 'word' | 'example', provider: string, language: string): void {
  const meta = {
    provider,
    generatedAt: new Date().toISOString(),
    language,
  };
  try {
    fs.writeFileSync(metaPath(cardId, field), JSON.stringify(meta));
  } catch {
    // Non-critical — silently ignore
  }
}

/** Read TTS metadata for a card field */
function getFlashcardTtsMeta(cardId: string, field: 'word' | 'example'): { provider: string; generatedAt: string; language: string } | null {
  const mp = metaPath(cardId, field);
  if (!fs.existsSync(mp)) return null;
  try {
    return JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Check if a TTS audio file exists and return its file URL.
 */
function getFlashcardTts(cardId: string, field: 'word' | 'example'): string | null {
  const filePath = audioPath(cardId, field);
  if (fs.existsSync(filePath)) {
    return toAudioUrl(filePath);
  }
  return null;
}

/**
 * Generate TTS audio via the local Python backend (Kokoro or Qwen3) and save as .ogg.
 * The `provider` field is forwarded so the backend routes to the correct engine.
 */
async function generateViaLocal(text: string, language: string, outputPath: string, provider: string, voiceSamplePath?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(API_ENDPOINTS.voiceTts);
    const payload: Record<string, unknown> = { text, language, format: 'ogg', provider };
    if (voiceSamplePath) payload.voiceSamplePath = voiceSamplePath;
    const body = JSON.stringify(payload);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          if (data.length > 0) {
            ensureAudioDir();
            fs.writeFileSync(outputPath, data);
            resolve(true);
          } else {
            resolve(false);
          }
        });
        res.on('error', () => resolve(false));
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Generate TTS audio via a remote TTS server and save as .ogg.
 */
async function generateViaRemote(text: string, language: string, outputPath: string, remoteUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL('/tts', remoteUrl);
    const body = JSON.stringify({ text, language, format: 'ogg' });

    const protocol = url.protocol === 'https:' ? require('https') : http;
    const req = protocol.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 60000,
      },
      (res: http.IncomingMessage) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks);
          if (data.length > 0) {
            ensureAudioDir();
            fs.writeFileSync(outputPath, data);
            resolve(true);
          } else {
            resolve(false);
          }
        });
        res.on('error', () => resolve(false));
      },
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Generate TTS for a single card field.
 */
async function generateFlashcardTts(
  cardId: string,
  text: string,
  language: string,
  field: 'word' | 'example',
  provider: string,
  remoteUrl?: string,
  voiceSampleId?: string,
): Promise<string | null> {
  if (!text || text === '-') return null;

  const output = audioPath(cardId, field);
  let success = false;

  // Resolve voice sample path if provided
  let voiceSamplePath: string | undefined;
  if (voiceSampleId) {
    const samples = loadSamplesManifest();
    const sample = samples.find((s) => s.id === voiceSampleId);
    if (sample) voiceSamplePath = getVoiceSamplePath(sample);
  }

  if (provider === 'remote' && remoteUrl) {
    success = await generateViaRemote(text, language, output, remoteUrl);
  } else {
    success = await generateViaLocal(text, language, output, provider, voiceSamplePath);
  }

  if (success) {
    writeMetadata(cardId, field, provider, language);
    return toAudioUrl(output);
  }
  return null;
}

/**
 * Batch generate TTS for multiple cards.
 * If using remote provider, sends a batch request; otherwise generates sequentially.
 */
async function batchGenerateFlashcardTts(
  items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>,
  language: string,
  provider: string,
  remoteUrl?: string,
  voiceSampleId?: string,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  if (provider === 'remote' && remoteUrl) {
    // Try batch endpoint first
    const batchResult = await tryBatchRemote(items, language, remoteUrl);
    if (batchResult) return batchResult;
  }

  // Fallback: generate one by one
  for (const item of items) {
    const url = await generateFlashcardTts(item.cardId, item.text, language, item.field, provider, remoteUrl, voiceSampleId);
    if (url) {
      results[`${item.cardId}-${item.field}`] = url;
    }
  }

  return results;
}

/**
 * Try to use a batch TTS endpoint on the remote server.
 * The batch endpoint accepts an array of texts and returns named files.
 */
async function tryBatchRemote(
  items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>,
  language: string,
  remoteUrl: string,
): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const url = new URL('/tts/batch', remoteUrl);
    const batchItems = items.map((item) => ({
      id: `${item.cardId}-${item.field}`,
      text: item.text,
      language,
      format: 'ogg',
    }));
    const body = JSON.stringify({ items: batchItems });

    const protocol = url.protocol === 'https:' ? require('https') : http;
    const req = protocol.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 300000, // 5 min for batch
      },
      (res: http.IncomingMessage) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null); // Batch not supported, fallback to individual
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const data = Buffer.concat(chunks);
            // Parse response: expect JSON with base64-encoded files
            const response = JSON.parse(data.toString()) as { results: Array<{ id: string; audio: string }> };
            const results: Record<string, string> = {};

            ensureAudioDir();
            for (const result of response.results) {
              const audio = Buffer.from(result.audio, 'base64');
              const [cardId, field] = result.id.split('-') as [string, 'word' | 'example'];
              // Reconstruct the full cardId (UUID contains dashes)
              const lastDash = result.id.lastIndexOf('-');
              const actualCardId = result.id.substring(0, lastDash);
              const actualField = result.id.substring(lastDash + 1) as 'word' | 'example';
              const output = audioPath(actualCardId, actualField);
              fs.writeFileSync(output, audio);
              results[result.id] = toAudioUrl(output);
              // suppress unused
              void cardId;
              void field;
            }

            resolve(results);
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      },
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

/**
 * Register the `flashcard-audio://` protocol scheme as privileged.
 * Must be called BEFORE app.whenReady().
 */
export function registerFlashcardAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: false,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

/**
 * Set up the protocol handler that maps `flashcard-audio://` to files
 * in the flashcard-audio directory.
 * Must be called AFTER app.whenReady().
 */
export function setupFlashcardAudioProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const filename = decodeURIComponent(request.url.slice(`${SCHEME}://`.length));
    const filePath = path.join(getAudioDir(), filename);
    const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;
    return net.fetch(fileUrl, { headers: request.headers });
  });
}

/** Convert audio file path to protocol URL */
function toAudioUrl(filePath: string): string {
  const filename = path.basename(filePath);
  return `${SCHEME}://${filename}`;
}

/**
 * Setup IPC handlers for flashcard TTS operations.
 */
export function setupFlashcardTtsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.FLASHCARD_TTS_GET, (_event, cardId: string, field: 'word' | 'example') => {
    return getFlashcardTts(cardId, field);
  });

  ipcMain.handle(
    IPC_CHANNELS.FLASHCARD_TTS_GENERATE,
    (_event, cardId: string, text: string, language: string, field: 'word' | 'example', provider: string, remoteUrl?: string, voiceSampleId?: string) => {
      return generateFlashcardTts(cardId, text, language, field, provider, remoteUrl, voiceSampleId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FLASHCARD_TTS_BATCH_GENERATE,
    (_event, items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>, language: string, provider: string, remoteUrl?: string, voiceSampleId?: string) => {
      return batchGenerateFlashcardTts(items, language, provider, remoteUrl, voiceSampleId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.FLASHCARD_TTS_GET_META, (_event, cardId: string, field: 'word' | 'example') => {
    return getFlashcardTtsMeta(cardId, field);
  });
}
