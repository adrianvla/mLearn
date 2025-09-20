import $ from './lib/jquery.min.js'
import {
    checkSettings,
    load_lang_data,
    loadSettings,
    parseWordFrequency,
    settings
} from "./modules/settings/settings.js";
import "./modules/subtitler/liveWordTranslator.js";
import "./modules/load.js";
import "./modules/playback/manageFiles.js";
import './modules/settings/onOpenSettings.js';
import './modules/stats/saving.js';
import './modules/playback/streaming.js';
import './modules/subtitler/subtitler.js';
import './modules/utils.js';
import './modules/playback/videoUtils.js';
import './modules/watch-together/watchTogether.js';
import './modules/drm/init.js';
import './modules/stats/stats.js';
import './modules/flashcards/init.js';
import './modules/reader/init.js';


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

