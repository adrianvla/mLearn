import os from "os";
import {app, ipcMain} from "electron";
import path from "node:path";
import { fileURLToPath } from 'node:url';


let isWindows = false;
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const ARCHITECTURE = os.arch();
const PLATFORM = os.platform();
const isPackaged = app.isPackaged;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// appPath: read-only bundled app root (app.asar in production, project root in dev)
const appPath = app.getAppPath();
// resPath: writable resources root outside asar (Resources/app in production, project root in dev)
const resPath = isPackaged ? path.join(process.resourcesPath, "app") : path.dirname(__dirname);

console.log("appPath", appPath);
console.log("resPath", resPath);
console.log("Is packaged", isPackaged, "Version", app.getVersion(),"Path",app.getPath('userData'));

console.log(ARCHITECTURE, PLATFORM);
console.log("App version:", app.getVersion());

ipcMain.on('get-version', (event) => {
    event.reply('version', app.getVersion());
});

function setIsWindows(to) {
    isWindows = to;
}

export {isWindows, isMac, ARCHITECTURE, PLATFORM, isPackaged, resPath, setIsWindows, isLinux};
export { appPath };