import fs from "node:fs";
import {app, ipcMain} from "electron";
import path from "node:path";

const flashcardPath = path.join(app.getPath('userData'), 'flashcards.json');

const saveFlashcards = (a) => {
    fs.writeFileSync(flashcardPath, JSON.stringify(a));
};


const loadFlashcards = () => {
    //if file exists
    if (fs.existsSync(flashcardPath)) {
        let fc = JSON.parse(fs.readFileSync(flashcardPath));
        saveFlashcards(fc);
        return fc;
    }else{
        saveFlashcards({});
        return {};
    }
};

ipcMain.on('get-flashcards', (event) => {
    const flashcards = loadFlashcards();
    event.reply('flashcards-loaded', flashcards);
});

ipcMain.on('save-flashcards', (event, flashcards) => {
    saveFlashcards(flashcards);
    // event.reply('flashcards-saved', 'Flashcards saved successfully');
});


export {saveFlashcards, loadFlashcards};