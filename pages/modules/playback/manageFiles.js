import {resetHoveredWordsCount, setSubs} from "../subtitler/subtitler.js";
import {readSubtitleFile} from "../subtitler/subUtils.js";
import {addToRecentlyWatched} from "./recentlyWatched.js";
import Hls from "../../lib/hls.mjs";
import {
    currentPlayingVideo,
    loadStream,
    setCurrentPlayingVideo,
    setIsCurrentlyPlayingVideo,
    setPlaybackType
} from "./streaming.js";
import {playPauseButton, video} from "./elements.js";
import {loadWatchTime} from "../stats/saving.js";
import {isLoaded} from "../load.js";

let currentSubtitleFile = null;

const manageFiles = async (files) => {
    console.log(files);
    if (files.length > 0) {
        const file = files[0];
        const fileName = file.name;
        console.log("file.type",file.type);
        if (file.type === 'video/mp4' || fileName.endsWith('mkv')) {
            $("video source")[0].src = URL.createObjectURL(file);
            console.log("set src to", URL.createObjectURL(file));
            setPlaybackType("local");
            resetHoveredWordsCount();
            $("#video-quality").addClass("hidden");
            video.load();
            video.play();
            setCurrentPlayingVideo(file.name);
            loadWatchTime();
            setIsCurrentlyPlayingVideo(true);
            $(".recently-c").addClass("hide");
            localStorage.setItem('currentVideo', file.name);
            playPauseButton.innerHTML = '<img src="assets/icons/pause.svg">';
            video.addEventListener('loadedmetadata', () => {
                let [width, height] = [video.videoWidth, video.videoHeight];
                if(width>1200){
                    height = height * (1200/width);
                    width = 1200;
                }
                window.electron_settings.resizeWindow({width: width, height: height});
            });
        } else if (fileName.endsWith('.srt') || fileName.endsWith('.ass')) {
            console.log('Subtitle file dropped:', fileName);
            let temp = await readSubtitleFile(file);
            currentSubtitleFile = fileName;
            // sort subtitles by starting time
            setSubs(temp.sort((a, b) => a.start - b.start));
            if(video.currentTime >= 10){
                addToRecentlyWatched(currentPlayingVideo);
            }
        } else /*if (fileName.endsWith('.m3u8')){
                let text = ...;
                if(Hls.isSupported()) {
                    loadStream(text);
                }else{
                    console.error("HLS NOT SUPPORTED");
                }
            } else*/ {
            $(".critical-error-c").remove();
            $("body").append(`<div class="critical-error-c"><div class="critical-error"><span>Error: <br>Please drop a .mp4, .srt or .ass file.</span></div></div>`);
            setTimeout(()=>{
                $(".critical-error-c").remove();
            },5000);
        }
    }
}
document.addEventListener('paste', async (event) => {
    if(!isLoaded) return;
    const items = event.clipboardData.items;
    for (let item of items) {
        if (item.kind === 'file') {
            manageFiles([item.getAsFile()]);
            break;
        } else if (item.kind === 'string') {
            item.getAsString((text) => {
                if (text.startsWith('http')) {
                    if(text.endsWith('.m3u8') || text.endsWith('.txt')){
                        if(Hls.isSupported()) {
                            loadStream(text);
                        }else{
                            console.error("HLS NOT SUPPORTED");
                        }
                    }else{
                        $("video source")[0].src = text;
                        setPlaybackType("stream");
                        resetHoveredWordsCount();
                        $("#video-quality").addClass("hidden");
                        video.play();
                        currentPlayingVideo = text;
                        loadWatchTime();
                        setIsCurrentlyPlayingVideo(true);
                        localStorage.setItem('currentVideo', text);
                        $(".recently-c").addClass("hide");
                    }
                }
            });
            break;
        }
    }
});
document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if(!isLoaded) return;
    $(".critical-error-c").remove();
    manageFiles(e.dataTransfer.files);
});

export {manageFiles, currentSubtitleFile};