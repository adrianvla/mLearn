import {loadRecentlyWatched} from "./recentlyWatched.js";
import {loadAlreadyUpdatedInAnki, loadKnownAdjustment, updateFlashcardsAnkiDate} from "./saving.js";
import {
    backwardButton,
    forwardButton,
    progressBar,
    video,
    videoControls,
    volumeSlider
} from "./elements.js";
import {saveSettings, settings} from "./settings.js";
import {addAllFlashcardsToAnki} from "./flashcards.js";
import {isWatchTogether} from "./watchTogether.js";


let isLoaded = false;

document.addEventListener('DOMContentLoaded', () => {
    loadRecentlyWatched();
    window.electron_settings.isLoaded();
});
setTimeout(()=>{window.electron_settings.isLoaded();},1000);

function onSettingsLoaded(){
    if(settings.openAside){
        $(".aside").show();
    }else{
        $(".aside").hide();
    }
}

window.electron_settings.onServerLoad(() => {
    $(".critical-error-c").remove();
    $(".loading").addClass("not-shown");


    //only once
    if(isLoaded) return;
    isLoaded = true;
    console.log("Server loaded");
    window.electron_settings.isWatchingTogether();
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
            window.electron_settings.watchTogetherSend({action: "sync", time: time});
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
        window.electron_settings.changeTrafficLights(true);
        clearTimeout(hideControlsTimeout);
        hideControlsTimeout = setTimeout(() => {
            videoControls.classList.remove('visible');
            document.body.classList.add('hide-cursor');
            window.electron_settings.changeTrafficLights(false);
        }, 2000); // Hide controls after 2 seconds of inactivity
    };

    document.addEventListener('mousemove', showControls);

    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });




    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.electron_settings.showCtxMenu();
    });

    window.electron_settings.onOpenAside(()=>{
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


    window.electron_settings.onContextMenuCommand((cmd)=>{
        switch(cmd){
            case 'sync-subs':
                $(".sync-subs").removeClass("not-shown");
                $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
                break;
        }
    });
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
export {isLoaded,onSettingsLoaded};