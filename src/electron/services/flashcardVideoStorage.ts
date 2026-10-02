/**
 * Flashcard Video Storage Service
 * Stores flashcard video clips as files in {userData}/flashcard-videos/{cardId}.mp4
 * Serves them via the flashcard-video:// custom protocol with Range request support.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { ipcMain, protocol, net } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';

const SCHEME = 'flashcard-video';

function getVideoDir(): string {
  return path.join(getUserDataPath(), 'flashcard-videos');
}

function ensureVideoDir(): void {
  const dir = getVideoDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save a video clip for a flashcard. Accepts raw Buffer data.
 * Returns the protocol URL: flashcard-video://{cardId}.mp4
 */
export function saveFlashcardVideo(cardId: string, data: Buffer): string | null {
  if (!data || data.length === 0) return null;

  ensureVideoDir();
  const filename = `${cardId}.mp4`;
  const filePath = path.join(getVideoDir(), filename);

  fs.writeFileSync(filePath, data);
  return `${SCHEME}://${filename}`;
}

/**
 * Delete the video clip file for a flashcard.
 */
export function deleteFlashcardVideo(cardId: string): void {
  const videoDir = getVideoDir();
  if (!fs.existsSync(videoDir)) return;

  const filePath = path.join(videoDir, `${cardId}.mp4`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export { registerFlashcardVideoScheme } from '../startupSchemes';

/**
 * Set up the protocol handler that maps flashcard-video:// to files
 * in the flashcard-videos directory. Supports Range requests for <video> seeking.
 * Must be called AFTER app.whenReady().
 */
export function setupFlashcardVideoProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const filename = decodeURIComponent(request.url.slice(`${SCHEME}://`.length).split('?')[0].replace(/\/$/, ''));
    const filePath = path.join(getVideoDir(), filename);
    if (!fs.existsSync(filePath)) {
      return new Response(null, { status: 404 });
    }
    const size = (await fs.promises.stat(filePath)).size;
    const headers = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' });
    const range = request.headers.get('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      let start = 0;
      let end = size - 1;
      if (match?.[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(Number(match[2]), size - 1);
      } else if (match?.[2]) {
        start = Math.max(0, size - Number(match[2]));
      }
      if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start)
        || !Number.isSafeInteger(end) || start >= size || end < start) {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      headers.set('Content-Length', String(end - start + 1));
      // Electron's file fetch may slice the body but still return 200 without
      // Content-Range. Serve the exact range with HTTP semantics for Chromium.
      const body = request.method === 'HEAD' ? null
        : Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(body, { status: 206, headers });
    }
    headers.set('Content-Length', String(size));
    if (request.method === 'HEAD') return new Response(null, { headers });
    const response = await net.fetch(pathToFileURL(filePath).href, { headers: request.headers });
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * Setup IPC handlers for flashcard video operations.
 */
export function setupFlashcardVideoIPC(): void {
  ipcMain.handle(IPC_CHANNELS.FLASHCARD_VIDEO_SAVE, (_event, cardId: string, data: ArrayBuffer) => {
    return saveFlashcardVideo(cardId, Buffer.from(data));
  });

  ipcMain.handle(IPC_CHANNELS.FLASHCARD_VIDEO_DELETE, async (_event, cardId: string) => {
    const { releaseUnusedFlashcardMedia } = await import('./flashcardStorage');
    return releaseUnusedFlashcardMedia('video', cardId, () => deleteFlashcardVideo(cardId));
  });
}
