import $ from './jquery.min.js'
import {
    checkSettings,
    load_lang_data,
    loadSettings,
    parseWordFrequency,
    settings
} from "./modules/settings.js";
import "./modules/liveWordTranslator.js";
import "./modules/load.js";
import "./modules/manageFiles.js";
import './modules/onOpenSettings.js';
import './modules/saving.js';
import './modules/streaming.js';
import './modules/subtitler.js';
import './modules/utils.js';
import './modules/videoUtils.js';
import './modules/watchTogether.js';
import './modules/drm/init.js';


(async function() {
    await loadSettings();
    checkSettings();
    load_lang_data();
    parseWordFrequency();

    if(settings.use_anki){
        $(".add-all-to-anki").hide();
        $(".update-flashcards-due-date").show();
    }else{
        $(".add-all-to-anki, .update-flashcards-due-date").hide();
    }
})();

