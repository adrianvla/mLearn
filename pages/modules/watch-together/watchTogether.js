import {playPauseButton, video} from "../playback/elements.js";
import {currentPlayingVideo, isCurrentlyStreamingVideo} from "../playback/streaming.js";

let isWatchTogether = false;




window.mLearnIPC.onWatchTogetherLaunch((e) => {
    isWatchTogether = true;
});
window.mLearnIPC.onServerLoad(()=>{
    window.mLearnIPC.onWatchTogetherRequest((data)=>{
        if(isWatchTogether && isCurrentlyStreamingVideo){
            window.mLearnIPC.watchTogetherSend({action:"request-response", url:currentPlayingVideo, time:video.currentTime, video_playing:!video.paused});
        }
    });
});

const playPause = () => {
    if(!isWatchTogether) return;
    if (video.paused)
        window.mLearnIPC.watchTogetherSend({action:"play", time:video.currentTime});
    else
        window.mLearnIPC.watchTogetherSend({action:"pause", time:video.currentTime});

};
playPauseButton.addEventListener('click', playPause);

export {isWatchTogether};