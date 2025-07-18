import {loadStream, playbackType} from "./streaming.js";
import $ from '../jquery.min.js';
import {currentSubtitleFile} from "./manageFiles.js";
import {parseSubtitleName} from "./subtitleParsers.js";

const loadRecentlyWatched = () => {
    const recentlyWatched = localStorage.getItem('recentlyWatched');
    if (recentlyWatched) {
        JSON.parse(recentlyWatched).forEach(item => {
            console.log("Loading recently watched item:", item);
            if(!item.screenshotUrl || item.screenshotUrl == "data:," || !item.name) return; // Skip if videoUrl or screenshotUrl is missing
            let appendable = $(`<div class="card">
                    <img src="${item.screenshotUrl}">
                    <p>${item.name ? item.name : ""}</p>
                </div>`);
            appendable.click(()=>{
                loadStream(item.videoUrl);
            });
            $('.recently-c .recently .cards').append(appendable);
        });
    }else{
        $(".recently-c").hide();
    }
};

const addToRecentlyWatched = (videoUrl) => {
    console.log("Adding to recently watched");
    if(playbackType === "local") return;
    console.log("Adding to recently watched 2");
    const recentlyWatched = localStorage.getItem('recentlyWatched');
    let recentlyWatchedArray = recentlyWatched ? JSON.parse(recentlyWatched) : [];

    // Create a canvas element
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const video = document.getElementById('fullscreen-video');

    // Set canvas dimensions to match the video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the current video frame on the canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert the canvas to an image URL
    const screenshotUrl = canvas.toDataURL('image/png');

    // Check if the video URL is already in the array
    const existingIndex = recentlyWatchedArray.findIndex(item => item.videoUrl === videoUrl);

    // const videoName = currentSubtitleFile ? currentSubtitleFile.replace(/\(.*?\)/g, '').replace(/\.[^/.]+$/, '').replace(/subtitles?/gi,'') : "";
    const videoName = parseSubtitleName(currentSubtitleFile);

    if (existingIndex !== -1) {
        // Update the screenshot URL if the video URL is already in the array
        recentlyWatchedArray[existingIndex].screenshotUrl = screenshotUrl;
        recentlyWatchedArray[existingIndex].name = videoName;
    } else {
        // Add the new video URL and screenshot URL to the array
        recentlyWatchedArray.unshift({ videoUrl, screenshotUrl, name:videoName });
    }

    // Limit the array to the last 5 items
    if (recentlyWatchedArray.length > 5) {
        recentlyWatchedArray.pop();
    }


    // Store the updated array in localStorage
    localStorage.setItem('recentlyWatched', JSON.stringify(recentlyWatchedArray));
    console.log('Added to recently watched:', videoUrl);
};


export { loadRecentlyWatched, addToRecentlyWatched };