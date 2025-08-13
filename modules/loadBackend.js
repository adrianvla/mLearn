import fs from "node:fs";
import path from "node:path";
import https from "https";
import url from "url";
import http from "http";
import {exec, spawn} from "child_process";
import {ARCHITECTURE, isWindows, PLATFORM, resPath, setIsWindows} from "./archPlatform.js";
import {app, ipcMain} from "electron";
import {createWelcomeWindow, currentWindow, mainWindow} from "./allWindows.js";
import {loadSettings} from "./settings.js";

import * as tar from 'tar';
let pythonSuccessInstall = false;
let isFirstTimeSetup = false;
let pythonChildProcess;
const downloadPath = path.join(resPath, 'python.tar.gz');
const extractPath = path.join(resPath, 'py');
const envPath = path.join(resPath, 'env');
const BASE_URL = 'https://github.com/adrianvla/packaged-python/raw/refs/heads/main/';
let pythonUrl;
let serverLoaded = false;
let PYTHON_PATH = "";
let isSettingUp = false;

// const tempDir = path.join(resPath, 'temp');
// const updateZipPath = path.join(tempDir, 'update.zip');
// const extractDir = path.join(tempDir, 'mLearn-main');
// const updateURL = "https://mlearn-update.morisinc.net/version-info.json";
// const updateDownloadUrl = "https://github.com/adrianvla/mLearn/archive/refs/heads/main.zip";


if (PLATFORM === 'darwin' && ARCHITECTURE === 'x64') {
    pythonUrl = `${BASE_URL}x86_64-apple-darwin-install_only.tar.gz`;
} else if (PLATFORM === 'darwin' && ARCHITECTURE === 'arm64') {
    pythonUrl = `${BASE_URL}aarch64-apple-darwin-install_only.tar.gz`;
} else if ((PLATFORM === 'win32' && ARCHITECTURE === 'x64') || (PLATFORM === 'win64' && ARCHITECTURE === 'x64') || (PLATFORM === 'win' && ARCHITECTURE === 'x64') || (PLATFORM === 'win32' && ARCHITECTURE === 'x86') || (PLATFORM === 'win64' && ARCHITECTURE === 'x86') || (PLATFORM === 'win' && ARCHITECTURE === 'x86') || (PLATFORM === 'win32' && ARCHITECTURE === 'arm64') || (PLATFORM === 'win64' && ARCHITECTURE === 'arm64') || (PLATFORM === 'win' && ARCHITECTURE === 'arm64') || (PLATFORM === 'win32' && ARCHITECTURE === 'arm') || (PLATFORM === 'win64' && ARCHITECTURE === 'arm') || (PLATFORM === 'win' && ARCHITECTURE === 'arm') || (PLATFORM === 'win32' && ARCHITECTURE === 'amd64') || (PLATFORM === 'win64' && ARCHITECTURE === 'amd64') || (PLATFORM === 'win' && ARCHITECTURE === 'amd64')) {
    pythonUrl = `${BASE_URL}x86_64-pc-windows-msvc-install_only.tar.gz`;
    setIsWindows(true);
} else if (PLATFORM === 'linux' && ARCHITECTURE === 'x64') {
    pythonUrl = `${BASE_URL}x86_64-unknown-linux-gnu-install_only.tar.gz`;
} else {
    console.error('Unsupported platform or architecture');
    process.exit(1);
}
pythonUrl+="?download=";

const loadPipRequirements = () => {
    return JSON.parse(fs.readFileSync(path.join(resPath, 'pip_requirements.json')));
};

const firstTimeSetup = () => {
    setFirstTimeSetup(true);
    if(isSettingUp) return;
    isSettingUp = true;
    createWelcomeWindow();
};
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
        port: 7752,
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
        //check if python server is running by pinging it with a request on port 7752 on 127.0.0.1/control and req.function = "ping"
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
        pythonChildProcess = spawn('env', [pythonExecutable, path.join(resPath, 'server.py'), String(settings.ankiConnectUrl), String(settings.use_anki), String(settings.language), String(resPath)], {
            env: process.env
        });
    }
    pythonChildProcess.stdout.on('data', onSTDOUT);

    pythonChildProcess.stderr.on('data', onSTDERR);

    pythonChildProcess.on('close', onCLOSE);

};




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

function setFirstTimeSetup(value) {
    isFirstTimeSetup = value;
}
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        console.log("Tried to quit, pythonSuccessInstall=",pythonSuccessInstall);
        if(!pythonSuccessInstall) return;
        pythonChildProcess.kill("SIGINT");
        app.quit();
    }
});
ipcMain.on('is-successful-install', (event) => {
    event.reply('successful-install', pythonSuccessInstall);
});

ipcMain.on('is-loaded', (event) => {
    if(serverLoaded)
        event.reply('server-load', "Python server running");
});

export {findPython, downloadFile, isFirstTimeSetup, setFirstTimeSetup, serverLoaded, firstTimeSetup, pythonChildProcess}