import {getMainWindow} from "../allWindows.js";
import {ipcMain} from "electron";

let promptSubscribers = [];

export const prompt_user = (message) => new Promise(resolve => {
    getMainWindow().webContents.send('open-prompt', message);
    promptSubscribers.push(resolve);
});

ipcMain.on('prompt-output', (event, message) => {
    promptSubscribers.forEach(s => s(message));
    promptSubscribers = [];
});
