import {loadStream, playbackType} from "./streaming.js";
import $ from '../../lib/jquery.min.js';
import {currentSubtitleFile} from "./manageFiles.js";
import {parseSubtitleName} from "../subtitler/subtitleParsers.js";

const safeJSONParse = (value, fallback, storageKey) => {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        const label = storageKey ? ` for ${storageKey}` : '';
        console.warn(`Failed to parse stored JSON${label}`, error);
        return fallback;
    }
};

const loadRecentlyWatched = () => {
    const $container = $('.recently-c');
    if (!$container.length) return;
    const $recently = $container.find('.recently');
    const $welcomeHero = $recently.find('.welcome-hero');
    const $recentsList = $recently.find('.cards.rec-watched-list');
    const $lastWatched = $recently.find('.cards.last-watched');
    const $headline = $recently.children('h1').first();
    const $lastText = $recently.find('h3.last-watched-text');
    const $lastContent = $recently.find('h3.last-watched-content');

    const storedRecents = safeJSONParse(localStorage.getItem('recentlyWatched'), [], 'recentlyWatched');
    $recentsList.empty();

    let renderedRecents = 0;
    if (Array.isArray(storedRecents)) {
        storedRecents.forEach(item => {
            if (!item || !item.videoUrl) return;
            const screenshotUrl = item.screenshotUrl;
            const displayName = (item.name || parseSubtitleName(item.videoUrl) || '').trim();
            if (!screenshotUrl || screenshotUrl === 'data:,' || !displayName) return;

            const $card = $('<div class="card"></div>');
            const $img = $('<img>').attr('src', screenshotUrl);
            const $label = $('<p></p>').text(displayName);
            $card.append($img, $label);
            $card.on('click', () => loadStream(item.videoUrl));
            $recentsList.append($card);
            renderedRecents++;
        });
    }

    const lastVideoData = safeJSONParse(localStorage.getItem('lastVideo'), null, 'lastVideo');
    $lastWatched.find('.card').remove();

    let hasLastVideo = false;
    if (lastVideoData && lastVideoData.name) {
        hasLastVideo = true;
        $lastText.text('Last watched:');
        $lastContent.text(lastVideoData.name);
        if (lastVideoData.screenshotUrl && lastVideoData.screenshotUrl !== 'data:,') {
            const $card = $('<div class="card"></div>');
            $card.append($('<img>').attr('src', lastVideoData.screenshotUrl));
            $lastWatched.append($card);
        }
    } else {
        $lastText.text('');
        $lastContent.text('');
    }

    const hasRecents = renderedRecents > 0;
    const hasHistory = hasRecents || hasLastVideo;

    $recently.toggleClass('has-recents', hasRecents);
    $recently.toggleClass('has-last-video', hasLastVideo);
    $recently.toggleClass('has-history', hasHistory);
    $welcomeHero.toggleClass('hidden', hasHistory);
    $headline.toggleClass('hidden', !hasRecents);
    $recentsList.toggleClass('hidden', !hasRecents);
    $lastWatched.toggleClass('hidden', !hasLastVideo);
    $container.toggleClass('empty-state', !hasHistory);
};

const addToRecentlyWatched = (videoUrl) => {
    const derivedName = videoUrl.includes('://') ? parseSubtitleName(currentSubtitleFile) : parseSubtitleName(videoUrl);
    const fallbackName = parseSubtitleName(currentSubtitleFile) || 'Untitled session';
    const displayName = (derivedName || fallbackName || '').trim() || 'Untitled session';
    console.log('Adding to recently watched', displayName);

    let recentlyWatchedArray = safeJSONParse(localStorage.getItem('recentlyWatched'), [], 'recentlyWatched');
    if (!Array.isArray(recentlyWatchedArray)) {
        recentlyWatchedArray = [];
    }

    let screenshotUrl = 'data:,';
    const videoEl = document.getElementById('fullscreen-video');
    if (videoEl) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const width = videoEl.videoWidth || videoEl.clientWidth || 0;
        const height = videoEl.videoHeight || videoEl.clientHeight || 0;
        if (context && width > 0 && height > 0) {
            canvas.width = width;
            canvas.height = height;
            context.drawImage(videoEl, 0, 0, width, height);
            screenshotUrl = canvas.toDataURL('image/png');
        }
    }

    localStorage.setItem('lastVideo', JSON.stringify({ name: displayName, screenshotUrl }));

    if (playbackType === 'local') {
        loadRecentlyWatched();
        return;
    }

    const videoName = (parseSubtitleName(currentSubtitleFile) || displayName).trim() || displayName;
    const existingIndex = recentlyWatchedArray.findIndex(item => item.videoUrl === videoUrl);

    if (existingIndex !== -1) {
        recentlyWatchedArray[existingIndex].screenshotUrl = screenshotUrl;
        recentlyWatchedArray[existingIndex].name = videoName;
    } else {
        recentlyWatchedArray.unshift({ videoUrl, screenshotUrl, name: videoName });
    }

    if (recentlyWatchedArray.length > 5) {
        recentlyWatchedArray.length = 5;
    }

    localStorage.setItem('recentlyWatched', JSON.stringify(recentlyWatchedArray));
    console.log('Added to recently watched:', videoUrl);
    loadRecentlyWatched();
};
// Consume last-watched updates from IPC (browser tethered -> server -> renderer)
const updateLastWatchedFromIPC = ({ name, screenshotUrl, videoUrl }) => {
    try{
        if(!name || !screenshotUrl) return;
        localStorage.setItem('lastVideo', JSON.stringify({ name, screenshotUrl }));
        // Optionally maintain the recents list with a synthetic item
        /*
        const recentlyWatched = localStorage.getItem('recentlyWatched');
        let recentlyWatchedArray = recentlyWatched ? JSON.parse(recentlyWatched) : [];
        if(videoUrl){
            const existingIndex = recentlyWatchedArray.findIndex(item => item.videoUrl === videoUrl);
            if (existingIndex !== -1) {
                recentlyWatchedArray[existingIndex].screenshotUrl = screenshotUrl;
                recentlyWatchedArray[existingIndex].name = name;
            } else {
                recentlyWatchedArray.unshift({ videoUrl, screenshotUrl, name });
            }
            if (recentlyWatchedArray.length > 5) recentlyWatchedArray.pop();
            localStorage.setItem('recentlyWatched', JSON.stringify(recentlyWatchedArray));
        }*/
    }catch(e){ console.warn('Failed updating last watched from IPC', e); }
    loadRecentlyWatched();
};

export { loadRecentlyWatched, addToRecentlyWatched, updateLastWatchedFromIPC };