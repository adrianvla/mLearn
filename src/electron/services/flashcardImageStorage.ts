/**
 * Flashcard Image Storage Service
 * Stores flashcard images as files instead of inline base64 in JSON.
 * Images are stored in {userData}/flashcard-images/{cardId}.{ext}
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import { ipcMain, protocol, net } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { getUserDataPath } from '../utils/platform';
import type { FlashcardStore } from '../../shared/types';

const SCHEME = 'flashcard-image';

/** Get the directory for flashcard images */
function getImageDir(): string {
  return path.join(getUserDataPath(), 'flashcard-images');
}

/** Ensure the image directory exists */
function ensureImageDir(): void {
  const dir = getImageDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Determine file extension from a data URL or default to jpg */
function extensionFromDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/(\w+)/);
  if (!match) return 'jpg';
  const mime = match[1].toLowerCase();
  if (mime === 'jpeg') return 'jpg';
  return mime;
}

/** Convert a base64 data URL to a Buffer */
function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

/** Check if a string is a base64 data URL */
function isBase64DataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Extract base64 images from flashcard store and save them as files.
 * Replaces imageUrl (and legacy screenshotUrl) with file:// paths.
 * Returns true if any images were extracted.
 */
export function extractBase64Images(store: FlashcardStore): boolean {
  ensureImageDir();
  const imageDir = getImageDir();
  let modified = false;

  for (const [cardId, card] of Object.entries(store.flashcards)) {
    if (!card.content) continue;

    // Handle imageUrl
    if (isBase64DataUrl(card.content.imageUrl)) {
      const ext = extensionFromDataUrl(card.content.imageUrl);
      const filename = `${cardId}.${ext}`;
      const filePath = path.join(imageDir, filename);

      const buffer = dataUrlToBuffer(card.content.imageUrl);
      if (buffer) {
        fs.writeFileSync(filePath, buffer);
        card.content.imageUrl = `flashcard-image://${filename}`;
        modified = true;
      }
    }

    // Handle legacy screenshotUrl field (also base64)
    if (isBase64DataUrl(card.content.screenshotUrl)) {
      const ext = extensionFromDataUrl(card.content.screenshotUrl);
      const filename = `${cardId}.${ext}`;
      const filePath = path.join(imageDir, filename);

      // Only write if we haven't already written the imageUrl
      if (!card.content.imageUrl || !card.content.imageUrl.startsWith('flashcard-image://')) {
        const buffer = dataUrlToBuffer(card.content.screenshotUrl);
        if (buffer) {
          fs.writeFileSync(filePath, buffer);
        }
      }
      card.content.screenshotUrl = `flashcard-image://${filename}`;
      modified = true;
    }
  }

  // Also extract base64 images from suggested flashcards
  if (store.suggestedFlashcards) {
    for (const [key, suggestion] of Object.entries(store.suggestedFlashcards)) {
      if (!suggestion || !isBase64DataUrl(suggestion.imageUrl)) continue;

      const ext = extensionFromDataUrl(suggestion.imageUrl);
      const filename = `suggested-${suggestion.id || key}.${ext}`;
      const filePath = path.join(imageDir, filename);

      const buffer = dataUrlToBuffer(suggestion.imageUrl);
      if (buffer) {
        fs.writeFileSync(filePath, buffer);
        suggestion.imageUrl = `flashcard-image://${filename}`;
        modified = true;
      }
    }
  }

  return modified;
}

/**
 * Save a single image for a flashcard card and return the protocol URL.
 */
export function saveFlashcardImage(cardId: string, dataUrl: string): string | null {
  if (!isBase64DataUrl(dataUrl)) return null;

  ensureImageDir();
  const imageDir = getImageDir();

  const ext = extensionFromDataUrl(dataUrl);
  const filename = `${cardId}.${ext}`;
  const filePath = path.join(imageDir, filename);

  const buffer = dataUrlToBuffer(dataUrl);
  if (!buffer) return null;

  fs.writeFileSync(filePath, buffer);
  return `flashcard-image://${filename}`;
}

/**
 * Delete the image file for a flashcard card.
 */
export function deleteFlashcardImage(cardId: string): void {
  const imageDir = getImageDir();
  if (!fs.existsSync(imageDir)) return;

  // Try common extensions
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const filePath = path.join(imageDir, `${cardId}.${ext}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

/**
 * Resolve a flashcard-image:// URL to an absolute file path.
 */
export function resolveImagePath(imageUrl: string): string | null {
  if (!imageUrl.startsWith('flashcard-image://')) return null;
  const filename = imageUrl.replace('flashcard-image://', '');
  const filePath = path.join(getImageDir(), filename);
  if (fs.existsSync(filePath)) return filePath;
  return null;
}

/**
 * Resolve a flashcard-image:// URL to a file:// URL for rendering.
 */
export function resolveImageUrl(imageUrl: string): string | null {
  const filePath = resolveImagePath(imageUrl);
  if (!filePath) return null;
  return pathToFileURL(filePath).href;
}

/**
 * Register the `flashcard-image://` protocol scheme as privileged.
 * Must be called BEFORE app.whenReady().
 */
export function registerFlashcardImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: false,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: true,
      },
    },
  ]);
}

/**
 * Set up the protocol handler that maps `flashcard-image://` to files
 * in the flashcard-images directory.
 * Must be called AFTER app.whenReady().
 */
export function setupFlashcardImageProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    // flashcard-image://cardId.jpg -> {userData}/flashcard-images/cardId.jpg
    const filename = decodeURIComponent(request.url.slice(`${SCHEME}://`.length));
    const filePath = path.join(getImageDir(), filename);
    const fileUrl = pathToFileURL(filePath).href;
    return net.fetch(fileUrl, { headers: request.headers });
  });
}

/**
 * Setup IPC handlers for flashcard image operations.
 */
export function setupFlashcardImageIPC(): void {
  // Save a base64 image and return the protocol URL
  ipcMain.handle(IPC_CHANNELS.FLASHCARD_IMAGE_SAVE, (_event, cardId: string, dataUrl: string) => {
    return saveFlashcardImage(cardId, dataUrl);
  });

  // Resolve a flashcard-image:// URL to a file:// URL
  ipcMain.handle(IPC_CHANNELS.FLASHCARD_IMAGE_RESOLVE, (_event, imageUrl: string) => {
    return resolveImageUrl(imageUrl);
  });

  // Delete a flashcard image
  ipcMain.handle(IPC_CHANNELS.FLASHCARD_IMAGE_DELETE, (_event, cardId: string) => {
    deleteFlashcardImage(cardId);
    return true;
  });
}
