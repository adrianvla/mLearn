import {app, ipcMain, clipboard, shell} from 'electron';
import './modules/drm/init.js';
import {findPython} from "./modules/loadBackend.js";
import {startWebSocketServer} from "./modules/webServer.js";
import './modules/flashcardStorage.js';
import './modules/super.js';



ipcMain.on('write-to-clipboard', (event, text)=>{
    clipboard.writeText(text);
});
ipcMain.on('show-contact', (event) => {
    shell.openExternal("https://morisinc.net/");
});

findPython();
startWebSocketServer();

// Ensure backend quits on app exit (safety net)
app.on('before-quit', () => {
    // loadBackend registers its own quit handlers, this is just a trigger to ensure they run
});