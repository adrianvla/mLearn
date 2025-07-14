import $ from './jquery.min.js'
import {
    saveKnownAdjustment,
    setKnownAdjustment
} from "./modules/saving.js";
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

    window.electron_settings.onServerLoad((message) => {
        $(".critical-error-c").remove();
        $(".loading").addClass("not-shown");
    });
    window.electron_settings.onServerStatusUpdate((message) => {
        if(message.includes("Waiting for application startup.")){
            $("#status-update").html("Waiting for Anki");
            $(".loading .progress-bar .progress").animate({width:"50%"},300);
        }else if(message.includes("Arguments")){
            $("#status-update").html("Anki is ready");
            $(".loading .progress-bar .progress").animate({width:"100%"},300);
        }
    });
    window.electron_settings.sendLS(localStorage);
    window.electron_settings.onUpdatePills((message)=>{
        const u = JSON.parse(message);
        console.log("Received queued pill updates: ",u);
        u.forEach(async (pair) => {
            setKnownAdjustment(pair.word,parseInt(pair.status));
        });
        saveKnownAdjustment();
    });
})();

