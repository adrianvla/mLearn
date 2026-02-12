/**
 * Local Media Protocol Handler
 * Registers a custom `local-media://` protocol that serves local files
 * to the renderer process. This replaces direct `file://` URLs which
 * are blocked by Chromium's security policy when the renderer is loaded
 * over http:// (dev) or from an asar (production).
 *
 * Usage in renderer: `local-media:///path/to/video.mp4`
 */

import { protocol, net } from 'electron';

const SCHEME = 'local-media';

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
        bypassCSP: true,
      },
    },
  ]);
}

/**
 * Set up the protocol handler that maps `local-media://` to the local filesystem.
 * Must be called AFTER app.whenReady().
 */
export function setupLocalMediaProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    // Strip the scheme to get the file path
    // local-media:///Users/foo/bar.mp4 -> /Users/foo/bar.mp4
    // local-media://C:/foo/bar.mp4     -> C:/foo/bar.mp4
    let filePath = decodeURIComponent(request.url.slice(`${SCHEME}://`.length));

    // On Windows, paths may start with / before drive letter — strip it
    if (process.platform === 'win32' && filePath.startsWith('/') && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    // Delegate to net.fetch with a file:// URL which the main process can access.
    // net.fetch handles range requests, MIME types, and streaming automatically.
    const fileUrl = `file://${filePath}`;
    return net.fetch(fileUrl, {
      headers: request.headers,
    });
  });
}

/**
 * Convert a filesystem path to a `local-media://` URL for use in the renderer.
 */
export function toLocalMediaUrl(filePath: string): string {
  return `${SCHEME}://${filePath}`;
}
