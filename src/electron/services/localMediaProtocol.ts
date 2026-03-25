/**
 * Local Media Protocol Handler
 * Registers a custom `local-media://` protocol that serves local files
 * to the renderer process. This replaces direct `file://` URLs which
 * are blocked by Chromium's security policy when the renderer is loaded
 * over http:// (dev) or from an asar (production).
 *
 * Usage in renderer: `local-media:///path/to/video.mp4`
 */

import { protocol, app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCHEME = 'local-media';

/** Simple MIME lookup for common media types */
const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Register the `local-media://` protocol scheme as privileged.
 * Must be called BEFORE app.whenReady().
 */
export function registerLocalMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: false,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
      },
    },
  ]);
}

/**
 * Set up the protocol handler that maps `local-media://` to the local filesystem.
 * Must be called AFTER app.whenReady().
 *
 * Manually handles HTTP Range requests so that video seeking works correctly.
 * Chromium's file:// handler via net.fetch does not reliably support Range headers,
 * which causes seeks to snap to position 0.
 */
export function setupLocalMediaProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    let filePath = decodeURIComponent(request.url.slice(`${SCHEME}://`.length));

    // On Windows, paths may start with / before drive letter — strip it
    if (process.platform === 'win32' && filePath.startsWith('/') && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const resolvedPath = path.resolve(filePath);
    const allowedBases = [
      app.getPath('home'),
      app.getPath('userData'),
    ];
    const isAllowed = allowedBases.some(base => resolvedPath.startsWith(base + path.sep) || resolvedPath === base);
    if (!isAllowed) {
      return new Response('Access denied', { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolvedPath);
    } catch (e) {
      console.error(e);
      return new Response('File not found', { status: 404 });
    }

    const fileSize = stat.size;
    const mimeType = getMimeType(resolvedPath);
    const rangeHeader = request.headers.get('Range');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const nodeStream = fs.createReadStream(resolvedPath, { start, end });
        const readable = new ReadableStream({
          start(controller) {
            nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
            nodeStream.on('end', () => controller.close());
            nodeStream.on('error', (err) => controller.error(err));
          },
          cancel() {
            nodeStream.destroy();
          },
        });

        return new Response(readable, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': mimeType,
          },
        });
      }
    }

    const nodeStream = fs.createReadStream(resolvedPath);
    const readable = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    return new Response(readable, {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      },
    });
  });
}

/**
 * Convert a filesystem path to a `local-media://` URL for use in the renderer.
 */
export function toLocalMediaUrl(filePath: string): string {
  return `${SCHEME}://${filePath}`;
}
