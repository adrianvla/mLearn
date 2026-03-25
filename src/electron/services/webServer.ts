/**
 * Web Server Service
 * Provides HTTP/WebSocket server for tethered mode and watch-together functionality
 * 
 * This server handles:
 * - Serving tethered mode scripts (core.js, settings.js, quick-lookup.js)
 * - Serving the userscript for mobile tethered mode
 * - API endpoints for flashcard creation, pills, word appearance tracking
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
import { getAppPath, getResourcePath } from '../utils/platform';
import { loadSettings, loadLangData, saveSettings } from './settings';
import { getMainWindow } from './windowManager';
import { getFlashcardEaseMap, loadFlashcards, saveFlashcards } from './flashcardStorage';
import { loadLocalization } from './localization';

// Server instances
let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;

// Connected WebSocket clients
const connectedClients: Set<WebSocket> = new Set();

// Queued updates for main window
let pillQueuedUpdates: Array<{ word: string; status: number }> = [];
let wordAppearanceQueuedUpdates: string[] = [];
let attemptFlashcardCreationQueuedUpdates: Array<{ word: string; content: unknown }> = [];
let createFlashcardQueuedUpdates: Array<{ content: unknown }> = [];
let lastWatchedQueuedUpdates: Array<{ name: string; screenshotUrl: string; videoUrl: string }> = [];

// LocalStorage data received from renderer
let localStorageData: Record<string, unknown> = {};

// CORS headers
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Auth-Token',
  'Access-Control-Max-Age': '86400',
};

// Generated once at process start; exported so tethered clients can receive it via QR code.
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

// Set local storage data
export function setLocalStorage(data: Record<string, unknown>): void {
  localStorageData = data;
}

// Flush queued updates to main window
function flushPillUpdates(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || pillQueuedUpdates.length === 0) return;
  console.log('Sending queued pill updates to main window:', pillQueuedUpdates);
  mainWindow.webContents.send(IPC_CHANNELS.UPDATE_PILLS, JSON.stringify(pillQueuedUpdates));
  pillQueuedUpdates = [];
}

function flushWordAppearanceUpdates(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || wordAppearanceQueuedUpdates.length === 0) return;
  console.log('Sending queued word appearance updates to main window:', wordAppearanceQueuedUpdates);
  mainWindow.webContents.send(IPC_CHANNELS.UPDATE_WORD_APPEARANCE, JSON.stringify(wordAppearanceQueuedUpdates));
  wordAppearanceQueuedUpdates = [];
}

function flushAttemptFlashcardCreationUpdates(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || attemptFlashcardCreationQueuedUpdates.length === 0) return;
  console.log('Sending queued flashcard creation attempts to main window:', attemptFlashcardCreationQueuedUpdates);
  mainWindow.webContents.send(IPC_CHANNELS.UPDATE_ATTEMPT_FLASHCARD_CREATION, JSON.stringify(attemptFlashcardCreationQueuedUpdates));
  attemptFlashcardCreationQueuedUpdates = [];
}

function flushCreateFlashcardUpdates(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || createFlashcardQueuedUpdates.length === 0) return;
  console.log('Sending queued flashcard creation updates to main window:', createFlashcardQueuedUpdates);
  mainWindow.webContents.send(IPC_CHANNELS.UPDATE_CREATE_FLASHCARD, JSON.stringify(createFlashcardQueuedUpdates));
  createFlashcardQueuedUpdates = [];
}

function flushLastWatchedUpdates(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || lastWatchedQueuedUpdates.length === 0) return;
  console.log('Sending queued last watched updates to main window:', lastWatchedQueuedUpdates);
  mainWindow.webContents.send(IPC_CHANNELS.UPDATE_LAST_WATCHED, JSON.stringify(lastWatchedQueuedUpdates));
  lastWatchedQueuedUpdates = [];
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

// Get the scripts directory
function getScriptsPath(): string {
  const appPath = getAppPath();
  const resourcePath = getResourcePath();
  
  // In dev, __dirname is dist-electron/electron/services, so we need to go up more levels
  // to find the project root scripts directory
  const candidatePaths = [
    path.join(appPath, 'scripts'),
    path.join(resourcePath, 'scripts'),
    // In dev mode, go from dist-electron/electron/services to project root
    path.join(__dirname, '..', '..', '..', 'scripts'),
    // Alternative: from dist-electron to project root
    path.join(__dirname, '..', '..', 'scripts'),
  ];
  
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  
  return path.join(appPath, 'scripts');
}

// Parse URL with host and port
function getHostAndPort(urlString: string): [string | null, string | null] {
  try {
    const parsed = new URL(urlString);
    return [parsed.hostname, parsed.port || (parsed.protocol === 'https:' ? '443' : '80')];
  } catch (e) {
    console.error(e);
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
  <p>This server responds to HTTP requests made by the Injected mLearn Application, as well as by the Tethered version of mLearn for Mobile.</p>
  <p>This server also responds to WebSockets, a feature used by mLearn's Watch Together feature.</p>
  <hr>
  <p>If you want to install the mLearn Mobile UserScript for use in Tethered Mode, please click <a href="/mLearn.user.js">here</a>.</p>
  <script>document.getElementById("current_url") && (document.getElementById("current_url").innerText = window.location.href);</script>
</body>
</html>`);
    return;
  }

  // Serve userscript
  if (pathname === '/mLearn.user.js') {
    const scriptsPath = getScriptsPath();
    const scriptPath = path.join(scriptsPath, 'userscript.js');
    
    if (fs.existsSync(scriptPath)) {
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        ...corsHeaders,
      });
      const stream = fs.createReadStream(scriptPath);
      stream.pipe(res);
      res.on('close', () => stream.destroy());
      res.on('error', () => stream.destroy());
    } else {
      res.writeHead(404, corsHeaders);
      res.end('Script not found');
    }
    return;
  }

  // Serve core.js for tethered mode
  if (pathname === '/core.js') {
    const basePath = getStaticBasePath();
    const filePath = path.join(basePath, 'tethered', 'core.js');
    serveStaticFile(res, filePath);
    return;
  }

  // Serve quick-lookup.js for tethered mode
  if (pathname === '/quick-lookup.js') {
    const basePath = getStaticBasePath();
    const filePath = path.join(basePath, 'tethered', 'quick-lookup.js');
    serveStaticFile(res, filePath);
    return;
  }

  // Serve settings.js - dynamic JavaScript with settings, lang data, localStorage, and word knowledge
  if (pathname === '/settings.js') {
    if (!requireAuth(req, res)) return;
    try {
      const settings = loadSettings();
      const langData = loadLangData();
      const easeHashmap = await getFlashcardEaseMap();
      const flashcardStore = await loadFlashcards();
      
      // Build word-keyed knowledge map from the flashcard store
      // This avoids hash function mismatches between Node and browser crypto
      const wordKnowledgeMap: Record<string, {
        hasFlashcard: boolean;
        bestEase: number;
        bestState: string;
        cardCount: number;
        totalReviews: number;
        bestInterval: number;
      }> = {};
      
      for (const flashcard of Object.values(flashcardStore.flashcards)) {
        const word = flashcard.content?.front;
        if (!word) continue;
        const existing = wordKnowledgeMap[word];
        if (!existing) {
          wordKnowledgeMap[word] = {
            hasFlashcard: true,
            bestEase: flashcard.ease,
            bestState: flashcard.state,
            cardCount: 1,
            totalReviews: flashcard.reviews || 0,
            bestInterval: flashcard.interval || 0,
          };
        } else {
          existing.cardCount++;
          existing.totalReviews += flashcard.reviews || 0;
          if (flashcard.ease > existing.bestEase) existing.bestEase = flashcard.ease;
          if (flashcard.interval > existing.bestInterval) existing.bestInterval = flashcard.interval;
          const stateOrder: Record<string, number> = { 'new': 0, 'learning': 1, 'relearning': 2, 'review': 3 };
          if ((stateOrder[flashcard.state] || 0) > (stateOrder[existing.bestState] || 0)) {
            existing.bestState = flashcard.state;
          }
        }
      }
      
      let js = '';
      js += `globalThis.lang_data = ${JSON.stringify(langData)};\n`;
      const { cloudAuthAccessToken: _a, cloudAuthToken: _b, ...sanitizedSettings } = settings;
      js += `globalThis.settings = ${JSON.stringify(sanitizedSettings)};\n`;
      js += `globalThis.lS = ${JSON.stringify(localStorageData)};\n`;
      js += `globalThis.easeHashmap = ${JSON.stringify(easeHashmap)};\n`;
      js += `globalThis.wordKnowledgeMap = ${JSON.stringify(wordKnowledgeMap)};\n`;
      js += `globalThis.knownUntrackedHashes = ${JSON.stringify(flashcardStore.knownUntracked || {})};\n`;
      js += `globalThis.knownEaseThreshold = ${JSON.stringify(settings.known_ease_threshold)};\n`;
      js += `globalThis.serverProtocol = 'http';\n`;
      
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        ...corsHeaders,
      });
      res.end(js);
    } catch (error) {
      console.error('Error generating settings.js:', error);
      res.writeHead(500, {
        'Content-Type': 'application/javascript',
        ...corsHeaders,
      });
      res.end(`console.error("mLearn: Failed to generate settings.js");`);
    }
    return;
  }

  // Serve light_style.css
  if (pathname === '/light_style.css' || pathname === '/pages/assets/light_style.css') {
    const basePath = getStaticBasePath();
    const filePath = path.join(basePath, 'assets', 'light_style.css');
    serveStaticFile(res, filePath);
    return;
  }

  // Serve assets from /pages/assets/ path (for compatibility with old core.js)
  if (pathname.startsWith('/pages/assets/')) {
    const assetPath = pathname.replace('/pages/assets/', '');
    const basePath = getStaticBasePath();
    const filePath = path.join(basePath, 'assets', assetPath);
    serveStaticFile(res, filePath);
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
        const ankiUrl = settings.ankiConnectUrl || 'http://127.0.0.1:8765';
        
        const response = await fetch(ankiUrl, {
          method: 'POST',
          body: body,
        });
        const data = await response.json();
        sendJsonResponse(res, data);
      } catch (e) {
        console.error('Error forwarding to Anki:', e);
        sendJsonResponse(res, { error: (e as Error).message }, 500);
      }
    });
    return;
  }

  // API: Pills update (GET for compatibility with script injection)
  if (pathname === '/api/pills') {
    const word = query.key;
    const status = parseInt(query.value || '0', 10);
    
    if (word) {
      console.log('Received pill update:', word, status);
      pillQueuedUpdates.push({ word, status });
      flushPillUpdates();
    }
    
    sendJsonResponse(res, { status: 'ok' });
    return;
  }

  // API: Word appearance tracking (GET for compatibility)
  if (pathname === '/api/word-appearance') {
    const word = query.word;
    
    if (word) {
      wordAppearanceQueuedUpdates.push(word);
      flushWordAppearanceUpdates();
    }
    
    sendJsonResponse(res, { status: 'ok' });
    return;
  }

  // API: Attempt flashcard creation (GET for compatibility)
  if (pathname === '/api/attempt-flashcard-creation') {
    const word = query.word;
    let content = query.content;
    
    if (word) {
      try {
        if (content && typeof content === 'string') {
          content = JSON.parse(content);
        }
      } catch (e) {
        console.error(e);
        // Content might not be JSON
      }
      
      attemptFlashcardCreationQueuedUpdates.push({ word, content });
      flushAttemptFlashcardCreationUpdates();
    }
    
    sendJsonResponse(res, { status: 'ok' });
    return;
  }

  // API: Create flashcard (POST with JSON body - HTTP fallback for WebSocket)
  if (pathname === '/api/create-flashcard') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed && parsed.content) {
            createFlashcardQueuedUpdates.push({ content: parsed.content });
            console.log('Create new flashcard (HTTP):', parsed.content);
            flushCreateFlashcardUpdates();
          }
          sendJsonResponse(res, { status: 'ok' });
        } catch (e) {
          console.error(e);
          sendJsonResponse(res, { status: 'error', error: 'Invalid JSON' }, 400);
        }
      });
    } else {
      sendJsonResponse(res, { status: 'ok' });
    }
    return;
  }

  // API: Update last watched (GET with base64 payload)
  if (pathname === '/api/update-last-watched') {
    const payload = query.payload;
    
    if (payload) {
      try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        if (decoded && decoded.action === 'update-last-watched') {
          lastWatchedQueuedUpdates.push({
            name: decoded.name,
            screenshotUrl: decoded.screenshotUrl,
            videoUrl: decoded.videoUrl,
          });
          flushLastWatchedUpdates();
          sendJsonResponse(res, { status: 'ok' });
          return;
        }
      } catch (e) {
        console.error(e);
        // Invalid payload
      }
    }
    
    sendJsonResponse(res, { status: 'error', error: 'Invalid payload' }, 400);
    return;
  }

  // API: Watch together (GET with base64 message)
  if (pathname === '/api/watch-together') {
    const message = query.message;
    
    if (message) {
      try {
        const decoded = Buffer.from(message, 'base64').toString('utf8');
        const parsedMessage = JSON.parse(decoded);
        const encoded = JSON.stringify(parsedMessage);
        broadcastToClients(encoded);
        // Also forward to the desktop renderer so it can react
        getMainWindow()?.webContents.send(IPC_CHANNELS.WATCH_TOGETHER_REQUEST, encoded);
        sendJsonResponse(res, { status: 'ok' });
      } catch (e) {
        console.error(e);
        sendJsonResponse(res, { status: 'error', error: 'Invalid message format' }, 400);
      }
    } else {
      sendJsonResponse(res, { status: 'error', error: 'Missing message parameter' }, 400);
    }
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
      console.error(e);
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
          console.error(e);
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
          console.error(e);
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

  // Default 404
  res.writeHead(404, corsHeaders);
  res.end('Not found');
}

// Handle WebSocket connection
function handleWebSocketConnection(ws: WebSocket): void {
  console.log('WebSocket client connected');
  connectedClients.add(ws);

  ws.on('message', (message: Buffer) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle create-new-flashcard action from tethered mode
      if (data && data.action === 'create-new-flashcard') {
        createFlashcardQueuedUpdates.push({ content: data.content });
        console.log('Create new flashcard:', data.content);
        flushCreateFlashcardUpdates();
        return;
      }
      
      // Handle attempt-flashcard-creation action from tethered mode
      if (data && data.action === 'attempt-flashcard-creation') {
        attemptFlashcardCreationQueuedUpdates.push({ word: data.word, content: data.content });
        flushAttemptFlashcardCreationUpdates();
        return;
      }
      
      // Handle update-last-watched action
      if (data && data.action === 'update-last-watched') {
        lastWatchedQueuedUpdates.push({
          name: data.name,
          screenshotUrl: data.screenshotUrl,
          videoUrl: data.videoUrl,
        });
        console.log('Last watched update:', data);
        flushLastWatchedUpdates();
        return;
      }
      
      // Forward to renderer and broadcast to other WS clients.
      // Messages arrive with an `action` field (play, pause, sync, etc.) from
      // tethered clients acting as watch-together masters, or with a `type`
      // field from future structured messages. Both paths need to reach the
      // renderer AND all other connected clients.
      const raw = message.toString();
      getMainWindow()?.webContents.send(IPC_CHANNELS.WATCH_TOGETHER_REQUEST, raw);
      for (const client of connectedClients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(raw);
        }
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    connectedClients.delete(ws);
  });

  ws.on('error', (error: Error) => {
    console.error('WebSocket error:', error);
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
    console.error('Web server error:', error);
    
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
    console.log(`Web server listening on http://127.0.0.1:${PROXY_SERVER_PORT}`);
  });

  // Setup IPC handlers
  ipcMain.on(IPC_CHANNELS.SEND_LS, (_event, data) => {
    setLocalStorage(data);
  });

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
