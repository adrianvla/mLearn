import path from "node:path";
import {resPath} from "./archPlatform.js";
import fs from "node:fs";
import {ipcMain} from "electron";
import {downloadFile} from "./loadBackend.js";
import {currentWindow} from "./allWindows.js";

let lang_data = {};


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


ipcMain.on('get-lang-data', (event) => {
    event.reply('lang-data', loadLangData());
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

export {lang_data, loadLangData}