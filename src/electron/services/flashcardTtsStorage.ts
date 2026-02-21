/**
 * Flashcard TTS Storage Service
 * Manages .ogg audio files for flashcard word and example TTS.
 * Files stored in {userData}/flashcard-audio/{cardId}-{field}.ogg
 */

import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS, API_ENDPOINTS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';
import http from 'http';

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

/** Get the full path for a card's audio file */
function audioPath(cardId: string, field: 'word' | 'example'): string {
  return path.join(getAudioDir(), audioFilename(cardId, field));
}

/**
 * Check if a TTS audio file exists and return its file URL.
 */
function getFlashcardTts(cardId: string, field: 'word' | 'example'): string | null {
  const filePath = audioPath(cardId, field);
  if (fs.existsSync(filePath)) {
    return `file://${filePath.replace(/\\/g, '/')}`;
  }
  return null;
}

/**
 * Generate TTS audio via Kokoro (local Python backend) and save as .ogg.
 * Returns the file URL on success, null on failure.
 */
async function generateViaKokoro(text: string, language: string, outputPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(API_ENDPOINTS.voiceTts);
    const body = JSON.stringify({ text, language, format: 'ogg' });

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
): Promise<string | null> {
  if (!text || text === '-') return null;

  const output = audioPath(cardId, field);
  let success = false;

  if (provider === 'remote' && remoteUrl) {
    success = await generateViaRemote(text, language, output, remoteUrl);
  } else {
    success = await generateViaKokoro(text, language, output);
  }

  if (success) {
    return `file://${output.replace(/\\/g, '/')}`;
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
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  if (provider === 'remote' && remoteUrl) {
    // Try batch endpoint first
    const batchResult = await tryBatchRemote(items, language, remoteUrl);
    if (batchResult) return batchResult;
  }

  // Fallback: generate one by one
  for (const item of items) {
    const url = await generateFlashcardTts(item.cardId, item.text, language, item.field, provider, remoteUrl);
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
              results[result.id] = `file://${output.replace(/\\/g, '/')}`;
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
 * Setup IPC handlers for flashcard TTS operations.
 */
export function setupFlashcardTtsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.FLASHCARD_TTS_GET, (_event, cardId: string, field: 'word' | 'example') => {
    return getFlashcardTts(cardId, field);
  });

  ipcMain.handle(
    IPC_CHANNELS.FLASHCARD_TTS_GENERATE,
    (_event, cardId: string, text: string, language: string, field: 'word' | 'example', provider: string, remoteUrl?: string) => {
      return generateFlashcardTts(cardId, text, language, field, provider, remoteUrl);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FLASHCARD_TTS_BATCH_GENERATE,
    (_event, items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>, language: string, provider: string, remoteUrl?: string) => {
      return batchGenerateFlashcardTts(items, language, provider, remoteUrl);
    },
  );
}
