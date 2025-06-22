const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn, exec } = require('child_process');
const tar = require('tar');
const unzipper = require('unzipper');
const url = require('url');
const isPackaged = app.isPackaged;
const resPath = isPackaged ? path.join(process.resourcesPath, "app") : __dirname;
const WebSocket = require('ws');
const PORT = 7753;

console.log("Is packaged", isPackaged, "Version", app.getVersion(),"Path",app.getPath('userData'));


const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const isMac = process.platform === 'darwin';
const DEFAULT_SETTINGS = {
    "known_ease_threshold": 1500,
    "blur_words": false,
    "blur_known_subtitles": false,
    "blur_amount":5,
    "colour_known":"#cceec9",
    "do_colour_known":true,
    "do_colour_codes":true,
    "colour_codes":{},
    "dark_mode":true,
    "hover_known_get_from_dictionary":false,
    "show_pos":true,
    "language":"ja",
    "use_anki":true,
    "furigana":true,
    "enable_flashcard_creation":true,
    "flashcard_deck":null,
    "getCardUrl" : "http://127.0.0.1:8000/getCard",
    "tokeniserUrl" : "http://127.0.0.1:8000/tokenize",
    "getTranslationUrl" : "http://127.0.0.1:8000/translate",
    "ankiUrl" : "http://127.0.0.1:8000/fwd-to-anki",
    "ankiConnectUrl": "http://127.0.0.1:8765",
    "openAside":false,
    "subsOffsetTime":0,
    "immediateFetch":false,
    "subtitleTheme":"shadow",
    "subtitle_font_size":40
};
const ARCHITECTURE = os.arch();
const PLATFORM = os.platform();
const downloadPath = path.join(resPath, 'python.tar.gz');
const extractPath = path.join(resPath, 'py');
const envPath = path.join(resPath, 'env');
const tempDir = path.join(resPath, 'temp');
const updateZipPath = path.join(tempDir, 'update.zip');
const extractDir = path.join(tempDir, 'mLearn-main');
const updateURL = "https://mlearn-update.morisinc.net/version-info.json";
const updateDownloadUrl = "https://github.com/adrianvla/mLearn/archive/refs/heads/main.zip";
const BASE_URL = 'https://github.com/adrianvla/packaged-python/raw/refs/heads/main/';

let lang_data = {};
let mainWindow;
let isWindows = false;
let pythonChildProcess;
let isSettingUp = false;
let isFirstTimeSetup = false;
let currentWindow = null;
let pythonSuccessInstall = false;
let pythonUrl;
let oldWindowState = {width:null, height:null, fullscreen:false, trafficLights:true};
let server;
let HTTPServer;
let sockets = [];
let lS = {};
let pillQueuedUpdates = [];


console.log(ARCHITECTURE, PLATFORM);
if (PLATFORM === 'darwin' && ARCHITECTURE === 'x64') {
    pythonUrl = `${BASE_URL}x86_64-apple-darwin-install_only.tar.gz`;
} else if (PLATFORM === 'darwin' && ARCHITECTURE === 'arm64') {
    pythonUrl = `${BASE_URL}aarch64-apple-darwin-install_only.tar.gz`;
} else if ((PLATFORM === 'win32' && ARCHITECTURE === 'x64') || (PLATFORM === 'win64' && ARCHITECTURE === 'x64') || (PLATFORM === 'win' && ARCHITECTURE === 'x64') || (PLATFORM === 'win32' && ARCHITECTURE === 'x86') || (PLATFORM === 'win64' && ARCHITECTURE === 'x86') || (PLATFORM === 'win' && ARCHITECTURE === 'x86') || (PLATFORM === 'win32' && ARCHITECTURE === 'arm64') || (PLATFORM === 'win64' && ARCHITECTURE === 'arm64') || (PLATFORM === 'win' && ARCHITECTURE === 'arm64') || (PLATFORM === 'win32' && ARCHITECTURE === 'arm') || (PLATFORM === 'win64' && ARCHITECTURE === 'arm') || (PLATFORM === 'win' && ARCHITECTURE === 'arm') || (PLATFORM === 'win32' && ARCHITECTURE === 'amd64') || (PLATFORM === 'win64' && ARCHITECTURE === 'amd64') || (PLATFORM === 'win' && ARCHITECTURE === 'amd64')) {
    pythonUrl = `${BASE_URL}x86_64-pc-windows-msvc-install_only.tar.gz`;
    isWindows = true;
} else if (PLATFORM === 'linux' && ARCHITECTURE === 'x64') {
    pythonUrl = `${BASE_URL}x86_64-unknown-linux-gnu-install_only.tar.gz`;
} else {
    console.error('Unsupported platform or architecture');
    process.exit(1);
}
pythonUrl+="?download=";

const makeMainWindowPIP = (w,h) => {
    oldWindowState.width = mainWindow.getBounds().width;
    oldWindowState.height = mainWindow.getBounds().height;
    oldWindowState.fullscreen = mainWindow.isFullScreen();
    mainWindow.setBounds({ width: w, height: h, x: 50, y: 50 },true); // Adjust size and position
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.setResizable(true); // Allow resizing if desired
    mainWindow.setFocusable(false); // Optional: Prevent focus on PiP mode
    mainWindow.setFullScreenable(false); // Disable fullscreen
    mainWindow.setMinimizable(false); // Disable minimize
    mainWindow.setWindowButtonVisibility(false);
    mainWindow.setFullScreen(false);
};

const makeMainWindowNormal = () => {
    mainWindow.setBounds({ width: oldWindowState.width, height: oldWindowState.height },true); // Adjust size and position
    mainWindow.setAlwaysOnTop(false); // Disable always on top
    mainWindow.setResizable(true); // Allow resizing
    mainWindow.setFocusable(true); // Allow focus
    mainWindow.setFullScreenable(true); // Enable fullscreen
    mainWindow.setMinimizable(true); // Enable minimize
    mainWindow.setWindowButtonVisibility(oldWindowState.trafficLights);
    mainWindow.setFullScreen(oldWindowState.fullscreen);
};
const sendPillUpdatesToMainWindow = () => {
    if(pillQueuedUpdates.length === 0) return;
    console.log("Sending queued updates to main window",pillQueuedUpdates);
    mainWindow.webContents.send('update-pills',JSON.stringify(pillQueuedUpdates));
    pillQueuedUpdates = [];
};

const startWebSocketServer = () => {
    if(server) return;
    HTTPServer = http.createServer((req, res) => {
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

        if (req.url === '/core.js') {
            const filePath = path.join(resPath, 'pages', 'core.js');
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
        } else if (req.url === '/settings.js') {
            let s = "";
            s += `window.lang_data = ${JSON.stringify(loadLangData())};\n`;
            s += `window.settings = ${JSON.stringify(loadSettings())};\n`;
            s += `window.lS = ${JSON.stringify(lS)};\n`;
            res.writeHead(200, {
                'Content-Type': 'application/javascript',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(s);
        } else if (req.url.startsWith('/pages/')) {
            // Serve static files from the 'assets' folder
            const filePath = path.join(resPath, req.url);
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
            // Respond with 426 if a non-WebSocket and non-Proxy request is made
            res.writeHead(426, {
                'Content-Type': 'text/plain',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            });
            res.end('Upgrade Required');
        }
    });
    server = new WebSocket.Server({ /*port: PORT,*/noServer:true });
    server.on('connection', (ws) => {
        sockets.push(ws);
        ws.on('message', (message) => {
            console.log(`Received message => ${message}`);
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

const sendMessageToAllClients = (message) => {
    for (let socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(message);
        }
    }
};


const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        webPreferences: {
            preload: path.join(resPath, '/pages/preload.js')
        },
        titleBarStyle: isMac ? 'hidden' : 'hiddenInset'
    });
    mainWindow.loadFile('pages/index.html');
    currentWindow = mainWindow;
}
const createWelcomeWindow = () => {

    let welcomeWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(resPath, '/pages/preload.js')
        }
    });
    welcomeWindow.loadFile('pages/welcome.html');
    currentWindow = welcomeWindow;
};

const createUpdateWindow = () => {
    let updateWindow = new BrowserWindow({
        width: 800,
        height: 400,
        webPreferences: {
            preload: path.join(resPath, '/pages/preload.js')
        }
    });
    updateWindow.loadFile('pages/update.html');
    currentWindow = updateWindow;
};
const firstTimeSetup = () => {
    isFirstTimeSetup = true;
    if(isSettingUp) return;
    isSettingUp = true;
    createWelcomeWindow();
};
app.whenReady().then(() => {
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if(isFirstTimeSetup){
                createWelcomeWindow();
            }else{
                createWindow();
            }
        }
    });
    if(isFirstTimeSetup){
        firstTimeSetup();
        return;
    }
    if(isPackaged){
        // checkForUpdates();
    }
    createWindow();

})
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        console.log("Tried to quit, pythonSuccessInstall=",pythonSuccessInstall);
        if(!pythonSuccessInstall) return;
        pythonChildProcess.kill("SIGINT");
        app.quit();
    }
});
const checkForUpdates = () => {
    const currentVersion = app.getVersion();
    https.get(updateURL, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            const updates = JSON.parse(data);
            console.log(updates);
            if (updates.latest !== currentVersion) {
                console.log('Update available');
                // mainWindow.webContents.send('update-available', updates);
                //use dialog to show update available
                const options = {
                    type: 'question',
                    buttons: ['Cancel', 'Update'],
                    defaultId: 1,
                    title: 'Update available',
                    message: `Do you want to update to version ${updates.latest}?`,
                    detail: updates.changelog
                };
                dialog.showMessageBox(null, options).then((response) => {
                    if(response.response === 1){
                        createUpdateWindow();
                        //download the update in .zip format
                        downloadFile(updateDownloadUrl, updateZipPath, () => {
                            // Extract the zip in /temp
                            currentWindow.webContents.send('server-status-update', 'Extracting update');
                            fs.createReadStream(updateZipPath)
                                .pipe(unzipper.Extract({ path: tempDir }))
                                .on('close', () => {
                                    console.log('Update extracted');
                                    currentWindow.webContents.send('server-status-update', 'Update extracted');
                                    // Move contents from /temp/mLearn-main to resPath
                                    moveContents(extractDir, resPath);
                                    console.log('Update moved to application directory');
                                    currentWindow.webContents.send('server-status-update', 'Overwritten application files with updated ones');
                                    currentWindow.webContents.send('server-status-update', 'Update complete.');
                                });
                        });

                    }
                });
            }
        });
    }).on('error', (err) => {
        console.error(`Error checking for updates: ${err.message}`);
    });
};

const saveSettings = (settings) => {
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
};


const loadSettings = () => {
    //if file exists
    if(JSON.stringify(lang_data)==="{}"){
        loadLangData();
    }
    if (fs.existsSync(settingsPath)) {
        let settings = JSON.parse(fs.readFileSync(settingsPath));
        const checkSettings = () => {
            //check if every setting is present
            for(let key in DEFAULT_SETTINGS){
                if(!(key in settings)){
                    settings[key] = DEFAULT_SETTINGS[key];
                }
            }
            //fix settings
            for(let key in lang_data[settings.language].fixed_settings){
                settings[key] = lang_data[settings.language].fixed_settings[key];
            }
        };
        checkSettings();
        saveSettings(settings);
        return settings;
        // return JSON.parse(fs.readFileSync(settingsPath));
    }else{
        //create file
        isFirstTimeSetup = true;
        saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
};

const loadPipRequirements = () => {
    return JSON.parse(fs.readFileSync(path.join(resPath, 'pip_requirements.json')));
};



const loadLangData = () => {
    console.log("Loading lang data");
    //scan the languages directory and load the json files
    const langDir = path.join(resPath, 'languages');
    const files = fs.readdirSync(langDir);
    for (let file of files) {
        //read files ending in .json
        if (file.endsWith('.json')) {
            let lang = file.split('.')[0];
            lang_data[lang] = JSON.parse(fs.readFileSync(path.join(langDir, file)));
        }
    }
    return lang_data;
};

ipcMain.on('get-settings', (event) => {
    event.reply('settings', loadSettings());
});
ipcMain.on('send-ls', (event, data) => {
    //receive localStorage
    lS = data;

    //window is ready, try to send queued updates
    sendPillUpdatesToMainWindow();
});

ipcMain.on('save-settings', (event, settings) => {
    saveSettings(settings);
    event.reply('settings-saved', 'Settings saved successfully');
});

ipcMain.on('get-lang-data', (event) => {
    event.reply('lang-data', loadLangData());
});
ipcMain.on('is-watching-together', (event) => {
    event.reply('watch-together', 'ping');
});

ipcMain.on('traffic-lights', (event, arg) => {
    if(!isWindows)
        mainWindow.setWindowButtonVisibility(arg.visibility);
    oldWindowState.trafficLights = arg.visibility;
});
ipcMain.on('watch-together-send', (event, message) => {
    sendMessageToAllClients(JSON.stringify(message));
});
ipcMain.on('is-successful-install', (event) => {
    event.reply('successful-install', pythonSuccessInstall);
});
ipcMain.on('install-lang', (event, u) => {
    try{
        downloadFile(u, path.join(resPath, 'temp', 'temp.json'), () => {
            let lang;
            try{
                lang = JSON.parse(fs.readFileSync(path.join(resPath, 'temp', 'temp.json')));
            }catch(e){
                currentWindow.webContents.send('lang-install-error', "Error: Invalid JSON file");
                return;
            }
            //download lang.py
            if(lang.json && lang.lang_py && lang.lang)
                downloadFile(lang.lang_py, path.join(resPath, 'languages', lang.lang+'.py'), () => {
                    //write lang.json
                    fs.writeFileSync(path.join(resPath, 'languages', lang.lang + '.json'), JSON.stringify(lang.json));
                    //delete temp.json
                    fs.unlinkSync(path.join(resPath, 'temp', 'temp.json'));
                    //load lang data
                    loadLangData();
                    //send message to renderer
                    currentWindow.webContents.send('lang-installed', lang.lang);
                });
            else
                currentWindow.webContents.send('lang-install-error', "Error: Make sure the specified language file is valid and has all the fields required.");
        });
    }catch(e){
        currentWindow.webContents.send('lang-install-error', "Error: Invalid URL");
    }
});

ipcMain.on('changeWindowSize', (event, arg) => {
    mainWindow.setSize(arg.width, arg.height, true);
});
ipcMain.on('make-pip', (event, arg) => {
    makeMainWindowPIP(arg.width, arg.height);
});
ipcMain.on('make-normal', (event) => {
    makeMainWindowNormal();
});
ipcMain.on('show-ctx-menu', (event) => {
    const template = [
        {
            label: 'Sync Subtitles with Video',
            click: () => { event.sender.send('ctx-menu-command', 'sync-subs') }
        },
        {
            label: 'Open Live Word Translator',
            click: () => {mainWindow.webContents.send('show-aside');}
        },
        {
            type: 'separator'
        },
        {
            label: 'Copy Subtitle',
            click: () => { event.sender.send('ctx-menu-command', 'copy-sub') }
        }
        // { type: 'separator' },
        // { label: 'Menu Item 2', type: 'checkbox', checked: true }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});
ipcMain.on('write-to-clipboard', (event, text)=>{
    clipboard.writeText(text);
});
ipcMain.on('show-contact', (event) => {
    require("electron").shell.openExternal("https://morisinc.net/");
});
const restartApp = () => {
    if(!serverLoaded) return;
    pythonChildProcess.kill("SIGINT");
    console.log("Restarting app");
    setTimeout(() => {
        app.relaunch();
        app.exit();
    },1000);

};
const restartAppForce = () => {
    if(pythonChildProcess)
        pythonChildProcess.kill("SIGINT");
    console.log("Restarting app");
    setTimeout(() => {
        app.relaunch();
        app.exit();
    },1000);
};
ipcMain.on('restart-app', (event) => {
    restartApp();
});
ipcMain.on('restart-app-force',(event)=>{
    restartAppForce();
});
ipcMain.on('is-loaded', (event) => {
    if(serverLoaded)
        event.reply('server-load', "Python server running");
});

const appMenu = [
    {
        label: 'About mLearn',
        click: async () => {
            //if(serverLoaded)
            mainWindow.webContents.send('show-settings','About');
        }
    },
    { type: 'separator' },
    {
        label: 'Settings',
        click: async () => {
            // if(serverLoaded)
            mainWindow.webContents.send('show-settings');
        }
    },
    { type: 'separator' },
    { role: 'hide' },
    { type: 'separator' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' }
];

const template = [
    // { role: 'appMenu' }
    ...(isMac
        ? [{
            label: app.name,
            submenu: appMenu
        }]
        : []),
    // { role: 'fileMenu' }
    {
        label: 'File',
        submenu: [
            isMac ? { role: 'close' } : { role: 'quit' },
            ...(isMac
                    ? []
                    : appMenu
            )
        ]
    },
    // { role: 'editMenu' }
    {
        label: 'Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            ...(isMac
                ? [
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' }
                ]
                : [
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' }
                ])
        ]
    },
    // { role: 'viewMenu' }
    {
        label: 'View',
        submenu: [
            {
                label: 'Open Live Word Translator',
                click: async () => {
                    mainWindow.webContents.send('show-aside');
                }
            },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            ...(!isPackaged
                ? [
                    { label: 'Open DevTools', role: 'toggleDevTools' }
                ]
                : [
                ])

        ]
    },
    // { role: 'windowMenu' }
    {
        label: 'Window',
        submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            ...(isMac
                ? [
                    { type: 'separator' },
                    { role: 'front' },
                    { type: 'separator' },
                    { role: 'window' }
                ]
                : [
                    { role: 'close' }
                ])
        ]
    },
    {
        label: 'Video',
        submenu: [
            {
                label: 'Sync Subtitles with Video',
                click: async () => {
                    mainWindow.webContents.send('ctx-menu-command', 'sync-subs');
                }
            },
            {
                label: 'Copy Subtitle',
                click: async () => {
                    mainWindow.webContents.send('ctx-menu-command', 'copy-sub');
                }
            },
            ...(isMac ? [{ type: 'separator' }] : []),
            {
                label: 'Watch Together',
                click: async () => {
                    mainWindow.webContents.send('watch-together');
                    dialog.showMessageBox(null, {
                        type: 'info',
                        title: 'Watch Together',
                        message: 'Started Watch Together at \nhttp://127.0.0.1:'+PORT+'\n\nPlease port forward this device\'s 7753 port if you want to share it with others. \n\nGo to https://mlearn.morisinc.net/watch-together to join the session.',
                    });
                    startWebSocketServer();
                }
            }
        ]
    }
];

const menu = Menu.buildFromTemplate(template)
Menu.setApplicationMenu(menu)


//find python


const moveContents = (src, dest) => {
    const files = fs.readdirSync(src);
    files.forEach(file => {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);

        // If the destination path exists, remove it
        if (fs.existsSync(destPath)) {
            if (fs.lstatSync(destPath).isDirectory()) {
                fs.rmdirSync(destPath, { recursive: true });
            } else {
                fs.unlinkSync(destPath);
            }
        }

        fs.renameSync(srcPath, destPath);
    });
};

const downloadFile = (fileUrl, dest, cb, redirectCount = 0) => {
    const MAX_REDIRECTS = 5; // Limit the number of redirects to avoid infinite loops
    const file = fs.createWriteStream(dest);

    https.get(fileUrl, (response) => {
        // Handle redirection (up to MAX_REDIRECTS)
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            if (redirectCount >= MAX_REDIRECTS) {
                console.error('Too many redirects');
                process.exit(1);
            }
            const redirectUrl = url.resolve(fileUrl, response.headers.location); // Resolve relative redirects
            console.log(`Redirecting to: ${redirectUrl}`);
            downloadFile(redirectUrl, dest, cb, redirectCount + 1);
        } else if (response.statusCode !== 200) {
            console.error(`Download failed with status code: ${response.statusCode}`);
            process.exit(1);
        } else {
            // Pipe the response to the file
            response.pipe(file);
            file.on('finish', () => {
                file.close(() => {
                    const stats = fs.statSync(dest);
                    if (stats.size === 0) {
                        console.error('Downloaded file is 0 bytes');
                        process.exit(1);
                    }
                    console.log('Download complete!');
                    cb();
                });
            });
        }
    }).on('error', (err) => {
        fs.unlink(dest, () => {}); // Delete the incomplete file
        console.error('Error downloading file:', err.message);
        process.exit(1);
    });
};


const extractFile = (src, dest, cb) => {
    // Extract the .tar.gz file to the destination directory
    tar.x({
        file: src,
        cwd: dest,  // Change working directory to 'dest' where the tar.gz will be extracted
        gzip: true  // Enable gzip decompression
    })
        .then(() => {
            console.log('Extraction complete');

            // After extraction, recursively copy contents of the extracted folder
            const extractedFolder = fs.readdirSync(dest)[0]; // Assuming one folder is extracted
            const extractedPath = path.join(dest, extractedFolder);

            // Copy the contents recursively to the envPath
            copyRecursive(extractedPath, envPath, cb);
        })
        .catch((err) => {
            console.error('Error extracting file:', err.message);
            process.exit(1);
        });
};

// Function to copy files/folders recursively
const copyRecursive = (src, dest, cb) => {
    // Ensure the destination directory exists
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    // Read the contents of the source directory
    fs.readdir(src, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err.message);
            process.exit(1);
        }

        // Counter for asynchronous file copying
        let pending = files.length;

        // If no files, call the callback immediately
        if (pending === 0) {
            return cb();
        }

        // Process each file in the source directory
        files.forEach((file) => {
            const srcPath = path.join(src, file);
            const destPath = path.join(dest, file);

            // Get the stats of the file/directory
            fs.stat(srcPath, (err, stats) => {
                if (err) {
                    console.error('Error getting file stats:', err.message);
                    process.exit(1);
                }

                if (stats.isDirectory()) {
                    // Recursively copy subdirectories
                    copyRecursive(srcPath, destPath, () => {
                        // Check if this was the last pending operation
                        if (--pending === 0) {
                            cb();
                        }
                    });
                } else if (stats.isFile()) {
                    // Copy files
                    fs.copyFile(srcPath, destPath, (err) => {
                        if (err) {
                            console.error('Error copying file:', err.message);
                            process.exit(1);
                        }
                        // Check if this was the last pending operation
                        if (--pending === 0) {
                            cb();
                        }
                    });
                } else {
                    // If it's neither a file nor a directory, log a message
                    console.warn(`Skipping non-file/non-directory: ${srcPath}`);
                    // Check if this was the last pending operation
                    if (--pending === 0) {
                        cb();
                    }
                }
            });
        });
    });
};

const pingPythonServer = (callback) => {
    const options = {
        hostname: '127.0.0.1',
        port: 8000,
        path: '/control',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            if (res.statusCode === 200 && data.includes('"response":"pong"')) {
                callback(true);
            } else {
                callback(false);
            }
        });
    });

    req.on('error', (error) => {
        console.error(`Error pinging Python server: ${error.message}`);
        callback(false);
    });

    req.write(JSON.stringify({ function: 'ping' }));
    req.end();
};
let serverLoaded = false;

const pythonExecutable = isWindows
    ? path.join(resPath, 'env', 'python.exe')  // Python executable on Windows
    : path.join(resPath, 'env', 'bin', 'python3');        // Python executable on Unix
const pipExecutable = isWindows
    ? path.join(resPath, 'env', 'python.exe')     // pip executable on Windows
    : path.join(resPath, 'env', 'bin', 'pip3');           // pip executable on Unix

const accessArgs = isWindows
    ? ["-m pip"]
    : [];
const pythonFound = () => {
    console.log("Python found at", PYTHON_PATH);
    let settings = loadSettings();
    if(isFirstTimeSetup) return;
    console.log(pythonExecutable);

    const onSTDOUT = (data) => {
        console.log("Python response: ", data.toString('utf8'));
        try{
            mainWindow.webContents.send('server-status-update', data.toString('utf8'));
        }catch(e){}
    };
    const onSTDERR = (data) => {
        console.error(`stderr: ${data}`);
        try{
            mainWindow.webContents.send('server-status-update', 'stderr: '+data.toString('utf8'));
        }catch(e){}
        //check if python server is running by pinging it with a request on port 8000 on 127.0.0.1/control and req.function = "ping"
        //if it returns "pong" then it is running
        pingPythonServer((running) => {
            if(!running) return;
            //send message to renderer that server is running
            mainWindow.webContents.send('server-load', "Python server running");
            serverLoaded = true;
        });
    };

    const onCLOSE = (code) => {
        console.log(`child process exited with code ${code}`);
        //send critical error to renderer
        mainWindow.webContents.send('server-critical-error', "<span style='color:#fcc'>Critical error</span>: could not start python server; app restart required. <br>Since Anki was not found, the server tried to find the cached Anki data from prior use, but this triggered an error <br>Ensure that Anki is running and restart the app.<br> Disable Anki in Settings if you do not want to use it <br>For more information, check the console.<br><button class='restart-app'>Restart App</button>");
    };

    if(isWindows){
        //pythonExecutable
        // const command = "start cmd.exe /C \"" + ["\"" + pythonExecutable + "\"", "\"" + path.join(resPath, 'server.py') + "\"", String(settings.ankiConnectUrl), String(settings.use_anki), String(settings.language), "\"" + String(resPath) + "\""].join(" ") + "\"";
        const command = ["\"" + pythonExecutable + "\"", "\"" + path.join(resPath, 'server.py') + "\"", String(settings.ankiConnectUrl), String(settings.use_anki), String(settings.language), "\"" + String(resPath) + "\""].join(" ");
        console.log("WINDOWS:::",command)
        pythonChildProcess = exec(command);
    }else{
        pythonChildProcess = require('child_process').spawn('env', [pythonExecutable, path.join(resPath, 'server.py'), String(settings.ankiConnectUrl), String(settings.use_anki), String(settings.language), String(resPath)], {
            env: process.env
        });
    }
    pythonChildProcess.stdout.on('data', onSTDOUT);

    pythonChildProcess.stderr.on('data', onSTDERR);

    pythonChildProcess.on('close', onCLOSE);

};




let PYTHON_PATH = "";
function findPython() {
    console.log("Finding python3");
    const possibilities = [
        // In packaged app
        path.join(process.resourcesPath, "env", "bin", "python3"),
        // In development
        path.join(resPath, "env", "bin", "python3"),
        // Windows
        // In packaged app
        path.join(process.resourcesPath, "env", "python.exe"),
        // In development
        path.join(resPath, "env", "python.exe"),
    ];
    for (const path of possibilities) {
        if (fs.existsSync(path)) {
            PYTHON_PATH = path;
            pythonSuccessInstall = true;
            pythonFound();
            return path;
        }
    }
    console.log("Could not find python3, checked", possibilities);
    console.log("Downloading Python...");
    try{currentWindow.webContents.send('server-status-update', 'Downloading Python...');}catch(e){}

    const onPipSTDOUT = (data) => {
        console.log(`stdout: ${data}`);
        try{currentWindow.webContents.send('server-status-update', `${data}`);}catch(e){}
    };
    const onPipSTDERR = (data) => {
        console.error(`stderr: ${data}`);
        try{currentWindow.webContents.send('server-status-update', `ERROR: ${data}`);}catch(e){}
    };
    const onPipClose = (code) => {
        console.log(`Installing libraries complete`);
        try{currentWindow.webContents.send('server-status-update', 'Installing libraries complete');}catch(e){}
        pythonFound();
        pythonSuccessInstall = true;
    };
    isFirstTimeSetup = true;
    downloadFile(pythonUrl, downloadPath, () => {
        console.log('Download complete');
        try{currentWindow.webContents.send('server-status-update', 'Download complete');}catch(e){}
        fs.mkdirSync(extractPath, { recursive: true });
        extractFile(downloadPath, extractPath, () => {
            console.log('Extraction complete, Installing libraries...');
            try{currentWindow.webContents.send('server-status-update', 'Download complete');}catch(e){}
            const pipRequirements = loadPipRequirements();
            console.log(pythonExecutable);
            console.log("PIP EXECUTABLE:", pipExecutable);
            if(isWindows){
                const command = "start cmd.exe /C \"" + ["\"" + pipExecutable + "\"", ...accessArgs, 'install', ...pipRequirements].join(" ") + "\"";
                exec(command, (error, stdout, stderr) => {
                    onPipClose(null);
                });
            }else{
                const installPip = spawn(pipExecutable, [...accessArgs, 'install', ...pipRequirements], {
                    cwd: envPath
                });
                installPip.stdout.on('data', onPipSTDOUT);
                installPip.stderr.on('data', onPipSTDERR);
                installPip.on('close', onPipClose);
            }

        });
    });
}


// receive a message in text mode
findPython();
