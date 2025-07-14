import {playPauseButton, video} from "./elements.js";
import {currentPlayingVideo, isCurrentlyStreamingVideo} from "./streaming.js";

let isWatchTogether = false;




window.electron_settings.onWatchTogetherLaunch((e) => {
    isWatchTogether = true;
});
window.electron_settings.onServerLoad(()=>{
    window.electron_settings.onWatchTogetherRequest((data)=>{
        if(isWatchTogether && isCurrentlyStreamingVideo){
            window.electron_settings.watchTogetherSend({action:"request-response", url:currentPlayingVideo, time:video.currentTime, video_playing:!video.paused});
        }
    });
});

const playPause = () => {
    if(!isWatchTogether) return;
    if (video.paused)
        window.electron_settings.watchTogetherSend({action:"play", time:video.currentTime});
    else
        window.electron_settings.watchTogetherSend({action:"pause", time:video.currentTime});

};
playPauseButton.addEventListener('click', playPause);

export {isWatchTogether};