import os from "os";
import {app} from "electron";
import path from "node:path";
import { fileURLToPath } from 'node:url';


let isWindows = false;
const isMac = process.platform === 'darwin';
const ARCHITECTURE = os.arch();
const PLATFORM = os.platform();
const isPackaged = app.isPackaged;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const resPath = isPackaged ? path.join(process.resourcesPath, "app") :  path.dirname(__dirname);

console.log("resPath", resPath);
console.log("Is packaged", isPackaged, "Version", app.getVersion(),"Path",app.getPath('userData'));

console.log(ARCHITECTURE, PLATFORM);

function setIsWindows(to) {
    isWindows = to;
}

export {isWindows, isMac, ARCHITECTURE, PLATFORM, isPackaged, resPath, setIsWindows};