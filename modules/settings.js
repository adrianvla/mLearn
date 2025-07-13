import fs from "node:fs";
import {setFirstTimeSetup} from "./loadBackend.js";
import {app, ipcMain} from "electron";
import {loadLangData, lang_data} from "./langData.js";
import path from "node:path";

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
    "known_ease_threshold": 1500,
    "blur_words": false,
    "blur_known_subtitles": false,
    "blur_amount":5,
    "colour_known":"#cceec9",
    "do_colour_known":true,
    "do_colour_codes":true,
    "colour_codes":{},
    "dark_mode":true,
    "hover_known_get_from_dictionary":false,
    "show_pos":true,
    "language":"ja",
    "use_anki":true,
    "furigana":true,
    "enable_flashcard_creation":true,
    "flashcard_deck":null,
    "getCardUrl" : "http://127.0.0.1:8000/getCard",
    "tokeniserUrl" : "http://127.0.0.1:8000/tokenize",
    "getTranslationUrl" : "http://127.0.0.1:8000/translate",
    "ankiUrl" : "http://127.0.0.1:8000/fwd-to-anki",
    "ankiConnectUrl": "http://127.0.0.1:8765",
    "openAside":false,
    "subsOffsetTime":0,
    "immediateFetch":false,
    "subtitleTheme":"shadow",
    "subtitle_font_size":40
};

const saveSettings = (settings) => {
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
};


const loadSettings = () => {
    //if file exists
    if(JSON.stringify(lang_data)==="{}"){
        loadLangData();
    }
    if (fs.existsSync(settingsPath)) {
        let settings = JSON.parse(fs.readFileSync(settingsPath));
        const checkSettings = () => {
            //check if every setting is present
            for(let key in DEFAULT_SETTINGS){
                if(!(key in settings)){
                    settings[key] = DEFAULT_SETTINGS[key];
                }
            }
            //fix settings
            for(let key in lang_data[settings.language].fixed_settings){
                settings[key] = lang_data[settings.language].fixed_settings[key];
            }
        };
        checkSettings();
        saveSettings(settings);
        return settings;
        // return JSON.parse(fs.readFileSync(settingsPath));
    }else{
        //create file
        setFirstTimeSetup(true);
        saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
};

ipcMain.on('get-settings', (event) => {
    event.reply('settings', loadSettings());
});

ipcMain.on('save-settings', (event, settings) => {
    saveSettings(settings);
    event.reply('settings-saved', 'Settings saved successfully');
});

export {loadSettings, saveSettings};