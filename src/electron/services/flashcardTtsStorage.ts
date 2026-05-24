/**
 * Flashcard TTS Storage Service
 * Manages .ogg audio files for flashcard word and example TTS.
 * Files stored in {userData}/flashcard-audio/{cardId}-{field}.ogg
 */

import fs from 'fs';
import path from 'path';
import { ipcMain, protocol, net } from 'electron';
import { IPC_CHANNELS, API_ENDPOINTS, DEFAULT_CLOUD_API_URL } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';
import { loadSamplesManifest, getVoiceSamplePath } from './voiceService';
import { limitConsecutiveDots } from '../../shared/utils/textUtils';
import { pathToFileURL } from 'node:url';
import http from 'http';
import https from 'https';
import { getLogger } from '../../shared/utils/logger';
import { loadSettings } from './settings';

const log = getLogger('electron.flashcardTtsStorage');

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
  } catch (e) {
    log.error("error", e);
    // Non-critical — silently ignore
  }
}

/** Read TTS metadata for a card field */
function getFlashcardTtsMeta(cardId: string, field: 'word' | 'example'): { provider: string; generatedAt: string; language: string } | null {
  const mp = metaPath(cardId, field);
  if (!fs.existsSync(mp)) return null;
  try {
    return JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch (e) {
    log.error("error", e);
    return null;
  }
}

/** Minimum valid audio file size in bytes (a valid header is at least ~44 bytes for WAV) */
const MIN_AUDIO_SIZE = 100;

/**
 * Check if a TTS audio file exists and return its file URL.
 * Files below MIN_AUDIO_SIZE are considered corrupt and removed.
 */
function getFlashcardTts(cardId: string, field: 'word' | 'example'): string | null {
  const filePath = audioPath(cardId, field);
  if (fs.existsSync(filePath)) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size >= MIN_AUDIO_SIZE) {
        return toAudioUrl(filePath);
      }
      // Corrupt / truncated file — remove it so repair can regenerate
      fs.unlinkSync(filePath);
    } catch (e) {
      log.error("error", e);
      // stat/unlink failed — treat as missing
    }
  }
  return null;
}

/**
 * Generate TTS audio via the local Python backend (Kokoro or Qwen3) and save as .ogg.
 * The `provider` field is forwarded so the backend routes to the correct engine.
 */
async function generateViaLocal(text: string, language: string, outputPath: string, provider: string, voiceSamplePath?: string): Promise<boolean> {
  const label = `[FlashcardTTS] local (${provider})`;
  const textSnippet = text.length > 40 ? text.slice(0, 40) + '…' : text;

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
        timeout: 60000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          const errorChunks: Buffer[] = [];
          res.on('data', (chunk) => errorChunks.push(chunk));
          res.on('end', () => {
            const errorBody = Buffer.concat(errorChunks).toString().slice(0, 500);
            log.error(`${label} HTTP ${res.statusCode} for "${textSnippet}": ${errorBody}`);
            resolve(false);
          });
          res.on('error', () => {
            log.error(`${label} HTTP ${res.statusCode} for "${textSnippet}" (error reading body)`);
            resolve(false);
          });
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
            log.error(`${label} empty response body for "${textSnippet}"`);
            resolve(false);
          }
        });
        res.on('error', (err) => {
          log.error(`${label} response stream error for "${textSnippet}":`, err.message);
          resolve(false);
        });
      },
    );

    req.on('error', (err) => {
      log.error(`${label} request error for "${textSnippet}":`, err.message);
      resolve(false);
    });
    req.on('timeout', () => {
      log.error(`${label} request timed out for "${textSnippet}"`);
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestWithRedirects(
  url: URL,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeout?: number;
    maxRedirects?: number;
  } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl: URL, redirectsLeft: number) => {
      if (redirectsLeft <= 0) {
        reject(new Error('Too many redirects'));
        return;
      }

      const proto = currentUrl.protocol === 'https:' ? https : http;
      const req = proto.request(
        {
          hostname: currentUrl.hostname,
          port: currentUrl.port,
          path: currentUrl.pathname + currentUrl.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          timeout: options.timeout || 30000,
        },
        (res: http.IncomingMessage) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            const nextUrl = new URL(res.headers.location, currentUrl.toString());
            doRequest(nextUrl, redirectsLeft - 1);
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (options.body) {
        req.write(options.body);
      }
      req.end();
    };

    doRequest(url, options.maxRedirects ?? 5);
  });
}

async function generateViaCloud(
  text: string,
  language: string,
  outputPath: string,
  authToken: string,
  apiUrl?: string,
  provider?: string,
  voiceSampleId?: string,
): Promise<boolean> {
  try {
    const settings = loadSettings();
    const baseUrl = ((settings.overrideCloudEndpointUrl && settings.cloudApiUrl)
      ? settings.cloudApiUrl
      : (apiUrl || DEFAULT_CLOUD_API_URL)).replace(/\/+$/, '');

    const jobPayload: Record<string, unknown> = { text, language };
    if (provider && provider !== 'cloud') jobPayload.provider = provider;
    if (voiceSampleId) jobPayload.voiceSampleId = voiceSampleId;
    const jobBody = JSON.stringify(jobPayload);

    const jobRes = await requestWithRedirects(new URL(`${baseUrl}/api/tts/jobs`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: jobBody,
      timeout: 30000,
    });

    if (jobRes.statusCode !== 200) {
      throw new Error(`Cloud TTS job creation failed: ${jobRes.statusCode}`);
    }

    const jobData = JSON.parse(jobRes.body.toString());
    const jobId = jobData.jobId;
    if (!jobId) {
      throw new Error('Cloud TTS: missing jobId');
    }

    const statusUrl = new URL(`${baseUrl}/api/jobs/${jobId}`);
    const maxPolls = 60;
    const pollIntervalMs = 2000;
    let jobStatus = 'pending';

    for (let poll = 0; poll < maxPolls; poll++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));

      const statusRes = await requestWithRedirects(statusUrl, {
        headers: { 'Authorization': `Bearer ${authToken}` },
        timeout: 10000,
      });

      if (statusRes.statusCode !== 200) {
        throw new Error(`Job status check failed: ${statusRes.statusCode}`);
      }

      const statusData = JSON.parse(statusRes.body.toString());
      jobStatus = statusData.job?.status || 'unknown';
      if (jobStatus === 'completed') break;
      if (jobStatus === 'failed') {
        log.error(`[FlashcardTTS] Cloud job failed: ${statusData.job?.error || 'Unknown error'}`);
        return false;
      }
    }

    if (jobStatus !== 'completed') {
      log.error('[FlashcardTTS] Cloud job timed out waiting for completion');
      return false;
    }

    const resultRes = await requestWithRedirects(new URL(`${baseUrl}/api/jobs/${jobId}/result`), {
      headers: { 'Authorization': `Bearer ${authToken}` },
      timeout: 10000,
    });

    if (resultRes.statusCode !== 200) {
      throw new Error(`Download URL request failed: ${resultRes.statusCode}`);
    }

    const resultData = JSON.parse(resultRes.body.toString());
    const downloadUrl = resultData.downloadUrl;
    if (!downloadUrl) {
      throw new Error('Cloud TTS: missing downloadUrl');
    }

    const audioRes = await requestWithRedirects(new URL(downloadUrl), {
      timeout: 60000,
    });

    if (audioRes.statusCode !== 200) {
      throw new Error(`Cloud TTS audio download failed: ${audioRes.statusCode}`);
    }

    if (audioRes.body.length > 0) {
      ensureAudioDir();
      fs.writeFileSync(outputPath, audioRes.body);
      return true;
    }
    return false;
  } catch (e) {
    log.error('[FlashcardTTS] Cloud generation failed:', e);
    return false;
  }
}

/** Maximum generation attempts per card field */
const MAX_TTS_ATTEMPTS = 3;

/** Delay between retries in ms (doubles each attempt) */
const TTS_RETRY_BASE_DELAY = 1000;

/**
 * Generate TTS for a single card field.
 * Retries up to MAX_TTS_ATTEMPTS times with exponential backoff on failure.
 */
async function generateFlashcardTts(
  cardId: string,
  text: string,
  language: string,
  field: 'word' | 'example',
  provider: string,
  voiceSampleId?: string,
  cloudAuthToken?: string,
  cloudApiUrl?: string,
): Promise<string | null> {
  if (!text || text === '-') return null;

  // Sanitize consecutive dots to prevent TTS backend failures
  const sanitizedText = limitConsecutiveDots(text);
  const output = audioPath(cardId, field);

  // Resolve voice sample path if provided
  let voiceSamplePath: string | undefined;
  if (voiceSampleId) {
    const samples = loadSamplesManifest();
    const sample = samples.find((s) => s.id === voiceSampleId);
    if (sample) voiceSamplePath = getVoiceSamplePath(sample);
  }

  for (let attempt = 1; attempt <= MAX_TTS_ATTEMPTS; attempt++) {
    let success = false;

    if (provider === 'cloud' && cloudAuthToken) {
      success = await generateViaCloud(sanitizedText, language, output, cloudAuthToken, cloudApiUrl, provider, voiceSampleId);
    } else {
      success = await generateViaLocal(sanitizedText, language, output, provider, voiceSamplePath);
    }

    if (success) {
      writeMetadata(cardId, field, provider, language);
      return toAudioUrl(output);
    }

    if (attempt < MAX_TTS_ATTEMPTS) {
      const delay = TTS_RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
      log.error(`[FlashcardTTS] attempt ${attempt}/${MAX_TTS_ATTEMPTS} failed for "${cardId}-${field}", retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  log.error(`[FlashcardTTS] all ${MAX_TTS_ATTEMPTS} attempts failed for "${cardId}-${field}"`);
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
  voiceSampleId?: string,
  cloudAuthToken?: string,
  cloudApiUrl?: string,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  // Generate one by one (cloud and local providers)
  for (const item of items) {
    const url = await generateFlashcardTts(item.cardId, item.text, language, item.field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl);
    if (url) {
      results[`${item.cardId}-${item.field}`] = url;
    }
  }

  return results;
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
    // Strip query params (cache-busting) before resolving the file path
    const raw = decodeURIComponent(request.url.slice(`${SCHEME}://`.length));
    const filename = raw.split('?')[0];
    const filePath = path.join(getAudioDir(), filename);
    const fileUrl = pathToFileURL(filePath).href;
    return net.fetch(fileUrl, { headers: request.headers });
  });
}

/** Convert audio file path to protocol URL */
function toAudioUrl(filePath: string): string {
  const filename = path.basename(filePath);
  return `${SCHEME}://${filename}`;
}

/**
 * Delete the audio + metadata files for a flashcard card (both `word` and `example` fields).
 */
export function deleteFlashcardTts(cardId: string): void {
  const audioDir = getAudioDir();
  if (!fs.existsSync(audioDir)) return;

  for (const field of ['word', 'example'] as const) {
    const audio = audioPath(cardId, field);
    const meta = metaPath(cardId, field);
    if (fs.existsSync(audio)) {
      try {
        fs.unlinkSync(audio);
      } catch (e) {
        log.error("error", e);
      }
    }
    if (fs.existsSync(meta)) {
      try {
        fs.unlinkSync(meta);
      } catch (e) {
        log.error("error", e);
      }
    }
  }
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
    (_event, cardId: string, text: string, language: string, field: 'word' | 'example', provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string) => {
      return generateFlashcardTts(cardId, text, language, field, provider, voiceSampleId, cloudAuthToken, cloudApiUrl);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.FLASHCARD_TTS_BATCH_GENERATE,
    (_event, items: Array<{ cardId: string; text: string; field: 'word' | 'example' }>, language: string, provider: string, voiceSampleId?: string, cloudAuthToken?: string, cloudApiUrl?: string) => {
      return batchGenerateFlashcardTts(items, language, provider, voiceSampleId, cloudAuthToken, cloudApiUrl);
    },
  );

  ipcMain.handle(IPC_CHANNELS.FLASHCARD_TTS_GET_META, (_event, cardId: string, field: 'word' | 'example') => {
    return getFlashcardTtsMeta(cardId, field);
  });

  ipcMain.handle(IPC_CHANNELS.FLASHCARD_TTS_DELETE, (_event, cardId: string) => {
    deleteFlashcardTts(cardId);
  });
}
