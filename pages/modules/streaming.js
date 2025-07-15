import {hoveredWords, hoveredWordsCount, resetHoveredWordsCount, setHoveredWordsCount} from "./subtitler.js";
import Hls from "../hls.mjs";
import {playPauseButton, qualitySelect, video} from "./elements.js";
import {isWatchTogether} from "./watchTogether.js";
import {loadWatchTime} from "./saving.js";
import {currentSubtitleFile} from "./manageFiles.js";
import {parseSubtitleName} from "./subtitleParsers.js";


let HLSObject = null;
let currentPlayingVideo = null;
let playbackType = null;
let isCurrentlyStreamingVideo = false;
let isCurrentlyPlayingVideo = false;

function updateBufferBar() {
    if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const duration = video.duration;
        if (duration > 0) {
            const bufferWidth = (bufferedEnd / duration) * 100;
            //change body css variable
            document.body.style.setProperty('--buffer-width', `${bufferWidth}%`);
        }
    }
}
function loadStream (text) {
    if(HLSObject) HLSObject.destroy();
    resetHoveredWordsCount();
    playbackType = "stream";
    HLSObject = new Hls();
    HLSObject.loadSource(text);
    HLSObject.attachMedia(video);
    currentPlayingVideo = text;

    if(isWatchTogether){
        window.electron_settings.watchTogetherSend({action:"start", url:text});
    }

    $("#video-quality").removeClass("hidden");
    HLSObject.on(Hls.Events.MANIFEST_PARSED, function () {
        video.play();
        isCurrentlyStreamingVideo = true;
        isCurrentlyPlayingVideo = true;
        loadWatchTime();
        localStorage.setItem('currentVideo', text);
        playPauseButton.innerHTML = '<img src="assets/icons/pause.svg">';
        video.addEventListener('loadedmetadata', () => {
            let [width, height] = [video.videoWidth, video.videoHeight];
            //max width:1200
            if (width > 1200) {
                height = height * (1200 / width);
                width = 1200;
            }
            window.electron_settings.resizeWindow({width: width, height: height});
            if(isWatchTogether){
                window.electron_settings.watchTogetherSend({action:"play", time:video.currentTime}); //synchronize with client
            }
        });
        const levels = HLSObject.levels;
        qualitySelect.innerHTML = '<option value="-1">Auto</option>';
        levels.forEach((level, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.text = `${level.height}p`;
            if(level.height != 0)
                qualitySelect.appendChild(option);
        });
    });
    HLSObject.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        console.log(`Switched to level ${data.level}`);
    });

    qualitySelect.addEventListener('change', (event) => {
        HLSObject.currentLevel = parseInt(event.target.value, 10);
    });
    HLSObject.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        console.log(`Switched to level ${data.level}`);
    });
    HLSObject.on(Hls.Events.ERROR, function (event, data) {
        if (data.fatal) {
            switch (data.type) {
                case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('fatal media error encountered, try to recover');
                    HLSObject.recoverMediaError();
                    break;
                case Hls.ErrorTypes.NETWORK_ERROR:
                    console.error('fatal network error encountered', data);
                    show_notification("Network error encountered, are you using a VPN? Is your internet connection stable?");
                    break;
                default:
                    // cannot recover
                    show_notification("Fatal streaming error encountered, try again.");
                    HLSObject.destroy();
                    break;
            }
        }
    });

    HLSObject.on(Hls.Events.BUFFER_APPENDING, () => {
        updateBufferBar();
    });

    HLSObject.on(Hls.Events.BUFFER_APPENDED, () => {
        updateBufferBar();
    });

    HLSObject.on(Hls.Events.BUFFER_FLUSHED, () => {
        updateBufferBar();
    });
    $(".recently-c").addClass("hide");
}




const onVideoEnded = (videoUrl) => {
    console.log("ENDED")
    isCurrentlyStreamingVideo = false;
    isCurrentlyPlayingVideo = false;
    let videoStats = JSON.parse(localStorage.getItem("videoStats"));
    localStorage.removeItem(`videoCurrentTime_${btoa(currentPlayingVideo)}`); //reset time
    if(!videoStats) videoStats = [];
    //if url already exists, merge
    let exists = false;
    for(let videoStat of videoStats){
        if(videoStat.url === videoUrl){
            videoStat.words += hoveredWordsCount;
            localStorage.setItem("videoStats",JSON.stringify(videoStats));
            exists = true;
        }
    }
    if(!exists)
        videoStats.push({url:videoUrl,words:hoveredWordsCount, name:parseSubtitleName(currentSubtitleFile)});
    setHoveredWordsCount(videoStats[videoStats.length-1].words); //fixed bug where hoveredWordsCount was not up-to-date
    //if more than 10
    if(videoStats.length>10){
        videoStats.shift();
    }
    $(".stats-c .word-count").text(hoveredWordsCount);
    let word_lookup_html = "";
    //sort by count
    let sortable = [];
    for (let word in hoveredWords) {
        sortable.push([word, hoveredWords[word]]);
    }
    sortable.sort((a, b)=>b[1] - a[1]);
    let sortedHoveredWords = {};
    sortable.forEach((item)=>{
        sortedHoveredWords[item[0]] = item[1];
    });
    for(let word in sortedHoveredWords){
        word_lookup_html += `<div class="word-lookup-item"><span class="word">${word}</span>: <span class="count">${sortedHoveredWords[word]}</span></div>`;
    }
    $(".stats-c .word-lookup").html(word_lookup_html);
    localStorage.setItem("videoStats",JSON.stringify(videoStats));
    resetHoveredWordsCount();
    $(".stats-c").removeClass("hide");

    const canvas = document.getElementById('stats-chart');
    const ctx = canvas.getContext('2d');

    let data = videoStats.map((videoStat)=>videoStat.words);
    let labels = [];

    const chartWidth = canvas.width;
    const chartHeight = canvas.height;
    const barWidth = chartWidth / data.length;
    let maxLength = Math.floor(barWidth/20);
    for(let videoStat of videoStats){
        //truncate the name
        labels.push(videoStat.name.length>maxLength?videoStat.name.substring(0,maxLength)+"...":videoStat.name);
    }
    labels[labels.length-1] = "Now";
    ctx.clearRect(0, 0, chartWidth, chartHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '16px Helvetica';

    data.forEach((value, index) => {
        const barHeight = (value / Math.max(...data)) * chartHeight;
        const x = index * barWidth;
        const y = chartHeight - barHeight;

        if(index==data.length-1)
            ctx.fillStyle = '#4374BD';
        else
            ctx.fillStyle = '#777';
        ctx.fillRect(x, y, barWidth - 10, barHeight);
        console.log(labels[index],x + (barWidth - 10) / 2, chartHeight - 5);
        ctx.fillStyle = '#FFFFFF'; // Change this to your desired text color
        ctx.fillText(labels[index], x + (barWidth - 10) / 2, chartHeight - 5);
        //put just under the bar end
        if(value>0)
            ctx.fillText(value, x + (barWidth - 10) / 2, y + 20);
    });
}


video.addEventListener('ended', () => {
    onVideoEnded(currentPlayingVideo);
});

function setPlaybackType(type) {
    playbackType = type;
}

function setCurrentPlayingVideo(a){
    currentPlayingVideo = a;
}
function setIsCurrentlyPlayingVideo(a){
    isCurrentlyPlayingVideo = a;
}

export {currentPlayingVideo, playbackType, isCurrentlyStreamingVideo, isCurrentlyPlayingVideo, loadStream, setPlaybackType, setCurrentPlayingVideo, setIsCurrentlyPlayingVideo, onVideoEnded}