import http from "http";
import url from "url";
import {mainWindow} from "./allWindows.js";
import path from "node:path";
import {resPath} from "./archPlatform.js";
import { appPath } from "./archPlatform.js";
import fs from "node:fs";
import https from "https";
import {app, ipcMain} from "electron";
import { WebSocketServer, WebSocket } from 'ws';
import {loadLangData} from "./langData.js";
import {loadSettings} from "./settings.js";
import {flashcardsToEaseHashmap} from "./flashcardStorage.js";

const PORT = 7753;
let server;
let HTTPServer;
let lS = {};
let pillQueuedUpdates = [];
let wordAppearanceQueuedUpdates = [];
let attemptFlashcardCreationQueuedUpdates = [];
let createFlashcardQueuedUpdates = [];
let lastWatchedQueuedUpdates = [];
// Best-effort: trust a PEM cert on macOS System keychain once (prompts for admin pwd)
const trustCertOnMac = (certFilePath) => {
    try {
        if (process.platform !== 'darwin') return;
        if (!fs.existsSync(certFilePath)) return;
        const markerDir = path.join(app.getPath('userData'), 'certs');
        const marker = path.join(markerDir, '.trusted');
        try { fs.mkdirSync(markerDir, { recursive: true }); } catch {}
        if (fs.existsSync(marker)) return;
        // AppleScript tries System keychain first, then login keychain as fallback
        const esc = certFilePath.replace(/"/g, '\\"');
        const osaArgs = [
            '-e', `set certPosix to "${esc}"`,
            '-e', 'set cmd1 to "security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain " & quoted form of certPosix',
            '-e', 'set cmd2 to "security add-trusted-cert -p ssl -k ~/Library/Keychains/login.keychain-db " & quoted form of certPosix',
            '-e', 'try',
            '-e', '  do shell script cmd1 with administrator privileges',
            '-e', 'on error err1',
            '-e', '  try',
            '-e', '    do shell script cmd2',
            '-e', '  on error err2',
            '-e', '    error err1 & "\n" & err2',
            '-e', '  end try',
            '-e', 'end try'
        ];
        const osa = spawn('osascript', osaArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        osa.stdout.on('data', d => { stdout += d.toString(); });
        osa.stderr.on('data', d => { stderr += d.toString(); });
        osa.on('exit', (code) => {
            const combined = (stdout + '\n' + stderr).toLowerCase();
            const duplicate = combined.includes('already exists') || combined.includes('duplicate');
            if (code === 0 || duplicate) {
                try { fs.writeFileSync(marker, String(Date.now())); } catch {}
                console.log('mLearn: localhost certificate trusted' + (duplicate ? ' (already trusted)' : '') + '.');
            } else {
                console.warn('mLearn: failed to trust certificate (osascript exit code ' + code + '). Output:\n' + (stdout + stderr));
                // If UI interaction isn’t possible (error -2700), open Terminal to run the command interactively
                if (combined.includes('-2700') || combined.includes('no user interaction')) {
                    try {
                        const termArgs = [
                            '-e', `set certPosix to "${esc}"`,
                            '-e', 'tell application "Terminal" to activate',
                            '-e', 'tell application "Terminal" to do script "sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain " & quoted form of certPosix'
                        ];
                        spawn('osascript', termArgs, { detached: true, stdio: 'ignore' }).unref();
                        console.warn('mLearn: opened Terminal to run the trust command. Please enter your password in the Terminal window, then reload the page.');
                    } catch (e2) {
                        console.warn('mLearn: failed to open Terminal for trust command:', e2?.message || e2);
                    }
                }
            }
        });
    } catch (e) {
        try { console.warn('mLearn: trustCertOnMac error:', e?.message || e); } catch(_) {}
    }
};
let sockets = [];
// let isAllowed = false;

const getServerProtocol = () => 'http'

// function setAllowed(to) {
//     isAllowed = to;
// }

function setLocalStorage(data) {
    lS = data;
}

const sendMessageToAllClients = (message) => {
    for (let socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(message);
        }
    }
};


const sendPillUpdatesToMainWindow = () => {
    if(pillQueuedUpdates.length === 0) return;
    console.log("Sending queued updates to main window pills",pillQueuedUpdates);
    mainWindow.webContents.send('update-pills',JSON.stringify(pillQueuedUpdates));
    pillQueuedUpdates = [];
};

const sendWordAppearanceUpdatesToMainWindow = () => {
    if(wordAppearanceQueuedUpdates.length === 0) return;
    console.log("Sending queued updates to main window wordAppearance",wordAppearanceQueuedUpdates);
    mainWindow.webContents.send('update-word-appearance',JSON.stringify(wordAppearanceQueuedUpdates));
    wordAppearanceQueuedUpdates = [];
}
const sendAttemptFlashcardCreationUpdatesToMainWindow = () => {
    if(attemptFlashcardCreationQueuedUpdates.length === 0) return;
    console.log("Sending queued updates to main window flashcardCreationAttempts",attemptFlashcardCreationQueuedUpdates);
    mainWindow.webContents.send('update-attempt-flashcard-creation',JSON.stringify(attemptFlashcardCreationQueuedUpdates));
    attemptFlashcardCreationQueuedUpdates = [];
}
const sendCreateFlashcardUpdatesToMainWindow = () => {
    if(createFlashcardQueuedUpdates.length === 0) return;
    console.log("Sending queued updates to main window createFlashcardUpdates",createFlashcardQueuedUpdates);
    mainWindow.webContents.send('update-create-flashcard',JSON.stringify(createFlashcardQueuedUpdates));
    createFlashcardQueuedUpdates = [];
}
const sendLastWatchedUpdatesToMainWindow = () => {
    if(lastWatchedQueuedUpdates.length === 0) return;
    console.log("Sending queued updates to main window last-watched", lastWatchedQueuedUpdates);
    mainWindow.webContents.send('update-last-watched', JSON.stringify(lastWatchedQueuedUpdates));
    lastWatchedQueuedUpdates = [];
}

function getHostAndPort(url) {
    try {
        const parsed = new URL(url);
        return [parsed.hostname, parsed.port];
    } catch (e) {
        return [null, null]; // in case of invalid URL
    }
}
const startWebSocketServer = async () => {
    if(server) return;
    // HTTPS disabled: use plain HTTP only
    const requestHandler = (req, res) => {
        if (req.method === 'OPTIONS') {
            // Handle preflight CORS requests
            res.writeHead(204, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': 86400, // Cache the preflight response for 24 hours
            });
            return res.end();
        }

        if (req.method === 'GET' && req.url.startsWith('/api/pills')) {
            const query = url.parse(req.url, true).query;
            // query.key and query.value are available here
            console.log('Received pill:', query.key, query.value);
            pillQueuedUpdates.push({word: query.key, status: query.value});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
            console.log("Is main window destroyed?", mainWindow.isDestroyed());
            if(!mainWindow.isDestroyed()) sendPillUpdatesToMainWindow();
            return;
        }

        if (req.method === 'GET' && req.url.startsWith('/api/word-appearance')) {
            const query = url.parse(req.url, true).query;
            // query.key and query.value are available here
            wordAppearanceQueuedUpdates.push(query.word);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
            if(!mainWindow.isDestroyed()) sendWordAppearanceUpdatesToMainWindow();
            return;
        }
        if (req.method === 'GET' && req.url.startsWith('/api/attempt-flashcard-creation')) {
            const query = url.parse(req.url, true).query;
            // query.key and query.value are available here
            attemptFlashcardCreationQueuedUpdates.push({word: query.word, content: query.content});
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
            if(!mainWindow.isDestroyed()) sendAttemptFlashcardCreationUpdatesToMainWindow();
            return;
        }

        if (req.method === 'GET' && req.url.startsWith('/api/update-last-watched')) {
            const query = url.parse(req.url, true).query;
            try{
                const decoded = JSON.parse(Buffer.from(query.payload || '', 'base64').toString('utf8'));
                if(decoded && decoded.action === 'update-last-watched'){
                    lastWatchedQueuedUpdates.push({ name: decoded.name, screenshotUrl: decoded.screenshotUrl, videoUrl: decoded.videoUrl });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok' }));
                    if(!mainWindow.isDestroyed()) sendLastWatchedUpdatesToMainWindow();
                    return;
                }
            }catch(e){
                // fallthrough to 400 below
            }
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', error: 'Invalid payload' }));
            return;
        }

        // Handle /api/watch-together GET requests
        if (req.method === 'GET' && req.url.startsWith('/api/watch-together')) {
            const query = url.parse(req.url, true).query;
            if (query.message) {
                try {
                    const decoded = Buffer.from(query.message, 'base64').toString('utf8');
                    const message = JSON.parse(decoded);
                    console.log('Received message from client:', message);
                    sendMessageToAllClients(JSON.stringify(message));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok' }));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'error', error: 'Invalid message format' }));
                }
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', error: 'Missing message parameter' }));
            }
            return;
        }
        if (req.url === '/') {
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Access-Control-Allow-Origin': '*',
            });
            res.end('<!doctypehtml><html lang="en"><meta charset="UTF-8"><meta content="IE=edge" http-equiv="X-UA-Compatible"><meta content="width=device-width,initial-scale=1"name="viewport"><title>mLearn Backend</title><style>body{background:#222;color:#ccc;font-family:"Helvetica Neue",sans-serif}a{color:#ff0}</style><h1>mLearn Backend</h1><p>Hi, this is the mLearn Backend server, nothing to see here.<br>This server responds to HTTP requests made by the Injected mLearn Application, as well as by the Tethered version of mLearn for Mobile.<br>This server also responds to WebSockets, a feature used by mLearn\'s Watch Together feature.<p>Are you trying to use Watch Together and accidentally clicked on this link?<br>Go <a href="https://mlearn.morisinc.net/watch-together">here</a> to connect and paste this link (<span id="current_url"></span>) there.</p><p>If you want to install the mLearn Mobile UserScript for use in Tethered Mode, please click <a href="/mLearn.user.js" id="installUserscript">here</a>.</p><script>document.getElementById("current_url").innerText=window.location</script>');
            return;
        } else if (req.url === "/mLearn.user.js"){
            const filePath = path.join(appPath, 'modules', 'scripts', 'userscript.js');
            if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                    'Content-Type': 'application/javascript',
                    'Access-Control-Allow-Origin': '*',
                });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        } else if (req.url.startsWith('/forward/')) {
            const forwardPath = req.url.replace('/forward/', '/');
            const tokeniserUrl = loadSettings().tokeniserUrl || '';
            let [hostname, port] = getHostAndPort(tokeniserUrl);
            const options = {
                hostname,
                port: parseInt(port),
                path: forwardPath,
                method: req.method,
                headers: req.headers
            };

            const forwardClient = (tokeniserUrl || '').startsWith('https') ? https : http;
            const proxyReq = forwardClient.request(options, (proxyRes) => {
                res.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(res, { end: true });
            });

            req.pipe(proxyReq, { end: true });

            proxyReq.on('error', (err) => {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('Proxy error: ' + err.message);
            });
            return;
        } else if (req.url === '/core.js') {
            const filePath = path.join(appPath, 'pages', 'tethered', 'core.js');
            if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                    'Content-Type': 'application/javascript',
                    'Access-Control-Allow-Origin': '*',
                });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        } else if (req.url === '/quick-lookup.js') {
            const filePath = path.join(appPath, 'pages', 'tethered', 'quick-lookup.js');
            if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                    'Content-Type': 'application/javascript',
                    'Access-Control-Allow-Origin': '*',
                });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        } else if (req.url === '/settings.js') {
            let settingsToSend = loadSettings();
            let s = "";
            s += `globalThis.lang_data = ${JSON.stringify(loadLangData())};\n`;
            s += `globalThis.settings = ${JSON.stringify(settingsToSend)};\n`;
            s += `globalThis.lS = ${JSON.stringify(lS)};\n`;
            s += `globalThis.easeHashmap = ${JSON.stringify(flashcardsToEaseHashmap())};\n`;
            s += `globalThis.serverProtocol = 'http';\n`;
            res.writeHead(200, {
                'Content-Type': 'application/javascript',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(s);
            return;
        } else if (req.url.startsWith('/pages/')) {
            // Serve static files from the 'assets' folder
            const filePath = path.join(appPath, req.url);
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                const ext = path.extname(filePath).toLowerCase();
                const mimeTypes = {
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.png': 'image/png',
                    '.gif': 'image/gif',
                    '.svg': 'image/svg+xml',
                    '.js': 'application/javascript',
                    '.css': 'text/css',
                };

                const contentType = mimeTypes[ext] || 'application/octet-stream';
                res.writeHead(200, { 'Content-Type': contentType });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        } else if (req.url.startsWith('/modules/')) {
            const modulePath = req.url.replace('/modules/', '');
            const filePath = path.join(appPath, 'pages', 'modules', modulePath);
            if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                    'Content-Type': 'application/javascript',
                    'Access-Control-Allow-Origin': '*'
                });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        } else if (req.url.startsWith('/lib/')) {
            const modulePath = req.url.replace('/lib/', '');
            const filePath = path.join(appPath, 'pages', 'lib', modulePath);
            if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                    'Content-Type': 'application/javascript',
                    'Access-Control-Allow-Origin': '*'
                });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        } else if (req.url.startsWith('/assets/')) {
            const modulePath = req.url.replace('/assets/', '');
            const filePath = path.join(appPath, 'pages', 'assets', modulePath);
            if (fs.existsSync(filePath)) {
                res.writeHead(200, {
                    'Access-Control-Allow-Origin': '*'
                });
                fs.createReadStream(filePath).pipe(res);
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('File not found');
            }
            return;
        } else if (req.url.startsWith('/?url=')) {
            const query = url.parse(req.url, true).query;
            let targetUrl = query.url; // Extract the target URL from the query string

            if (!targetUrl) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                return res.end('Missing "url" query parameter');
            }

            // Add protocol if missing
            if (!/^https?:\/\//i.test(targetUrl)) {
                targetUrl = 'https://' + targetUrl;
            }

            // Determine the protocol (http or https)
            const client = targetUrl.startsWith('https') ? https : http;

            // Forward the request to the target server
            client.get(targetUrl, (targetRes) => {
                // Override any conflicting CORS headers from the target server
                res.writeHead(targetRes.statusCode, {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Content-Type': targetRes.headers['content-type'] || 'application/octet-stream',
                });

                // Pipe the response back to the client
                targetRes.pipe(res);
            }).on('error', (err) => {
                // Handle errors
                res.writeHead(500, {
                    'Content-Type': 'text/plain',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                });
                res.end(`Error: ${err.message}`);
            });
        } else {
            // Redirect to the main page
            res.writeHead(302, {
                'Location': '/',
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            });
            res.end('Redirecting to main page...');
        }
    };
    HTTPServer = http.createServer(requestHandler);
    server = new WebSocketServer({ /*port: PORT,*/noServer:true });
    server.on('connection', (ws) => {
        sockets.push(ws);
        ws.on('message', (message) => {
            console.log(`Received message => ${message}`);
            try {
                const msg = JSON.parse(message);
                if (msg && msg.action === 'attempt-flashcard-creation') {
                    attemptFlashcardCreationQueuedUpdates.push({ word: msg.word, content: msg.content });
                    console.log("Attempt: ", msg.word, msg.content);
                    if(!mainWindow.isDestroyed()) sendAttemptFlashcardCreationUpdatesToMainWindow();
                    return;
                }
            } catch (e) {
                // not JSON or not our action; forward to renderer as legacy request
            }
            try{
                const msg = JSON.parse(message);
                if (msg && msg.action === 'update-last-watched') {
                    lastWatchedQueuedUpdates.push({ name: msg.name, screenshotUrl: msg.screenshotUrl, videoUrl: msg.videoUrl });
                    console.log("last watched update: ", msg);
                    if(!mainWindow.isDestroyed()) sendLastWatchedUpdatesToMainWindow();
                    return;
                }
            }catch(e){
                // ignore
            }
            try{
                //sendCreateFlashcardUpdatesToMainWindow
                const msg = JSON.parse(message);
                if (msg && msg.action === 'create-new-flashcard') {
                    createFlashcardQueuedUpdates.push({ content: msg.content });
                    console.log("create new flashcard: ", msg.content);
                    if(!mainWindow.isDestroyed()) sendCreateFlashcardUpdatesToMainWindow();
                    return;
                }
            } catch(e) {

            }
            mainWindow.webContents.send('watch-together-request', message);
        });
    });

    HTTPServer.on('upgrade', (req, socket, head) => {
        server.handleUpgrade(req, socket, head, (ws) => {
            server.emit('connection', ws, req);
        });
    });
    HTTPServer.listen(PORT, () => {
    console.log(`Watch Together running on http://localhost:${PORT}`);
    });
};


ipcMain.on('send-ls', (event, data) => {
    //receive localStorage
    setLocalStorage(data);

    //window is ready, try to send queued updates
    sendPillUpdatesToMainWindow();
    sendWordAppearanceUpdatesToMainWindow();
    sendAttemptFlashcardCreationUpdatesToMainWindow();
});

ipcMain.on('watch-together-send', (event, message) => {
    sendMessageToAllClients(JSON.stringify(message));
});

ipcMain.on('is-watching-together', (event) => {
    event.reply('watch-together', 'ping');
});
export {startWebSocketServer, setLocalStorage,sendPillUpdatesToMainWindow, PORT, getServerProtocol};