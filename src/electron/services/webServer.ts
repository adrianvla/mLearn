/**
 * Web Server Service
 * Provides HTTP/WebSocket server for mobile sync and watch-together functionality
 *
 * This server handles:
 * - REST API endpoints for mobile sync (settings, flashcards, localization)
 * - Proxy forwarding to Python backend
 * - WebSocket for watch-together functionality
 * - Serving static assets (CSS, fonts, icons)
 */

import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { ipcMain } from 'electron';
import { PROXY_SERVER_PORT, PYTHON_BACKEND_PORT, IPC_CHANNELS } from '../../shared/constants';
import { DEFAULT_SETTINGS, OverlayVideoScreenshot } from '../../shared/types';
import { getAppPath, getResourcePath } from '../utils/platform';
import { loadSettings, loadLangData, saveSettings } from './settings';
import { getMainWindow, getOverlayWindow, launchOverlayWindow, updateOverlayGeometry } from './windowManager';
import { loadFlashcards, saveFlashcards } from './flashcardStorage';
import { loadLocalization } from './localization';
import { getLogger } from '../../shared/utils/logger';

const log = getLogger('electron.webServer');

// Server instances
let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;

// Connected WebSocket clients
const connectedClients: Set<WebSocket> = new Set();

// Command queue for bidirectional extension sync (overlay -> extension)
interface PendingCommand {
  id: string;
  command: 'play' | 'pause' | 'seek' | 'setRate' | 'setVolume';
  time?: number;
  rate?: number;
  volume?: number;
  timestamp: number;
}
const pendingCommands: PendingCommand[] = [];
const MAX_PENDING_COMMANDS = 20;
const COMMAND_TTL_MS = 30000;

export function queueCommand(cmd: Omit<PendingCommand, 'id' | 'timestamp'>): void {
  const command: PendingCommand = {
    ...cmd,
    id: crypto.randomBytes(8).toString('hex'),
    timestamp: Date.now(),
  };
  pendingCommands.push(command);
  // Prune old commands
  while (pendingCommands.length > MAX_PENDING_COMMANDS) {
    pendingCommands.shift();
  }
  // Also prune expired commands
  const cutoff = Date.now() - COMMAND_TTL_MS;
  while (pendingCommands.length > 0 && pendingCommands[0].timestamp < cutoff) {
    pendingCommands.shift();
  }
}

function getAndClearPendingCommands(): PendingCommand[] {
  const cmds = [...pendingCommands];
  pendingCommands.length = 0;
  return cmds;
}

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
  'Access-Control-Max-Age': '86400',
};

// Generated once at process start; exported so mobile clients can receive it via QR code.
export const SERVER_AUTH_TOKEN = crypto.randomBytes(32).toString('hex');

// Allowlisted proxy domains — only these hostnames may be fetched via /?url=
const ALLOWED_PROXY_DOMAINS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
]);

// Matches RFC 1918, loopback, and link-local addresses to block SSRF to internal services
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
];

// Send message to all connected WebSocket clients
export function broadcastToClients(message: string): void {
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Get the base directory for static files
function getStaticBasePath(): string {
  const appPath = getAppPath();
  const resourcePath = getResourcePath();
  
  // In dev, files are in src/html. In prod, they're copied to dist or resources
  const candidatePaths = [
    path.join(appPath, 'src', 'html'),
    path.join(appPath, 'dist'),
    path.join(resourcePath, 'html'),
    path.join(resourcePath, 'dist'),
    // In dev mode, go from dist-electron/electron/services to project root
    path.join(__dirname, '..', '..', '..', 'src', 'html'),
    path.join(__dirname, '..', '..', '..', 'dist'),
  ];
  
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  return path.join(appPath, 'src', 'html');
}

// Parse URL with host and port
function getHostAndPort(urlString: string): [string | null, string | null] {
  try {
    const parsed = new URL(urlString);
    return [parsed.hostname, parsed.port || (parsed.protocol === 'https:' ? '443' : '80')];
  } catch (e) {
    log.error("error", e);
    return [null, null];
  }
}

// Get content type from file extension
function getContentType(ext: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
  };
  return types[ext.toLowerCase()] || 'application/octet-stream';
}

// Send JSON response
function sendJsonResponse(res: http.ServerResponse, data: unknown, statusCode = 200): void {
  res.writeHead(statusCode, {
    ...corsHeaders,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(data));
}

// Serve static file
function serveStaticFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, corsHeaders);
    res.end('File not found');
    return;
  }
  
  const ext = path.extname(filePath);
  const contentType = getContentType(ext);
  
  res.writeHead(200, {
    ...corsHeaders,
    'Content-Type': contentType,
  });
  
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  res.on('close', () => stream.destroy());
  res.on('error', () => stream.destroy());
}

// Type guard for overlay geometry
function validateGeometry(data: unknown): data is { x: number; y: number; width: number; height: number } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.x === 'number' &&
    typeof obj.y === 'number' &&
    typeof obj.width === 'number' &&
    typeof obj.height === 'number'
  );
}

// Type guard for video state
function validateVideoState(data: unknown): data is { currentTime: number; isPlaying: boolean; duration: number } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.currentTime === 'number' &&
    typeof obj.isPlaying === 'boolean' &&
    typeof obj.duration === 'number'
  );
}

// Type guard for subtitle tracks
function validateSubtitleTracks(data: unknown): data is { tracks: unknown[]; textTracks: unknown[] } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.tracks) && Array.isArray(obj.textTracks);
}

function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.headers['x-auth-token'] !== SERVER_AUTH_TOKEN) {
    res.writeHead(401, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

// HTTP request handler
async function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const urlObj = new URL(req.url || '/', `http://localhost:${PROXY_SERVER_PORT}`);
  const pathname = urlObj.pathname;
  const query = Object.fromEntries(urlObj.searchParams);

  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Root path - info page
  if (pathname === '/' && !query.url) {
    res.writeHead(200, {
      'Content-Type': 'text/html',
      ...corsHeaders,
    });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>mLearn Backend</title>
  <style>
    body { background: #222; color: #ccc; font-family: "Helvetica Neue", sans-serif; padding: 20px; }
    a { color: #ff0; }
    code { background: #333; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>mLearn Backend</h1>
  <p>Hi, this is the mLearn Backend server.</p>
  <p>This server provides REST API endpoints for mobile sync and WebSocket for watch-together functionality.</p>
  <hr>
  <script>document.getElementById("current_url") && (document.getElementById("current_url").innerText = window.location.href);</script>
</body>
</html>`);
    return;
  }

  // Serve assets from /assets/ path
  if (pathname.startsWith('/assets/')) {
    const assetPath = pathname.replace('/assets/', '');
    const basePath = getStaticBasePath();
    const filePath = path.join(basePath, 'assets', assetPath);
    serveStaticFile(res, filePath);
    return;
  }

  // Forward proxy to Python backend
  if (pathname.startsWith('/forward/')) {
    const forwardPath = pathname.replace('/forward', '');
    const settings = loadSettings();
    const tokeniserUrl = settings.tokeniserUrl || `http://127.0.0.1:${PYTHON_BACKEND_PORT}`;
    const [hostname, port] = getHostAndPort(tokeniserUrl);
    
    if (!hostname || !port) {
      res.writeHead(502, corsHeaders);
      res.end('Invalid tokeniser URL');
      return;
    }

    const options: http.RequestOptions = {
      hostname,
      port: parseInt(port, 10),
      path: forwardPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${hostname}:${port}`,
      },
    };

    const proxyClient = tokeniserUrl.startsWith('https') ? https : http;
    const proxyReq = proxyClient.request(options, (proxyRes) => {
      // Strip CORS headers from the proxied response to avoid duplicates.
      // The Python backend (FastAPI CORSMiddleware) already sets these,
      // and our own corsHeaders would duplicate them (lowercase vs mixed-case keys).
      const filteredHeaders: Record<string, string | string[] | undefined> = {};
      const corsKeySet = new Set(Object.keys(corsHeaders).map(k => k.toLowerCase()));
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (!corsKeySet.has(key.toLowerCase())) {
          filteredHeaders[key] = value;
        }
      }
      res.writeHead(proxyRes.statusCode || 200, {
        ...filteredHeaders,
        ...corsHeaders,
      });
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502, corsHeaders);
      res.end(`Proxy error: ${err.message}`);
    });

    res.on('close', () => {
      if (!proxyReq.destroyed) proxyReq.destroy();
    });

    req.pipe(proxyReq, { end: true });
    return;
  }

  // API: Forward to Anki Connect
  if (pathname === '/api/fwd-to-anki') {
    if (req.method !== 'POST') {
      res.writeHead(405, corsHeaders);
      res.end('Method not allowed');
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const settings = loadSettings();
        const ankiUrl = settings.ankiConnectUrl || DEFAULT_SETTINGS.ankiConnectUrl;
        
        const response = await fetch(ankiUrl, {
          method: 'POST',
          body: body,
        });
        const data = await response.json();
        sendJsonResponse(res, data);
      } catch (e) {
        log.error('Error forwarding to Anki:', e);
        sendJsonResponse(res, { error: (e as Error).message }, 500);
      }
    });
    return;
  }

  // API: Overlay geometry (POST with JSON body)
  if (pathname === '/api/overlay-geometry') {
    if (req.method !== 'POST') {
      res.writeHead(405, corsHeaders);
      res.end('Method not allowed');
      return;
    }
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (!validateGeometry(parsed)) {
          sendJsonResponse(res, { status: 'error', error: 'Invalid geometry: x, y, width, height must be numbers' }, 400);
          return;
        }
        updateOverlayGeometry(parsed);
        const overlay = getOverlayWindow();
        if (overlay && !overlay.isDestroyed()) {
          overlay.webContents.send(IPC_CHANNELS.OVERLAY_GEOMETRY, parsed);
        }
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        log.error('Error parsing overlay-geometry body:', e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
      }
    });
    return;
  }

  // API: Overlay sync (POST with JSON body)
  if (pathname === '/api/overlay-sync') {
    if (req.method !== 'POST') {
      res.writeHead(405, corsHeaders);
      res.end('Method not allowed');
      return;
    }
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (!validateVideoState(parsed)) {
          sendJsonResponse(res, { status: 'error', error: 'Invalid video state: currentTime, isPlaying, duration must be present and correctly typed' }, 400);
          return;
        }
        const overlay = getOverlayWindow();
        log.info('[webServer] /api/overlay-sync: time=', parsed.currentTime, 'overlay=', overlay ? 'found' : 'null');
        if (overlay && !overlay.isDestroyed()) {
          overlay.webContents.send(IPC_CHANNELS.OVERLAY_VIDEO_STATE, parsed);
        }
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        log.error('Error parsing overlay-sync body:', e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
      }
    });
    return;
  }

  // API: Overlay video screenshot (POST with JSON body)
  if (pathname === '/api/overlay-video-screenshot') {
    if (req.method !== 'POST') {
      res.writeHead(405, corsHeaders);
      res.end('Method not allowed');
      return;
    }
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as OverlayVideoScreenshot;
        if (typeof parsed.dataUrl !== 'string') {
          sendJsonResponse(res, { status: 'error', error: 'Invalid screenshot: dataUrl must be a string' }, 400);
          return;
        }
        const overlay = getOverlayWindow();
        if (overlay && !overlay.isDestroyed()) {
          overlay.webContents.send(IPC_CHANNELS.OVERLAY_VIDEO_SCREENSHOT, parsed);
        }
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        log.error('Error parsing overlay-video-screenshot body:', e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
      }
    });
    return;
  }

  // API: Overlay subtitles (POST with JSON body)
  if (pathname === '/api/overlay-subtitles') {
    if (req.method !== 'POST') {
      res.writeHead(405, corsHeaders);
      res.end('Method not allowed');
      return;
    }
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        log.info('[webServer] /api/overlay-subtitles received: tracks=', parsed.tracks?.length, 'textTracks=', parsed.textTracks?.length, 'url=', parsed.url);
        if (!validateSubtitleTracks(parsed)) {
          sendJsonResponse(res, { status: 'error', error: 'Invalid subtitle tracks: tracks and textTracks must be arrays' }, 400);
          return;
        }
        const overlay = getOverlayWindow();
        log.info('[webServer] getOverlayWindow result:', overlay ? 'found' : 'null', 'destroyed=', overlay?.isDestroyed());
        if (overlay && !overlay.isDestroyed()) {
          overlay.webContents.send(IPC_CHANNELS.OVERLAY_SUBTITLE_TRACKS, parsed);
          log.info('[webServer] Sent OVERLAY_SUBTITLE_TRACKS to overlay');
        }
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        log.error('Error parsing overlay-subtitles body:', e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
      }
    });
    return;
  }

  // API: Active URL changed (POST from extension when tab switches)
  if (pathname === '/api/active-url-changed' && req.method === 'POST') {
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        log.info('[webServer] active-url-changed: url=', parsed.url);
        const overlayWin = getOverlayWindow();
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send(IPC_CHANNELS.OVERLAY_ACTIVE_URL_CHANGED, parsed.url);
          log.info('[webServer] Sent OVERLAY_ACTIVE_URL_CHANGED to overlay');
        } else {
          log.warn('[webServer] Overlay window not available, skipping');
        }
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        log.error('Error parsing active-url-changed body:', e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
      }
    });
    return;
  }

  // API: Text mode word lookup (POST from extension -> forwarded to overlay)
  if (pathname === '/api/overlay-text-lookup' && req.method === 'POST') {
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        let overlayWin = getOverlayWindow();
        const wasLaunched = !overlayWin || overlayWin.isDestroyed();
        if (wasLaunched) {
          launchOverlayWindow();
          overlayWin = getOverlayWindow();
        }
        const forwardLookup = () => {
          const win = getOverlayWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send(IPC_CHANNELS.OVERLAY_TEXT_MODE_LOOKUP, {
              word: parsed.word,
              x: parsed.x,
              y: parsed.y,
              contextText: parsed.contextText,
              offset: parsed.offset,
            });
            log.info('[webServer] Sent OVERLAY_TEXT_MODE_LOOKUP');
          }
        };
        if (wasLaunched) {
          setTimeout(forwardLookup, 500);
        } else {
          forwardLookup();
        }
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        log.error('Error parsing overlay-text-lookup body:', e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
      }
    });
    return;
  }

  if (pathname === '/api/overlay-close-hover' && req.method === 'POST') {
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    const overlay = getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) {
      overlay.webContents.send(IPC_CHANNELS.OVERLAY_CLOSE_HOVER);
    }
    sendJsonResponse(res, { status: 'ok' });
    return;
  }

  // API: Overlay command (POST from overlay -> forwarded to extension)
  if (pathname === '/api/overlay-command' && req.method === 'POST') {
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        queueCommand(parsed);
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        log.error('Error parsing overlay-command body:', e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
      }
    });
    return;
  }

  // Proxy for external URLs (CORS bypass)
  if (pathname === '/' && query.url) {
    let targetUrl = query.url;
    
    // Add protocol if missing
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      log.error("error", e);
      res.writeHead(400, corsHeaders);
      res.end('Invalid URL');
      return;
    }

    if (!ALLOWED_PROXY_DOMAINS.has(parsedUrl.hostname)) {
      res.writeHead(403, corsHeaders);
      res.end('Proxy domain not allowed');
      return;
    }

    if (PRIVATE_IP_PATTERNS.some(p => p.test(parsedUrl.hostname))) {
      res.writeHead(403, corsHeaders);
      res.end('Proxy to private addresses not allowed');
      return;
    }

    const client = targetUrl.startsWith('https') ? https : http;

    const externalReq = client.get(targetUrl, (targetRes) => {
      res.writeHead(targetRes.statusCode || 200, {
        ...corsHeaders,
        'Content-Type': targetRes.headers['content-type'] || 'application/octet-stream',
      });
      targetRes.pipe(res);
      res.on('close', () => { targetRes.destroy(); });
      res.on('error', () => { targetRes.destroy(); });
    });
    externalReq.on('error', (err) => {
      res.writeHead(500, corsHeaders);
      res.end(`Error: ${err.message}`);
    });
    res.on('close', () => {
      if (!externalReq.destroyed) externalReq.destroy();
    });
    return;
  }

  // ================================================================
  // REST API endpoints for mobile tethered mode
  // ================================================================

  // API: Ping / health check
  if (pathname === '/api/ping') {
    sendJsonResponse(res, { status: 'ok' });
    return;
  }

  // API: Command poll (for extension background script)
  if (pathname === '/api/command-poll') {
    sendJsonResponse(res, { status: 'ok', commands: getAndClearPendingCommands() });
    return;
  }

  // API: Extension auth token (localhost only)
  if (pathname === '/api/extension-auth-token') {
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    const settings = loadSettings();
    const accessToken = settings.cloudAuthAccessToken || settings.cloudAuthToken || '';
    sendJsonResponse(res, { accessToken });
    return;
  }

  if (pathname === '/api/overlay-state') {
    const rawSettings = loadSettings();
    const { cloudAuthAccessToken: _a, cloudAuthToken: _b, ...safeSettings } = rawSettings;
    const currentLangData = loadLangData();
    sendJsonResponse(res, { status: 'ok', settings: safeSettings, langData: currentLangData });
    return;
  }

  // API: Settings (GET/POST)
  if (pathname === '/api/settings') {
    if (!requireAuth(req, res)) return;
    if (req.method === 'GET') {
      const rawSettings = loadSettings();
      const { cloudAuthAccessToken: _a, cloudAuthToken: _b, ...safeSettings } = rawSettings;
      sendJsonResponse(res, safeSettings);
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const incoming = JSON.parse(body);
          await saveSettings(incoming);
          sendJsonResponse(res, { status: 'ok' });
        } catch (e) {
          log.error("error", e);
          sendJsonResponse(res, { error: 'Invalid JSON' }, 400);
        }
      });
      return;
    }
  }

  // API: Flashcards (GET/POST)
  if (pathname === '/api/flashcards') {
    if (!requireAuth(req, res)) return;
    if (req.method === 'GET') {
      sendJsonResponse(res, await loadFlashcards());
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const incoming = JSON.parse(body);
          await saveFlashcards(incoming);
          sendJsonResponse(res, { status: 'ok' });
        } catch (e) {
          log.error("error", e);
          sendJsonResponse(res, { error: 'Invalid JSON' }, 400);
        }
      });
      return;
    }
  }

  // API: Localization (GET /api/localization/:lang)
  if (pathname.startsWith('/api/localization/')) {
    if (!requireAuth(req, res)) return;
    const lang = decodeURIComponent(pathname.replace('/api/localization/', ''));
    if (lang) {
      const data = loadLocalization(lang);
      sendJsonResponse(res, { locale: lang, strings: data });
    } else {
      sendJsonResponse(res, { error: 'Missing language code' }, 400);
    }
    return;
  }

  // API: Lang data (GET /api/lang-data or /api/lang-data/:lang)
  if (pathname === '/api/lang-data' || pathname.startsWith('/api/lang-data/')) {
    const langData = loadLangData();
    if (pathname === '/api/lang-data') {
      sendJsonResponse(res, langData);
    } else {
      const lang = decodeURIComponent(pathname.replace('/api/lang-data/', ''));
      if (langData[lang]) {
        sendJsonResponse(res, langData[lang]);
      } else {
        sendJsonResponse(res, { error: `Language '${lang}' not found` }, 404);
      }
    }
    return;
  }

  // API: Launch overlay window (localhost only)
  if (pathname === '/api/overlay-launch' && req.method === 'POST') {
    const remoteAddress = req.socket.remoteAddress;
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1' || remoteAddress === '::1';
    if (!isLocalhost) {
      sendJsonResponse(res, { error: 'Forbidden' }, 403);
      return;
    }
    try {
      launchOverlayWindow();
      sendJsonResponse(res, { status: 'ok' });
    } catch (e) {
      log.error('Failed to launch overlay window', e);
      sendJsonResponse(res, { error: 'Failed to launch overlay' }, 500);
    }
    return;
  }

  // Default 404
  res.writeHead(404, corsHeaders);
  res.end('Not found');
}

// Handle WebSocket connection
function handleWebSocketConnection(ws: WebSocket): void {
  log.info('WebSocket client connected');
  connectedClients.add(ws);

  ws.on('message', (message: Buffer) => {
    try {
      // Forward to renderer and broadcast to other WS clients.
      // Messages arrive with an `action` field (play, pause, sync, etc.) from
      // watch-together masters, or with a `type` field from future structured messages.
      // Both paths need to reach the renderer AND all other connected clients.
      const raw = message.toString();
      getMainWindow()?.webContents.send(IPC_CHANNELS.WATCH_TOGETHER_REQUEST, raw);
      for (const client of connectedClients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(raw);
        }
      }
    } catch (e) {
      log.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    log.info('WebSocket client disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (error: Error) => {
    log.error('WebSocket error:', error);
    connectedClients.delete(ws);
  });
}

// Start web server
export function startWebServer(): void {
  if (httpServer) return;

  httpServer = http.createServer(handleHttpRequest);
  wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', handleWebSocketConnection);

  // Handle server errors
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    log.error('Web server error:', error);
    
    let errorMessage = `Web server error: ${error.message}`;
    
    if (error.code === 'EADDRINUSE') {
      errorMessage = `Error: listen EADDRINUSE: address already in use :::${PROXY_SERVER_PORT}`;
    } else if (error.code === 'EACCES') {
      errorMessage = `Error: Permission denied to use port ${PROXY_SERVER_PORT}`;
    }
    
    // Send critical error to renderer - use a small delay to ensure renderer is ready
    const sendError = () => {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.webContents.isLoading()) {
          // Wait for the window to finish loading
          mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.send(IPC_CHANNELS.SERVER_CRITICAL_ERROR, errorMessage);
          });
        } else {
          mainWindow.webContents.send(IPC_CHANNELS.SERVER_CRITICAL_ERROR, errorMessage);
        }
      } else {
        // Window not ready yet, retry after a short delay
        setTimeout(sendError, 500);
      }
    };
    
    sendError();
  });

  httpServer.listen(PROXY_SERVER_PORT, () => {
    log.info(`Web server listening on http://127.0.0.1:${PROXY_SERVER_PORT}`);
  });

  // Setup IPC handlers
  ipcMain.on(IPC_CHANNELS.WATCH_TOGETHER_SEND, (_event, message) => {
    broadcastToClients(message);
  });

  // When the renderer asks "am I watching together?" reply to activate the mode
  ipcMain.on(IPC_CHANNELS.IS_WATCHING_TOGETHER, (event) => {
    event.reply(IPC_CHANNELS.WATCH_TOGETHER);
  });
}

// Stop web server
export function stopWebServer(): void {
  if (wss) {
    wss.close();
    wss = null;
  }
  
  if (httpServer) {
    httpServer.closeAllConnections();
    httpServer.close();
    httpServer = null;
  }
  
  connectedClients.clear();
}
