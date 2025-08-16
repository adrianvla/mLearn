import {video} from "../playback/elements.js";
import {settings, saveSettings} from "../settings/settings.js";
import {getLicenseType} from "./init.js";

const MAX_DAILY_WATCH_SECONDS = 3600; // 1 hour
let notificationFlag = true;

function getTodayDateString() {
    const now = new Date();
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

function updateWatchTime(seconds) {
    const today = getTodayDateString();
    if (settings.video_watch_date !== today) {
        settings.video_watch_date = today;
        settings.video_watch_time = 0;
        notificationFlag = true;
    }
    settings.video_watch_time = (settings.video_watch_time || 0) + seconds;
    console.log(`Updated watch time: ${settings.video_watch_time} seconds for date ${today}`);
}
function resetWatchTime() {
    settings.video_watch_time = 0;
    settings.video_watch_date = getTodayDateString();
    notificationFlag = true;
    saveSettings(); // debug: always save immediately
}
window.resetWatchTime = resetWatchTime;
function setWatchTime(seconds) {
    const today = getTodayDateString();
    settings.video_watch_date = today;
    settings.video_watch_time = seconds;
    notificationFlag = true;
    console.log(`Set watch time: ${settings.video_watch_time} seconds for date ${today}`);
}
window.setWatchTime = setWatchTime;

function isWatchLimitExceeded() {
    const today = getTodayDateString();
    if (settings.video_watch_date !== today) return false;
    return (settings.video_watch_time || 0) >= MAX_DAILY_WATCH_SECONDS;
}

function blockVideoIfNeeded() {
    if (getLicenseType() >= 1) return; // Pro license disables block
    if (isWatchLimitExceeded()) {
        console.log("Watch limit exceeded");
        video.pause();
        video.style.filter = "grayscale(1)";
        if(notificationFlag){
            setTimeout(()=>{
                alert(`You have reached your daily watch limit of 1h. Please come back tomorrow.\n\nIf you want to watch more, please consider upgrading to Pro license.`);
            },50);
            notificationFlag = false; // Prevent multiple alerts
        }
    }
}

// Track watch time
let lastTimeUpdate = null;
let saveSettingsInterval = null;
function startPeriodicSave() {
    if (saveSettingsInterval) return;
    saveSettingsInterval = setInterval(() => {
        if (!video.paused && !video.ended) {
            saveSettings();
        }
    }, 10000);
}
function stopPeriodicSave() {
    if (saveSettingsInterval) {
        clearInterval(saveSettingsInterval);
        saveSettingsInterval = null;
    }
}

video.addEventListener("play", () => {
    blockVideoIfNeeded();
    lastTimeUpdate = video.currentTime;
    startPeriodicSave();
});
video.addEventListener("pause", stopPeriodicSave);
video.addEventListener("timeupdate", () => {
    if (getLicenseType() >= 1) return;
    if (video.paused || video.ended) return;
    const now = video.currentTime;
    if (lastTimeUpdate !== null && now > lastTimeUpdate) {
        updateWatchTime(now - lastTimeUpdate);
        blockVideoIfNeeded();
    }
    lastTimeUpdate = now;
});
video.addEventListener("ended", () => {
    lastTimeUpdate = null;
    stopPeriodicSave();
});
video.addEventListener("seeking", () => {
    // Pause watch time tracking during seeking
    lastTimeUpdate = null;
});
video.addEventListener("seeked", () => {
    // Resume tracking from the new position
    lastTimeUpdate = video.currentTime;
});
window.mLearnIPC.onLicenseActivated(m=>{
    if(m.license < 1) return;
    resetWatchTime();
    video.style.filter = "none";
});

export { blockVideoIfNeeded, isWatchLimitExceeded, updateWatchTime };
