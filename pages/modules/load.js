import {loadRecentlyWatched, updateLastWatchedFromIPC} from "./playback/recentlyWatched.js";
import {loadAlreadyUpdatedInAnki, loadKnownAdjustment, updateFlashcardsAnkiDate} from "./stats/saving.js";
import {
    backwardButton,
    forwardButton,
    progressBar,
    video,
    videoControls,
    volumeSlider
} from "./playback/elements.js";
import {saveSettings, settings} from "./settings/settings.js";
import {addAllFlashcardsToAnki} from "./flashcards/anki.js";
import {isWatchTogether} from "./watch-together/watchTogether.js";

// Performance timing: record when the page JS first executes (approx page open)
let __pageOpenTimestamp = performance.now();
let __animInterval = null;  
let isLoaded = false;

function updateMaxLocalStorage(key, value){
    try{
        const prev = parseFloat(localStorage.getItem(key));
        if(isNaN(prev) || value > 1000){
            localStorage.setItem(key, String(value));
        }
    }catch(e){
        console.warn('Failed updating localStorage metric', key, e);
    }
}

// Keys used for metrics
const METRIC_TIME_TO_SERVER_LOAD = 'metric_time_to_server_load_ms';

document.addEventListener('DOMContentLoaded', () => {
    loadRecentlyWatched();
    window.mLearnIPC.isLoaded();
});
setTimeout(()=>{window.mLearnIPC.isLoaded();},1000);

function onSettingsLoaded(){
    if(settings.openAside){
        $(".aside").show();
    }else{
        $(".aside").hide();
    }
}

window.mLearnIPC.onServerLoad(() => {
    $(".critical-error-c").remove();
    $(".loading").addClass("not-shown");


    //only once
    if(isLoaded) return;
    isLoaded = true;
    console.log("Server loaded");
    clearInterval(__animInterval);
    // Record time to server load (from initial script execution)
    const timeToServerLoad = performance.now() - __pageOpenTimestamp;
    updateMaxLocalStorage(METRIC_TIME_TO_SERVER_LOAD, timeToServerLoad);
    console.log('[metrics] time to server load (ms):', timeToServerLoad);
    window.mLearnIPC.isWatchingTogether();
    loadKnownAdjustment();
    loadAlreadyUpdatedInAnki();
// document.addEventListener('DOMContentLoaded', () => {

    let isDragging = false;
    let offsetX, offsetY;
    let isInteractingWithProgressBar = false;



    const updateVideoControlsPosition = () => {
        const centerXPercentage = ((videoControls.offsetLeft + videoControls.offsetWidth / 2) / window.innerWidth) * 100;
        const centerYPercentage = ((videoControls.offsetTop + videoControls.offsetHeight / 2) / window.innerHeight) * 100;
        videoControls.dataset.centerXPercentage = centerXPercentage;
        videoControls.dataset.centerYPercentage = centerYPercentage;
    };

    const scaleVideoControls = () => {
        const centerXPercentage = parseFloat(videoControls.dataset.centerXPercentage);
        const centerYPercentage = parseFloat(videoControls.dataset.centerYPercentage);
        videoControls.style.left = `${(centerXPercentage / 100) * window.innerWidth - videoControls.offsetWidth / 2}px`;
        videoControls.style.top = `${(centerYPercentage / 100) * window.innerHeight - videoControls.offsetHeight / 2}px`;
    };

    window.addEventListener('resize', scaleVideoControls);



    volumeSlider.addEventListener('input', () => {
        video.volume = volumeSlider.value;
    });



    progressBar.addEventListener('input', () => {
        const time = (progressBar.value / 1000) * video.duration;
        video.currentTime = time;
        if(isWatchTogether) {
            window.mLearnIPC.watchTogetherSend({action: "sync", time: time});
        }
    });

    progressBar.addEventListener('mousedown', () => {
        isInteractingWithProgressBar = true;
    });
    volumeSlider.addEventListener('mousedown', () => {
        isInteractingWithProgressBar = true;
    });

    progressBar.addEventListener('mouseup', () => {
        isInteractingWithProgressBar = false;
    });
    volumeSlider.addEventListener('mouseup', () => {
        isInteractingWithProgressBar = false;
    });

    forwardButton.addEventListener('click', () => {
        video.currentTime += 10; // Skip forward 10 seconds
    });

    backwardButton.addEventListener('click', () => {
        video.currentTime -= 10; // Skip backward 10 seconds
    });

    videoControls.addEventListener('mousedown', (e) => {
        if (!isInteractingWithProgressBar) {
            isDragging = true;
            offsetX = e.clientX - videoControls.getBoundingClientRect().left;
            offsetY = e.clientY - videoControls.getBoundingClientRect().top;
            videoControls.style.cursor = 'grabbing';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;

            // Ensure the controls stay within the window bounds
            const minLeft = 0;
            const minTop = 0;
            const maxLeft = window.innerWidth - videoControls.offsetWidth;
            const maxTop = window.innerHeight - videoControls.offsetHeight;

            if (newLeft < minLeft) newLeft = minLeft;
            if (newTop < minTop) newTop = minTop;
            if (newLeft > maxLeft) newLeft = maxLeft;
            if (newTop > maxTop) newTop = maxTop;

            videoControls.style.left = `${(newLeft / window.innerWidth) * 100}%`;
            videoControls.style.top = `${(newTop / window.innerHeight) * 100}%`;
            videoControls.style.transform = 'none'; // Disable centering transform
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        videoControls.style.cursor = 'default';
        updateVideoControlsPosition();
    });

    updateVideoControlsPosition();
    scaleVideoControls(); // Ensure correct initial position


    let hideControlsTimeout;

    const showControls = () => {
        videoControls.classList.add('visible');
        document.body.classList.remove('hide-cursor');
        window.mLearnIPC.changeTrafficLights(true);
        clearTimeout(hideControlsTimeout);
        hideControlsTimeout = setTimeout(() => {
            videoControls.classList.remove('visible');
            document.body.classList.add('hide-cursor');
            window.mLearnIPC.changeTrafficLights(false);
        }, 2000); // Hide controls after 2 seconds of inactivity
    };

    document.addEventListener('mousemove', showControls);

    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });




    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.mLearnIPC.showCtxMenu();
    });

    window.mLearnIPC.onOpenAside(()=>{
        $(".aside").show();
        settings.openAside = true;
        saveSettings();
    });
    $(".aside .close").click(()=>{
        $(".aside").hide();
        settings.openAside = false;
        saveSettings();
    });

    $(".add-all-to-anki").click(()=>{
        addAllFlashcardsToAnki();
    });

    $(".update-flashcards-due-date").click(()=>{
        updateFlashcardsAnkiDate();
    });


    window.mLearnIPC.onContextMenuCommand((cmd)=>{
        switch(cmd){
            case 'sync-subs':
                $(".sync-subs").removeClass("not-shown");
                $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
                break;
        }
    });

    // Consume "last watched" updates from tethered core via server bridge
    window.mLearnIPC.onUpdateLastWatched((message)=>{
        try{
            const arr = JSON.parse(message);
            if(Array.isArray(arr)){
                arr.forEach(item => updateLastWatchedFromIPC(item));
            }
        }catch(e){
            console.warn('Failed to process last-watched IPC message', e);
        }
    });
});

window.mLearnIPC.onServerStatusUpdate((message) => {
    if(message.includes("Waiting for application startup.")){
        $("#status-update").html("Waiting for Anki");
    }else if(message.includes("Arguments")){
        $("#status-update").html("Loading Dictionaries...");
    }
});
$(document).ready(() => {
    let animType = "progress";
    __animInterval = setInterval(() => {
        const timeSincePageOpen = performance.now() - __pageOpenTimestamp;
        const ls = localStorage.getItem(METRIC_TIME_TO_SERVER_LOAD);
        let progress = null;
        if(ls === null)
            progress = 2;
        else
            progress = timeSincePageOpen/ls;
        if(progress > 1 && animType != "indeterminate") {
            progress = 1;
            animType = "indeterminate";
            __pageOpenTimestamp = performance.now();
        };
        if(animType == "progress") {
            $(".loading .progress-bar .progress").css("width",`${100*progress}%`);
            return;
        }
        $(".loading .progress-bar .progress").css("width",`${(Math.sin(timeSincePageOpen/250)*5)+15}%`).css("margin-left",`${((timeSincePageOpen/15)%120)-20}%`);
    });
});
export {isLoaded,onSettingsLoaded};