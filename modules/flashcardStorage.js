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

export const flashcardsToEaseHashmap = ()=>{
    const fs = loadFlashcards();
    let easeHashmap = {};
    console.log("Got Flashcards: ",fs, fs.flashcards, fs.knownUnTracked);
    if(Object.keys(fs).length === 0) return easeHashmap;
    fs?.flashcards?.forEach((card)=>{
        easeHashmap[card.content.word] = card.ease || 0;
    });
    Object.keys(fs?.knownUnTracked).forEach((word)=>{
        easeHashmap[word] = 10000; //max
    });
    return easeHashmap;
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