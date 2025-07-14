import {playPauseButton, video} from "./elements.js";
import {addToRecentlyWatched} from "./recentlyWatched.js";
import {currentPlayingVideo} from "./streaming.js";

$("#pip").click(()=>{
    video.requestPictureInPicture();
});
const playPause = () => {
    if (video.paused) {
        video.play();
        playPauseButton.innerHTML = '<img src="assets/icons/pause.svg">';
    } else {
        video.pause();
        playPauseButton.innerHTML = '<img src="assets/icons/play.svg">';
        if(video.currentTime < (video.duration-10)) addToRecentlyWatched(currentPlayingVideo);
    }
};
playPauseButton.addEventListener('click', playPause);

window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
        playPause();
    }else if(event.code === 'ArrowRight'){
        video.currentTime += 5;
    }else if(event.code === 'ArrowLeft'){
        video.currentTime -= 5;
    }
});

document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && document.activeElement.tagName === 'BUTTON') {
        event.preventDefault();
    }
});

video.addEventListener('pause', () => {
    localStorage.setItem('videoCurrentTime', video.currentTime);
});