/**
 * Flashcard Video Storage Service
 * Stores flashcard video clips as files in {userData}/flashcard-videos/{cardId}.mp4
 * Serves them via the flashcard-video:// custom protocol with Range request support.
 */

import fs from 'fs';
import path from 'path';
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

/**
 * Register the flashcard-video:// protocol scheme as privileged.
 * Must be called BEFORE app.whenReady().
 */
export function registerFlashcardVideoScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: false,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        bypassCSP: true,
      },
    },
  ]);
}

/**
 * Set up the protocol handler that maps flashcard-video:// to files
 * in the flashcard-videos directory. Supports Range requests for <video> seeking.
 * Must be called AFTER app.whenReady().
 */
export function setupFlashcardVideoProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const filename = decodeURIComponent(request.url.slice(`${SCHEME}://`.length).split('?')[0]);
    const filePath = path.join(getVideoDir(), filename);
    const fileUrl = `file://${filePath.replace(/\\/g, '/')}`;
    return net.fetch(fileUrl, { headers: request.headers });
  });
}

/**
 * Setup IPC handlers for flashcard video operations.
 */
export function setupFlashcardVideoIPC(): void {
  ipcMain.handle(IPC_CHANNELS.FLASHCARD_VIDEO_SAVE, (_event, cardId: string, data: ArrayBuffer) => {
    return saveFlashcardVideo(cardId, Buffer.from(data));
  });

  ipcMain.handle(IPC_CHANNELS.FLASHCARD_VIDEO_DELETE, (_event, cardId: string) => {
    deleteFlashcardVideo(cardId);
    return true;
  });
}
