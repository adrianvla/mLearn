import {video} from "../playback/elements.js";
import {settings, saveSettings} from "../settings/settings.js";
import {knownAdjustment} from "./saving.js";

let timeWatched = 0;
let lastUpdateTime = 0;
let isTracking = false;

// Initialize time watched from settings
const initTimeWatched = () => {
    timeWatched = settings.timeWatched || 0;
};

// Start tracking time watched
const startTimeTracking = () => {
    if (!isTracking && video && !video.paused) {
        isTracking = true;
        lastUpdateTime = Date.now();
    }
};

// Stop tracking time watched
const stopTimeTracking = () => {
    if (isTracking) {
        updateTimeWatched();
        isTracking = false;
    }
};

// Update time watched and save to settings
const updateTimeWatched = () => {
    if (isTracking && lastUpdateTime > 0) {
        const currentTime = Date.now();
        const elapsed = Math.floor((currentTime - lastUpdateTime) / 1000); // Convert to seconds
        timeWatched += elapsed;
        settings.timeWatched = timeWatched;
        // console.log(`%cTime watched updated: ${timeWatched} seconds`, "color: green; font-weight: bold;");
        saveSettings();
        lastUpdateTime = currentTime;
    }
};

// Get time watched in seconds
const getTimeWatchedSeconds = () => {
    return timeWatched;
};

const setTimeWatchedSeconds = (seconds) => {
    if (typeof seconds === 'number' && seconds >= 0) {
        timeWatched = seconds;
        settings.timeWatched = timeWatched;
        saveSettings();
    } else {
        console.error("Invalid seconds value:", seconds);
    }
}
window.setTimeWatchedSeconds = setTimeWatchedSeconds;

// Format time watched in English (e.g., "2 days 3 hours 45 minutes 12 seconds")
const getTimeWatchedFormatted = () => {
    const totalSeconds = timeWatched;

    if (totalSeconds === 0) {
        return "0 seconds";
    }

    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = totalSeconds % 60;

    const parts = ["Time watched:"];

    if (days > 0) {
        parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    }
    if (hours > 0) {
        parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    }
    if (minutes > 0) {
        parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    }
    if (seconds > 0) {
        parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
    }

    if (parts.length === 0) {
        return "0 seconds";
    }

    return parts.join('<br>');
};

// Set up video event listeners for automatic tracking
const setupVideoTracking = () => {
    if (!video) return;

    video.addEventListener('play', startTimeTracking);
    video.addEventListener('pause', stopTimeTracking);
    video.addEventListener('ended', stopTimeTracking);

    // Update time watched every 10 seconds while playing
    setInterval(() => {
        if (isTracking) {
            updateTimeWatched();
        }
    }, 10000);

    // Also update when page is about to unload
    window.addEventListener('beforeunload', () => {
        if (isTracking) {
            updateTimeWatched();
        }
    });
};

// Initialize when settings are loaded
if (typeof window !== 'undefined' && window.settings) {
    initTimeWatched();
    setupVideoTracking();
} else {
    // Wait for settings to be loaded
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            initTimeWatched();
            setupVideoTracking();
        }, 100);
    });
}

function getWordsLearnedInApp(){
    let byStatus = {};
    for(const k of Object.keys(knownAdjustment)){
        byStatus[knownAdjustment[k]] = (byStatus[knownAdjustment[k]] || 0) + 1;
    }
    return byStatus;
}

function getWordsLearnedInAppFormatted(){
    const wordsLearned = getWordsLearnedInApp();
    let result = "Words learned in app:<br>";
    const lookupStatus = {
        0: "Viewed",
        1: "Learning",
        2: "Learned"
    };
    for(const status of Object.keys(wordsLearned)){
        result += `${lookupStatus[status]}: ${wordsLearned[status]} words<br>`;
    }
    return result;
}



export {
    initTimeWatched,
    startTimeTracking,
    stopTimeTracking,
    updateTimeWatched,
    getTimeWatchedSeconds,
    getTimeWatchedFormatted,
    setupVideoTracking,
    getWordsLearnedInApp,
    getWordsLearnedInAppFormatted
};
