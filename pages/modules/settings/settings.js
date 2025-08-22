import $ from '../../lib/jquery.min.js'
import {onSettingsLoaded} from "../load.js";
const DEFAULT_SETTINGS = {"known_ease_threshold":1500,"blur_words":false,"blur_known_subtitles":false,"blur_amount":5,"colour_known":"#cceec9","do_colour_known":true,"do_colour_codes":true,"colour_codes":{},"dark_mode":true,"hover_known_get_from_dictionary":false,"show_pos":true,"language":"ja","use_anki":false,"furigana":true,"enable_flashcard_creation":true,"flashcard_deck":null,"flashcards_add_picture":true,"getCardUrl":"http://127.0.0.1:7752/getCard","tokeniserUrl":"http://127.0.0.1:7752/tokenize","getTranslationUrl":"http://127.0.0.1:7752/translate","ankiUrl":"http://127.0.0.1:7752/fwd-to-anki","ankiConnectUrl":"http://127.0.0.1:8765","openAside":true,"subsOffsetTime":0,"immediateFetch":false,"subtitleTheme":"shadow","subtitle_font_size":40,"showPitchAccent":true,"timeWatched":0, "maxNewCardsPerDay":10, "proportionOfExamCards":0.5,"preparedExam":3, "createUnseenCards":true};

let settings = {};
let supported_languages = [];
let lang_data = {};
let TRANSLATABLE;
let wordFreq = {};

const SUBTITLE_THEMES = ["marker","background","shadow"];

const setSettings = (newSettings) => {
    settings = newSettings;
};
const checkSettings = () => {
    //check if every setting is present
    console.log("Checking settings",settings);
    for(let key in DEFAULT_SETTINGS){
        if(!(key in settings)){
            settings[key] = DEFAULT_SETTINGS[key];
        }
    }
    //fix settings
    for(let key in lang_data[settings.language].fixed_settings){
        settings[key] = lang_data[settings.language].fixed_settings[key];
    }
    //set subtitle font size
    document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
    document.documentElement.style.setProperty('--word-blur-amount', `${settings.blur_amount}px`);

    SUBTITLE_THEMES.forEach((theme)=>{
        $(".subtitles").removeClass("theme-"+theme);
    });
    //set subtitle theme
    $(".subtitles").addClass("theme-"+settings.subtitleTheme);
    //set dark mode
    if(settings.dark_mode) $("body").addClass("dark");
    else $("body").removeClass("dark");

    saveSettings();
};

const saveSettings = async () => {
    //send settings
    window.mLearnIPC.saveSettings(settings);
};
const getSettings = async () => new Promise((resolve) => {
    window.mLearnIPC.getSettings();
    window.mLearnIPC.onSettings((settings) => {
        resolve(settings);
    });
});

const getLangData = async () => new Promise((resolve) => {
    window.mLearnIPC.getLangData();
    window.mLearnIPC.onLangData((lang_data) => {
        //set supported languages
        supported_languages = Object.keys(lang_data);
        resolve(lang_data);
    });
});

const load_lang_data = () => {
    TRANSLATABLE = lang_data[settings.language].translatable;
    settings.colour_codes = lang_data[settings.language].colour_codes;
};

const loadSettings = async () => {
    lang_data = await getLangData();
    settings = await getSettings();
    window.settings = settings;
    onSettingsLoaded();
};

const parseWordFrequency = () => {
    //using data from https://github.com/FerchusGames/JLPT-Migaku-Frequency-List/tree/main
    if(!lang_data[settings.language].freq) return;
    const freq = lang_data[settings.language].freq;
    for(let wordi in freq){
        if(!freq[wordi]) continue;
        if(freq[wordi].length < 2) continue;
        let level = 1;
        if(wordi<=1500 && wordi>=0){
            level = 5;
        }else if(wordi>1500 && wordi<=5000){
            level = 4;
        }else if(wordi>5000 && wordi<=15000){
            level = 3;
        }else if(wordi>15000 && wordi<=30000){
            level = 2;
        }
        let lvlName = "";
        if(lang_data[settings.language].freq_level_names){
            lvlName = lang_data[settings.language].freq_level_names[String(level)];
        }
        if(!lvlName){ 
            lvlName = "Level "+level;
        }
        wordFreq[freq[wordi][0]] = {reading:freq[wordi][1], level:lvlName, raw_level:level};
    }

};

export {checkSettings, saveSettings, getSettings, getLangData, load_lang_data, loadSettings, parseWordFrequency, settings, supported_languages, lang_data, SUBTITLE_THEMES, TRANSLATABLE, wordFreq, DEFAULT_SETTINGS, setSettings};