import {ipcMain, clipboard, shell} from 'electron';
import './modules/drm/init.js';
import {findPython} from "./modules/loadBackend.js";
import {startWebSocketServer} from "./modules/webServer.js";



ipcMain.on('write-to-clipboard', (event, text)=>{
    clipboard.writeText(text);
});
ipcMain.on('show-contact', (event) => {
    shell.openExternal("https://morisinc.net/");
});

findPython();
startWebSocketServer();