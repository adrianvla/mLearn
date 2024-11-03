const { app, BrowserWindow, ipcMain, Menu, dialog} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn, exec } = require('child_process');
const tar = require('tar');
const unzipper = require('unzipper');
const url = require('url');
const isPackaged = true;//app.isPackaged;

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
const downloadPath = path.join(__dirname, 'python.tar.gz');
const extractPath = path.join(__dirname, 'py');
const envPath = path.join(__dirname, 'env');
const tempDir = path.join(__dirname, 'temp');
const updateZipPath = path.join(tempDir, 'update.zip');
const extractDir = path.join(tempDir, 'mLearn-main');
const updateURL = "https://mlearn-update.morisinc.net/version-info.json";
const updateDownloadUrl = "https://download1523.mediafire.com/d109ku2p1arguaJVrkpwv5DTR-x4NZKU270OMCIrPgS3foUR61WvCbNLThZD44onVnGJRnkVDpHXgDeSiZ1drgmZbrK7d6gd7Nmoy0qHtwmkDZPlG9gu6ofiE-ttyABouYQsJ_RoEWdgv-bt4KN4GukdshCnUz76qngnbaZrFUs/yesbm5q6ib0zp96/mLearn-main.zip";//"https://github.com/adrianvla/mLearn/archive/refs/heads/main.zip";
const BASE_URL = 'https://github.com/adrianvla/packaged-python/raw/refs/heads/main/';
//THIS WILL BE OVERWRITTEBN ASKDHLKADJHFLKSJDHFLKJSHDLFKJSHDLFJHSLDKFJHLSKDJHF

let lang_data = {};
let mainWindow;
let isWindows = false;
let pythonChildProcess;
let isSettingUp = false;
let isFirstTimeSetup = false;
let currentWindow = null;
let pythonSuccessInstall = false;
let pythonUrl;


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

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, '/pages/preload.js')
        },
        titleBarStyle: 'hidden'
    });
    mainWindow.loadFile('pages/index.html');
    currentWindow = mainWindow;
}
const createWelcomeWindow = () => {

    let welcomeWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, '/pages/preload.js')
        },
        titleBarStyle: 'hidden'
    });
    welcomeWindow.loadFile('pages/welcome.html');
    currentWindow = welcomeWindow;
};

const createUpdateWindow = () => {
    let updateWindow = new BrowserWindow({
        width: 800,
        height: 400,
        webPreferences: {
            preload: path.join(__dirname, '/pages/preload.js')
        },
        titleBarStyle: 'hidden'
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
    if(isPackaged){
        checkForUpdates();
    }
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
    createWindow();

})
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
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
                                    // Move contents from /temp/mLearn-main to __dirname
                                    moveContents(extractDir, __dirname);
                                    console.log('Update moved to application directory');
                                    currentWindow.webContents.send('server-status-update', 'Overwritten application files with updated ones');
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
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'pip_requirements.json')));
};



const loadLangData = () => {
    console.log("Loading lang data");
    //scan the languages directory and load the json files
    const langDir = path.join(__dirname, 'languages');
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

ipcMain.on('save-settings', (event, settings) => {
    saveSettings(settings);
    event.reply('settings-saved', 'Settings saved successfully');
});

ipcMain.on('get-lang-data', (event) => {
    event.reply('lang-data', loadLangData());
});

ipcMain.on('traffic-lights', (event, arg) => {
    mainWindow.setWindowButtonVisibility(arg.visibility);
});
ipcMain.on('is-successful-install', (event) => {
    event.reply('successful-install', pythonSuccessInstall);
});
ipcMain.on('install-lang', (event, u) => {
    try{
        downloadFile(u, path.join(__dirname, 'temp', 'temp.json'), () => {
            let lang;
            try{
                lang = JSON.parse(fs.readFileSync(path.join(__dirname, 'temp', 'temp.json')));
            }catch(e){
                currentWindow.webContents.send('lang-install-error', "Error: Invalid JSON file");
                return;
            }
            //download lang.py
            if(lang.json && lang.lang_py && lang.lang)
                downloadFile(lang.lang_py, path.join(__dirname, 'languages', lang.lang+'.py'), () => {
                    //write lang.json
                    fs.writeFileSync(path.join(__dirname, 'languages', lang.lang + '.json'), JSON.stringify(lang.json));
                    //delete temp.json
                    fs.unlinkSync(path.join(__dirname, 'temp', 'temp.json'));
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
ipcMain.on('show-ctx-menu', (event) => {
    const template = [
        {
            label: 'Sync Subtitles with Video',
            click: () => { event.sender.send('ctx-menu-command', 'sync-subs') }
        },
        // { type: 'separator' },
        // { label: 'Menu Item 2', type: 'checkbox', checked: true }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
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

const template = [
    // { role: 'appMenu' }
    ...(isMac
        ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                {
                    label: 'Settings',
                    click: async () => {
                        if(serverLoaded) mainWindow.webContents.send('show-settings');
                    }
                },
                { type: 'separator' },
                { role: 'hide' },
                { type: 'separator' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }]
        : []),
    // { role: 'fileMenu' }
    {
        label: 'File',
        submenu: [
            isMac ? { role: 'close' } : { role: 'quit' }
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
            { role: 'reload' },
            { role: 'forceReload' },
            {
                label: 'Show Live Translations',
                click: async () => {
                    mainWindow.webContents.send('show-aside');
                }
            },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' }
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
    ? path.join(__dirname, 'env', 'Scripts', 'python.exe')  // Python executable on Windows
    : path.join(__dirname, 'env', 'bin', 'python3');        // Python executable on Unix
const pipExecutable = isWindows
    ? path.join(__dirname, 'env', 'Scripts', 'pip.exe')     // pip executable on Windows
    : path.join(__dirname, 'env', 'bin', 'pip3');           // pip executable on Unix
const pythonFound = () => {
    console.log("Python found at", PYTHON_PATH);
    let settings = loadSettings();
    if(isFirstTimeSetup) return;
    console.log(pythonExecutable)
    pythonChildProcess = require('child_process').spawn('env', [pythonExecutable, path.join(__dirname, 'server.py'), String(settings.ankiConnectUrl), String(settings.use_anki), String(settings.language)], {
        env: process.env
    });
    pythonChildProcess.stdout.on('data', function (data) {
        console.log("Python response: ", data.toString('utf8'));
        try{
            mainWindow.webContents.send('server-status-update', data.toString('utf8'));
        }catch(e){}
    });

    pythonChildProcess.stderr.on('data', (data) => {
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

    });

    pythonChildProcess.on('close', (code) => {
        console.log(`child process exited with code ${code}`);
        //send critical error to renderer
        mainWindow.webContents.send('server-critical-error', "<span style='color:#fcc'>Critical error</span>: could not start python server; app restart required. <br>Since Anki was not found, the server tried to find the cached Anki data from prior use, but this triggered an error <br>Ensure that Anki is running and restart the app.<br> Disable Anki in Settings if you do not want to use it <br>For more information, check the console.<br><button class='restart-app'>Restart App</button>");
    });

};




let PYTHON_PATH = "";
function findPython() {
    console.log("Finding python3");
    const possibilities = [
        // In packaged app
        path.join(process.resourcesPath, "env", "bin", "python3"),
        // In development
        path.join(__dirname, "env", "bin", "python3"),
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
            const installPip = spawn(pipExecutable, ['install', ...pipRequirements], {
                cwd: envPath
            });
            installPip.stdout.on('data', (data) => {
                console.log(`stdout: ${data}`);
                try{currentWindow.webContents.send('server-status-update', `${data}`);}catch(e){}
            });
            installPip.stderr.on('data', (data) => {
                console.error(`stderr: ${data}`);
            });
            installPip.on('close', (code) => {
                console.log(`Installing libraries complete`);
                try{currentWindow.webContents.send('server-status-update', 'Installing libraries complete');}catch(e){}
                pythonFound();
                pythonSuccessInstall = true;
            });
            //pythonFound();
        });
    });
}


// receive a message in text mode
findPython();

