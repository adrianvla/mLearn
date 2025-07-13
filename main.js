import {createWelcomeWindow, createWindow, currentWindow, mainWindow} from "./modules/allWindows.js";
import { app, BrowserWindow, ipcMain, Menu, dialog, clipboard, shell} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'os';
import https from 'https';
import http from 'http';
import { spawn, exec } from 'child_process';
import * as tar from 'tar';
import unzipper from 'unzipper';
import url from 'url';

import {isMac, isPackaged, resPath} from "./modules/archPlatform.js";
import {downloadFile, findPython, isFirstTimeSetup, serverLoaded, setFirstTimeSetup} from "./modules/loadBackend.js";
import {sendPillUpdatesToMainWindow, setLocalStorage, startWebSocketServer} from "./modules/webServer.js";





ipcMain.on('write-to-clipboard', (event, text)=>{
    clipboard.writeText(text);
});
ipcMain.on('show-contact', (event) => {
    shell.openExternal("https://morisinc.net/");
});

//find python

// receive a message in text mode
findPython();
startWebSocketServer();