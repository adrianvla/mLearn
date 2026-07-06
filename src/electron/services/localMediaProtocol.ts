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
import * as os from 'node:os';
import * as path from 'node:path';
import { getPluginsDir } from './pluginManager';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.localMediaProtocol');

const SCHEME = 'local-media';
const PLUGIN_UI_SCHEME = 'plugin-ui';
const LOCAL_MEDIA_RESPONSE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range',
};

/** Simple MIME lookup for common media types */
const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/mp4',
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
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
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
        // `standard: true` is required for reliable HTTP Range request handling
        // by Chromium when the scheme also declares `stream: true`. With
        // `standard: false`, packaged builds intermittently drop the Range
        // header, causing video seek to snap to position 0 or fail to play.
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: false,
      },
    },
  ]);
}

export function registerPluginUiScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_UI_SCHEME,
      privileges: {
        standard: false,
        secure: true,
        supportFetchAPI: true,
        stream: false,
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
function isPathAllowed(resolvedPath: string): boolean {
  const userDirNames = ['home', 'userData', 'downloads', 'documents', 'videos', 'music', 'pictures', 'desktop'] as const;
  const userDirs: string[] = [];
  for (const name of userDirNames) {
    try {
      userDirs.push(app.getPath(name));
    } catch {
      /* empty */
    }
  }

  // On macOS, sandboxed apps return the container path for app.getPath('home').
  // Also allow the real user home directory so user files work correctly.
  if (process.platform === 'darwin') {
    try {
      userDirs.push(os.homedir());
    } catch {
      /* empty */
    }
  }

  for (const base of userDirs) {
    if (resolvedPath === base) return true;
    if (resolvedPath.startsWith(base + path.sep)) return true;
  }

  if (process.platform === 'darwin') {
    if (resolvedPath === '/Volumes' || resolvedPath.startsWith('/Volumes' + path.sep)) return true;
    return false;
  }

  if (process.platform === 'linux') {
    for (const mountRoot of ['/mnt', '/media', '/run/media']) {
      if (resolvedPath === mountRoot || resolvedPath.startsWith(mountRoot + path.sep)) return true;
    }
    return false;
  }

  if (process.platform === 'win32') {
    // Allow any drive letter on Windows. The OS file picker already constrains
    // user-chosen paths; arbitrary scheme requests still cannot escape the
    // drive-letter prefix because `path.resolve` normalizes traversal.
    if (/^[A-Za-z]:[\\/]/.test(resolvedPath)) return true;
    return false;
  }

  return false;
}

export function setupLocalMediaProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: LOCAL_MEDIA_RESPONSE_HEADERS,
      });
    }

    // Use the URL API to reliably extract the pathname regardless of how
    // Chromium parsed the host portion (standard schemes may treat the first
    // path segment as host when no explicit host is present).
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    log.info('local-media request:', request.url, 'decoded path:', filePath);

    // On Windows, paths may start with / before drive letter — strip it
    if (process.platform === 'win32' && filePath.startsWith('/') && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const resolvedPath = path.resolve(filePath);
    if (!isPathAllowed(resolvedPath)) {
      return new Response('Access denied', { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolvedPath);
    } catch (e) {
      log.error('local-media stat failed', e);
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
            ...LOCAL_MEDIA_RESPONSE_HEADERS,
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
        ...LOCAL_MEDIA_RESPONSE_HEADERS,
        'Content-Length': String(fileSize),
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      },
    });
  });
}

export function setupPluginUiProtocol(): void {
  protocol.handle(PLUGIN_UI_SCHEME, async (request) => {
    const requestPath = decodeURIComponent(request.url.slice(`${PLUGIN_UI_SCHEME}://`.length));
    const requestSegments = requestPath.split('/').filter((segment) => segment.length > 0);

    if (requestSegments.length < 2 || requestSegments.includes('..')) {
      return new Response('Access denied', { status: 403 });
    }

    const [encodedPluginId, ...relativePathSegments] = requestSegments;
    const pluginId = decodeURIComponent(encodedPluginId);

    const pluginsDir = path.resolve(getPluginsDir());
    const scopedPluginDir = path.resolve(pluginsDir, pluginId);
    const resolvedPath = path.resolve(scopedPluginDir, ...relativePathSegments);
    const isAllowed = resolvedPath.startsWith(`${scopedPluginDir}${path.sep}`);
    if (!isAllowed) {
      return new Response('Access denied', { status: 403 });
    }

    try {
      const content = await fs.promises.readFile(resolvedPath);
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(resolvedPath),
          'Content-Length': String(content.byteLength),
        },
      });
    } catch {
      return new Response('File not found', { status: 404 });
    }
  });
}

/**
 * Convert a filesystem path to a `local-media://` URL for use in the renderer.
 */
export function toLocalMediaUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const encoded = normalized.split('/').map(encodeURIComponent).join('/');
  return `${SCHEME}://localhost${encoded.startsWith('/') ? encoded : '/' + encoded}`;
}
