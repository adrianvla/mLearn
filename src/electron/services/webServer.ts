/**
 * Web Server Service
 * Provides HTTP/WebSocket server for tethered mode and watch-together functionality
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import { ipcMain } from 'electron';
import { PROXY_SERVER_PORT, IPC_CHANNELS } from '../../shared/constants';
import { getAppPath, getResourcePath } from '../utils/platform';
import { loadSettings } from './settings';
import { loadLangData } from './settings';
import { getMainWindow } from './windowManager';

// Server instances
let httpServer: http.Server | null = null;
let wss: WebSocketServer | null = null;

// Connected WebSocket clients
const connectedClients: Set<WebSocket> = new Set();

// LocalStorage sync data
let localStorageData: Record<string, unknown> = {};

// Queued updates for main window
let pillQueuedUpdates: unknown[] = [];
let wordAppearanceQueuedUpdates: unknown[] = [];
let attemptFlashcardCreationQueuedUpdates: unknown[] = [];
let createFlashcardQueuedUpdates: unknown[] = [];
let lastWatchedQueuedUpdates: unknown[] = [];

// CORS headers
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Send message to all connected WebSocket clients
export function broadcastToClients(message: string): void {
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Flush queued updates to main window
function flushQueuedUpdates(): void {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;

  if (pillQueuedUpdates.length > 0) {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_PILLS, JSON.stringify(pillQueuedUpdates));
    pillQueuedUpdates = [];
  }

  if (wordAppearanceQueuedUpdates.length > 0) {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_WORD_APPEARANCE, JSON.stringify(wordAppearanceQueuedUpdates));
    wordAppearanceQueuedUpdates = [];
  }

  if (attemptFlashcardCreationQueuedUpdates.length > 0) {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_ATTEMPT_FLASHCARD_CREATION, JSON.stringify(attemptFlashcardCreationQueuedUpdates));
    attemptFlashcardCreationQueuedUpdates = [];
  }

  if (createFlashcardQueuedUpdates.length > 0) {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_CREATE_FLASHCARD, JSON.stringify(createFlashcardQueuedUpdates));
    createFlashcardQueuedUpdates = [];
  }

  if (lastWatchedQueuedUpdates.length > 0) {
    mainWindow.webContents.send(IPC_CHANNELS.UPDATE_LAST_WATCHED, JSON.stringify(lastWatchedQueuedUpdates));
    lastWatchedQueuedUpdates = [];
  }
}

// HTTP request handler
function handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url || '/', `http://localhost:${PROXY_SERVER_PORT}`);
  const pathname = url.pathname;

  // Handle OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Serve userscript
  if (pathname === '/mLearn.user.js') {
    const appPath = getAppPath();
    const scriptPath = path.join(appPath, 'scripts', 'userscript.js');
    
    try {
      let script = fs.readFileSync(scriptPath, 'utf-8');
      script = script.replace(/MLEARN_SERVER_URL/g, `http://127.0.0.1:${PROXY_SERVER_PORT}`);
      
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'application/javascript',
      });
      res.end(script);
    } catch (e) {
      res.writeHead(404);
      res.end('Script not found');
    }
    return;
  }

  // Serve tethered frontend assets
  if (pathname.startsWith('/tethered/') || pathname === '/tethered') {
    const appPath = getAppPath();
    const assetPath = pathname === '/tethered' 
      ? path.join(appPath, 'dist', 'tethered', 'index.html')
      : path.join(appPath, 'dist', 'tethered', pathname.replace('/tethered/', ''));
    
    try {
      const content = fs.readFileSync(assetPath);
      const ext = path.extname(assetPath);
      const contentType = getContentType(ext);
      
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': contentType,
      });
      res.end(content);
    } catch (e) {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  // API endpoints
  if (pathname.startsWith('/api/')) {
    handleApiRequest(req, res, pathname);
    return;
  }

  // Serve light_style.css for tethered mode
  if (pathname === '/light_style.css') {
    const appPath = getAppPath();
    const cssPath = path.join(appPath, 'dist', 'tethered', 'light_style.css');
    
    try {
      const css = fs.readFileSync(cssPath, 'utf-8');
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'text/css',
      });
      res.end(css);
    } catch (e) {
      res.writeHead(404);
      res.end('CSS not found');
    }
    return;
  }

  // Default 404
  res.writeHead(404, corsHeaders);
  res.end('Not found');
}

// Handle API requests
function handleApiRequest(
  req: http.IncomingMessage, 
  res: http.ServerResponse, 
  pathname: string
): void {
  if (req.method !== 'POST') {
    res.writeHead(405, corsHeaders);
    res.end('Method not allowed');
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      const data = body ? JSON.parse(body) : {};
      
      switch (pathname) {
        case '/api/settings':
          const settings = loadSettings();
          sendJsonResponse(res, settings);
          break;
          
        case '/api/lang-data':
          const langData = loadLangData();
          sendJsonResponse(res, langData);
          break;
          
        case '/api/update-pills':
          pillQueuedUpdates.push(data);
          flushQueuedUpdates();
          sendJsonResponse(res, { success: true });
          break;
          
        case '/api/update-word-appearance':
          wordAppearanceQueuedUpdates.push(data);
          flushQueuedUpdates();
          sendJsonResponse(res, { success: true });
          break;
          
        case '/api/attempt-flashcard-creation':
          attemptFlashcardCreationQueuedUpdates.push(data);
          flushQueuedUpdates();
          sendJsonResponse(res, { success: true });
          break;
          
        case '/api/create-flashcard':
          createFlashcardQueuedUpdates.push(data);
          flushQueuedUpdates();
          sendJsonResponse(res, { success: true });
          break;
          
        case '/api/update-last-watched':
          lastWatchedQueuedUpdates.push(data);
          flushQueuedUpdates();
          sendJsonResponse(res, { success: true });
          break;
          
        case '/api/fwd-to-anki':
          // Forward request to Anki Connect
          forwardToAnki(data, res);
          break;
          
        default:
          res.writeHead(404, corsHeaders);
          res.end('API endpoint not found');
      }
    } catch (e) {
      console.error('API error:', e);
      res.writeHead(500, corsHeaders);
      res.end('Internal server error');
    }
  });
}

// Send JSON response
function sendJsonResponse(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, {
    ...corsHeaders,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(data));
}

// Forward request to Anki Connect
function forwardToAnki(data: unknown, res: http.ServerResponse): void {
  const settings = loadSettings();
  const url = new URL(settings.ankiConnectUrl);
  
  const options = {
    hostname: url.hostname,
    port: url.port || 8765,
    path: '/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const ankiReq = http.request(options, (ankiRes) => {
    let body = '';
    ankiRes.on('data', (chunk) => { body += chunk; });
    ankiRes.on('end', () => {
      try {
        sendJsonResponse(res, JSON.parse(body));
      } catch (e) {
        res.writeHead(500, corsHeaders);
        res.end('Failed to parse Anki response');
      }
    });
  });

  ankiReq.on('error', (e) => {
    res.writeHead(502, corsHeaders);
    res.end(`Failed to connect to Anki: ${e.message}`);
  });

  ankiReq.write(JSON.stringify(data));
  ankiReq.end();
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
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  };
  return types[ext] || 'application/octet-stream';
}

// Handle WebSocket connection
function handleWebSocketConnection(ws: WebSocket): void {
  console.log('WebSocket client connected');
  connectedClients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle watch-together messages
      if (data.type === 'watch-together') {
        getMainWindow()?.webContents.send(IPC_CHANNELS.WATCH_TOGETHER_REQUEST, JSON.stringify(data));
        // Broadcast to other clients
        for (const client of connectedClients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(message.toString());
          }
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

  ws.on('error', (error) => {
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

  httpServer.listen(PROXY_SERVER_PORT, () => {
    console.log(`Web server listening on http://127.0.0.1:${PROXY_SERVER_PORT}`);
  });

  // Setup IPC handlers
  ipcMain.on(IPC_CHANNELS.SEND_LS, (_event, data) => {
    localStorageData = data;
  });

  ipcMain.on(IPC_CHANNELS.WATCH_TOGETHER_SEND, (_event, message) => {
    broadcastToClients(message);
  });
}

// Stop web server
export function stopWebServer(): void {
  if (wss) {
    wss.close();
    wss = null;
  }
  
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  
  connectedClients.clear();
}
