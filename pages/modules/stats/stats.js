import {video} from "../playback/elements.js";
import {settings, saveSettings, lang_data, wordFreq} from "../settings/settings.js";
import {knownAdjustment, changeKnownStatus} from "./saving.js";
import {Flashcards, getAllSRSTrackedWords, getSRSWordKnownStatusUUID, getWordByUUID, addFlashcard, saveFlashcards} from "../flashcards/storage.js";
import {toUniqueIdentifier} from "../utils.js";
import {generateStatusPillHTML} from "../subtitler/pillHtml.js";
import $ from "../../lib/jquery.min.js";
import {getTranslation, setTranslationOverride, getTranslationOverride, clearTranslationOverride} from "../networking.js";

let timeWatched = 0;
let lastUpdateTime = 0;
let isTracking = false;
const lookupStatus = {
    0: "Viewed",
    1: "Learning",
    2: "Learned"
};

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
    const seconds = Math.floor(totalSeconds % 60);

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
async function getWordsLearnedInAppMoreInfo(){
    let trackedWords = {};
    let trackingInfo = {};
    for(const uuid of Object.keys(getAllSRSTrackedWords())){
        trackedWords[uuid] = getSRSWordKnownStatusUUID(uuid);
        trackingInfo[uuid] = "flashcards";
    }
    for(const word of Object.keys(knownAdjustment)){
        const uuid = await toUniqueIdentifier(word);
        trackedWords[uuid] = Math.max(knownAdjustment[word], trackedWords[uuid] || 0);
        if(!(uuid in trackingInfo))
            trackingInfo[uuid] = "user pills";
    }
    return [trackedWords, trackingInfo];
}
async function getWordsLearnedInApp(){
    return (await getWordsLearnedInAppMoreInfo())[0];
}
window.getWordsLearnedInAppMoreInfo = getWordsLearnedInAppMoreInfo;

async function getWordsLearnedInAppStats(){
    const trackedWords = await getWordsLearnedInApp();
    let byStatus = {};
    for(const k of Object.keys(trackedWords)){
        byStatus[trackedWords[k]] = (byStatus[trackedWords[k]] || 0) + 1;
    }
    return byStatus;
}
async function getWordsLearnedInAppFormatted(canvas){
    const wordsLearned = await getWordsLearnedInAppStats();
    let result = "Words learned in app:<br>";

    for(const status of Object.keys(wordsLearned)){
        result += `${lookupStatus[status]}: ${wordsLearned[status]} words<br>`;
    }

    // If no canvas provided, just return the formatted string (backwards compatible)
    if(!canvas) return result;

    const ctx = canvas.getContext('2d');
    if(!ctx) return result;

    // Prepare drawing (responsive, DPR-aware)
    const DPR = (canvas.ownerDocument?.defaultView?.devicePixelRatio) || window.devicePixelRatio || 1;
    const cssWidth = Math.max(360, Math.min(900, canvas.clientWidth || canvas.parentElement?.clientWidth || 600));
    const cssHeight = 260;
    canvas.width = Math.floor(cssWidth * DPR);
    canvas.height = Math.floor(cssHeight * DPR);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Clear
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const total = Object.values(wordsLearned).reduce((a,b)=>a+b,0);
    if(total === 0){
        ctx.fillStyle = settings.dark_mode? '#aaa' : '#444';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No tracked words yet', cssWidth/2, cssHeight/2);
        return result;
    }

    // Layout and styles
    const margin = {top: 18, right: 140, bottom: 18, left: 18};
    const chartW = cssWidth - margin.left - margin.right;
    const chartH = cssHeight - margin.top - margin.bottom;
    const radius = Math.max(20, Math.min(chartW, chartH) / 2);
    const cx = margin.left + chartW/2;
    const cy = margin.top + chartH/2;

    // Order and colors consistent with bar chart
    const statusOrder = [2, 1, 0]; // Learned, Learning, Viewed
    const colors = {
        "Learned": "#4CAF50",
        "Learning": "#FF9800",
        "Viewed": "#9E9E9E",
        "Unknown": "#607D8B"
    };

    // Build segments in defined order, skipping missing
    const segments = statusOrder
        .filter(k => wordsLearned[String(k)] > 0)
        .map(k => {
            const label = lookupStatus[k] || 'Unknown';
            const value = wordsLearned[String(k)] || 0;
            return { key: k, label, value, color: colors[label] || '#777' };
        });

    // Draw pie
    let startAngle = -Math.PI/2; // start at top
    ctx.lineWidth = 1;
    segments.forEach(seg => {
        const angle = (seg.value / total) * Math.PI * 2;
        const endAngle = startAngle + angle;
        // slice
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.fill();
        // optional subtle stroke
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.stroke();

        // label (percentage) if large enough
        const mid = (startAngle + endAngle) / 2;
        // const pct = Math.round((seg.value / total) * 1000) / 10; // one decimal
        if(angle > 0.25){ // ~14 degrees
            const lx = cx + Math.cos(mid) * (radius * 0.6);
            const ly = cy + Math.sin(mid) * (radius * 0.6);
            ctx.fillStyle = '#fff';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${seg.value}`, lx, ly);
        }

        startAngle = endAngle;
    });

    // Title
    ctx.fillStyle = '#ddd';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Words learned in app', margin.left, 14);

    // Legend
    const legendX = cssWidth - margin.right + 10;
    let legendY = margin.top;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    segments.forEach(seg => {
        const pct = Math.round((seg.value / total) * 1000) / 10; // one decimal
        ctx.fillStyle = seg.color;
        ctx.fillRect(legendX, legendY, 14, 14);
        ctx.fillStyle = settings.dark_mode ? '#ccc' : '#444';
        ctx.fillText(`${seg.label} – ${seg.value} (${pct}%)`, legendX + 20, legendY);
        legendY += 20;
    });

    return result;
}

export async function drawWordsLearnedByExamLevel(canvas){
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    if(!ctx) return;
    const NOT_IN_LIST = -1;
    let globalWordsPerLevel = {};
    let trackedWordsPerLevel = {};
    let wordLevelHashMap = {};

    const trackedWords = await getWordsLearnedInApp();
    globalWordsPerLevel[NOT_IN_LIST] = 0;

    // Build per-level counts and a map from UUID -> numeric level
    for(const [word, data] of Object.entries(wordFreq)){
        globalWordsPerLevel[data.raw_level] = (globalWordsPerLevel[data.raw_level] || 0) + 1;
        wordLevelHashMap[await toUniqueIdentifier(word)] = data.raw_level;
    }
    for(const [uuid, status] of Object.entries(trackedWords)){
        const lvlKey = wordLevelHashMap[uuid] || NOT_IN_LIST;
        const statusNamed = lookupStatus[status] || "Unknown";
        if(!(lvlKey in trackedWordsPerLevel)) trackedWordsPerLevel[lvlKey] = {};
        trackedWordsPerLevel[lvlKey][statusNamed] = (trackedWordsPerLevel[lvlKey][statusNamed] || 0) + 1;
    }

    // Prepare drawing
    const DPR = (canvas.ownerDocument?.defaultView?.devicePixelRatio) || window.devicePixelRatio || 1;
    const cssWidth = Math.max(360, Math.min(900, canvas.clientWidth || canvas.parentElement?.clientWidth || 600));
    const cssHeight = 320;
    canvas.width = Math.floor(cssWidth * DPR);
    canvas.height = Math.floor(cssHeight * DPR);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // Clear
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const totalTracked = Object.values(trackedWordsPerLevel).reduce((acc, o) => acc + Object.values(o).reduce((a,b)=>a+b,0), 0);
    if(totalTracked === 0){
        ctx.fillStyle = '#aaa';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No tracked words yet', cssWidth/2, cssHeight/2);
        return;
    }

    // Columns are defined by globalWordsPerLevel keys (numeric levels)
    const levelsNumeric = Object.keys(globalWordsPerLevel).map(Number).sort((a,b)=> b-a);

    // Status ordering and colors
    const statusOrder = ["Learned", "Learning", "Viewed", "Unknown"];
    const colors = {
        "Learned": "#4CAF50",
        "Learning": "#FF9800",
        "Viewed": "#9E9E9E",
        "Unknown": "#607D8B"
    };

    // Layout
    const margin = {top: 20, right: 160, bottom: 50, left: 40};
    const chartW = cssWidth - margin.left - margin.right;
    const chartH = cssHeight - margin.top - margin.bottom;

    // Scales based on global totals (column capacity)
    const maxGlobal = Math.max(1, ...levelsNumeric.map(l => globalWordsPerLevel[l] || 0));
    const barWidth = Math.max(10, Math.min(60, chartW / Math.max(1, levelsNumeric.length) - 10));
    const gap = (chartW - (barWidth * levelsNumeric.length)) / Math.max(1, levelsNumeric.length + 1);

    // Axes
    ctx.strokeStyle = '#656565';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + chartH);
    ctx.lineTo(margin.left + chartW, margin.top + chartH);
    ctx.stroke();

    // Y ticks (4)
    ctx.fillStyle = '#888';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for(let i=0;i<=4;i++){
        const v = Math.round((maxGlobal * i)/4);
        const y = margin.top + chartH - (chartH * (v / maxGlobal));
        ctx.fillText(String(v), margin.left - 6, y);
        ctx.strokeStyle = 'rgba(100,100,100,0.15)';
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + chartW, y);
        ctx.stroke();
    }

    // Bars
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    levelsNumeric.forEach((lvl, idx) => {
        let totalForLevel = globalWordsPerLevel[lvl] || 0;
        if(lvl === NOT_IN_LIST){
            totalForLevel = 0;
            Object.values(trackedWordsPerLevel[lvl]).forEach(v => totalForLevel += v);
        }
        if(totalForLevel <= 0) return;
        const x = margin.left + gap + idx * (barWidth + gap);
        const hTotal = (totalForLevel / maxGlobal) * chartH;
        const yBase = margin.top + chartH; // bottom

        // Background capacity bar
        ctx.fillStyle = settings.dark_mode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        ctx.fillRect(x, yBase - hTotal, barWidth, hTotal);

        // Tracked stacked fill (proportional to capacity)
        let y = yBase;
        const levelTracked = trackedWordsPerLevel[lvl] || {};
        statusOrder.forEach(status => {
            const value = levelTracked[status] || 0;
            let valueString = (Math.floor(1000*levelTracked[status]/totalForLevel)/10)+"%" || "0%";
            if(lvl === NOT_IN_LIST) valueString = value;
            if(value <= 0) return;
            const h = hTotal * (value / Math.max(1, totalForLevel));
            y -= h;
            ctx.fillStyle = colors[status] || '#777';
            ctx.fillRect(x, y, barWidth, h);
            if(h > 14){
                ctx.fillStyle = '#fff';
                ctx.font = '12px sans-serif';
                ctx.fillText(String(valueString), x + barWidth/2, y + 2);
            }
        });

        // X label
        ctx.fillStyle = settings.dark_mode ? '#ccc' : '#444';
        ctx.font = '12px sans-serif';
        let label = lang_data[settings.language].freq_level_names?.[String(lvl)] || `Level ${lvl}`;
        if(lvl === NOT_IN_LIST) label = `Unlisted ${totalForLevel} words`;
        const maxChars = Math.floor(barWidth/6);
        const lines = label.length > maxChars ? label.split(' ') : [label];
        const labelY = margin.top + chartH + 6;
        lines.slice(0,2).forEach((ln, i) => {
            ctx.fillText(ln, x + barWidth/2, labelY + i*14);
        });
    });

    // Title
    ctx.fillStyle = '#ddd';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Tracked words by exam level', margin.left, 14);

    // Legend
    const legendX = cssWidth - margin.right + 10;
    let legendY = margin.top;
    statusOrder.forEach(status => {
        const present = levelsNumeric.some(l => (trackedWordsPerLevel[l]?.[status] || 0) > 0);
        if(!present) return;
        ctx.fillStyle = colors[status] || '#777';
        ctx.fillRect(legendX, legendY, 14, 14);
        ctx.fillStyle = settings.dark_mode ? '#ccc' : '#444';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(status, legendX + 20, legendY);
        legendY += 20;
    });
}

const WINDOW_HTML_ADJUSTER = `<!doctypehtml>
<html lang="en">
<meta charset="UTF-8">
<title>Edit Word Knowledge Database</title>
<link href="style.css" rel="stylesheet">
<style>body {background: #000}</style>
<body class="settings-body dark">
<div class="search-bar">
    <input type="text" id="word-search-input" placeholder="Search word…">
    <button id="word-search-go" class="button">Search</button>
    <span>Enter to search; exact matches prioritized. If the word doesn't exist, it'll be created.</span>
 </div>
<div class="settingsMenuContent word-adjust-content">
    <div class="entry header">
        <div><span>Word</span></div>
        <div><span>Translation</span></div>
        <div><span>Exam level</span></div>
        <div><span>Tracked by</span></div>
        <div><span>Status</span></div>
    </div>
</div>
<div class="fullscreen-load-blocker">Loading...</div>
</body>
</html>`;
let statsWindow = null;
export async function adjustWordsByLevel(){
    if(statsWindow) return statsWindow.focus();
    statsWindow = window.open("", "WordAdjustWindow", "width=1300,height=800");
    statsWindow.document.write(WINDOW_HTML_ADJUSTER);
    statsWindow.window.addEventListener('unload', () => {
        statsWindow = null;
    });
    let d = statsWindow.document;
    // Cached maps for quick lookups
    const easeByWord = {};

    // Cache: uuid -> word
    const knownMap = {};
    const resolveWord = async (uuid) => {
        if (knownMap[uuid]) return knownMap[uuid];
        const w = await getWordByUUID(uuid);
        if (w) knownMap[uuid] = w;
        return w;
    };
    // Helper: create a flashcard using backend translation data
    async function createFlashcardForWord(word, levelHint){
        const tr = await getTranslation(word);
        if(!tr?.data || tr.data.length === 0) throw new Error('No translation data');
        const content = {
            word,
            pitchAccent: tr.data?.[2]?.[2]?.pitches?.[0]?.position,
            pronunciation: tr.data?.[0]?.reading,
            translation: tr.data?.[0]?.definitions,
            definition: tr.data?.[1]?.definitions,
            example: "-",
            exampleMeaning: "",
            screenshotUrl: "",
            pos: "",
            level: (typeof levelHint === 'number' ? levelHint : (word in wordFreq ? (wordFreq[word]?.raw_level ?? -1) : -1))
        };
        await addFlashcard(word, content, 1.3);
        await saveFlashcards();
        return content;
    }

    // Helper: remove a flashcard for a word and untrack it
    async function removeFlashcardForWord(word){
        const fs = Flashcards();
        const uuid = await toUniqueIdentifier(word);
        try{
            if(Array.isArray(fs.flashcards)){
                const idx = fs.flashcards.findIndex(fc => fc?.content?.word === word);
                if(idx !== -1){ fs.flashcards.splice(idx,1); }
            }
            if(fs.alreadyCreated && (uuid in fs.alreadyCreated)){
                delete fs.alreadyCreated[uuid];
            }
            await saveFlashcards();
        }catch(_e){ /* ignore */ }
    }

    // Re-implement locally so DOM updates target the child document
    // If replaceTarget is provided, replace that element in-place; otherwise append to the list
    async function addEntry(word, translation, level, tracker, status, canBeChanged = false, replaceTarget = null, reading = null, fullTranslation = null, pitch = null){
        const langIsJa = (settings?.language === 'ja');
        const displayWord = (langIsJa && reading && reading !== '-') ? `<ruby>${word}<rt>${reading}</rt></ruby>` : word;
        const fullT = fullTranslation || translation || '';
        const statusPillHTML = await generateStatusPillHTML(word,status);
        const easeVal = easeByWord[word];
        const easePill = (easeVal !== undefined) ? `<div class="pill yellow" title="SRS ease">Ease: ${Math.round(easeVal*100)/100}</div>` : '';
    let el = $(`<div class="entry contains_pills">
    <div style="position:relative;"><span>${displayWord}</span><span class="pill pill-btn gray edit-translation-btn" style="margin-left:8px;">Edit</span></div>
    <div class="translation-cell"><span title="${fullT}">${translation}</span></div>
        <div>
            ${level === -1 || !level ? '-' : '<div class="pill" level="'+level+'">'+lang_data[settings.language].freq_level_names?.[level]+'</div>'}
        </div>
        <div class="tracker-cell"><span class="tracker-label">${tracker}</span></div>
        <div>${statusPillHTML}<div style="margin-left:16px;"></div>${easePill}</div>
        </div>`);
        // Hover to untruncate the translation text
        try{
            const span = el.find('.translation-cell span').get(0);
            if(span){
                span.dataset.fullTranslation = fullT;
                span.dataset.shortTranslation = translation || '';
                if(fullT && fullT !== translation){
                    span.addEventListener('mouseenter', () => { span.textContent = span.dataset.fullTranslation; });
                    span.addEventListener('mouseleave', () => { span.textContent = span.dataset.shortTranslation; });
                }
            }
        }catch(_e){}
        // Edit translation button: open a modal editor with fields for reading, pitch, and definitions
        try{
            const $editBtn = el.find('.edit-translation-btn');
            $editBtn.on('click', async (ev)=>{
                ev.stopPropagation();
                await openEditTranslationDialog(word, el.get(0));
            });
        }catch(_e){}
        // Tracker cell UI: toggle between Add/Remove Flashcard buttons
        try{
            const $trackerCell = el.find('> div:nth-child(4)');
            const $row = el;
            const setTrackerUI = (state) => {
                // label
                $trackerCell.empty().append(`<span class="tracker-label">${state}</span>`);
                // actions
                if(state === 'flashcards'){
                    const $remove = $('<span class="pill pill-btn red" style="margin-left:16px;"><span class="icon">\n' +
                        '        <img src="assets/icons/cross2.svg" alt="">\n' +
                        '    </span><span>Remove Flashcard</span></span>');
                    $trackerCell.append($remove);
                    $remove.on('click', async (ev)=>{
                        ev.stopPropagation();
                        const uuid = $row.attr('data-uuid');
                        $remove.addClass('disabled').text('Removing…');
                        try{
                            await removeFlashcardForWord(word);
                            setTrackerUI('nothing');
                            if(uuid){ $row.attr('data-tracker','nothing'); }
                            if(statsWindow.__wordAdjust && typeof statsWindow.__wordAdjust.setTracker === 'function' && uuid){
                                statsWindow.__wordAdjust.setTracker(uuid, 'nothing');
                            }
                        }catch(_e){
                            $remove.removeClass('disabled').text('Failed');
                            setTimeout(()=>{ setTrackerUI('flashcards'); }, 1200);
                        }
                    });
                } else {
                    const $add = $('<span class="pill pill-btn add-flashcard-btn blue" style="margin-left:16px;"><span class="icon">\n' +
                        '        <img src="assets/icons/cross2.svg" alt="" style="transform: rotate(45deg);">\n' +
                        '    </span><span>Add Flashcard</span></span>');
                    $trackerCell.append($add);
                    $add.on('click', async (ev)=>{
                        ev.stopPropagation();
                        const uuid = $row.attr('data-uuid');
                        $add.addClass('disabled').text('Adding…');
                        try{
                            await createFlashcardForWord(word, level);
                            setTrackerUI('flashcards');
                            if(uuid){ $row.attr('data-tracker','flashcards'); }
                            if(statsWindow.__wordAdjust && typeof statsWindow.__wordAdjust.setTracker === 'function' && uuid){
                                statsWindow.__wordAdjust.setTracker(uuid, 'flashcards');
                            }
                        }catch(_e){
                            $add.removeClass('disabled').text('Failed');
                            setTimeout(()=>{ $add.text('+Add Flashcard'); }, 1200);
                        }
                    });
                }
            };
            const initialTracker = (tracker || '').toString();
            setTrackerUI(initialTracker);
        }catch(_e){}
        // Attach pitch accent overlay for Japanese words when enabled
        try{
            if(settings?.language === 'ja' && settings?.showPitchAccent){
                const $wordSpan = el.find('> div:first-child span').first();
                if($wordSpan && $wordSpan.length){
                    attachPitchAccentToWord($wordSpan, word, reading, pitch);
                }
            }
        }catch(_e){}
        if(replaceTarget){
            // preserve all data-* attributes so sorting and future updates work
            const attrs = replaceTarget.attributes;
            for(let i=0;i<attrs.length;i++){
                const a = attrs[i];
                if(a.name && a.name.startsWith('data-')){
                    el.attr(a.name, a.value);
                }
            }
            if(reading) el.attr('data-reading', reading);
            if(pitch !== null && pitch !== undefined) el.attr('data-pitch', String(pitch));
            $(replaceTarget).replaceWith(el);
        } else {
            if(reading) el.attr('data-reading', reading);
            if(pitch !== null && pitch !== undefined) el.attr('data-pitch', String(pitch));
            $('.word-adjust-content',d).append(el);
        }
    }

    // Modal editor for translation override
    async function openEditTranslationDialog(word, rowEl){
        const doc = statsWindow.document;
        // Remove existing modal if present
        const existing = doc.querySelector('.ml-modal-overlay');
        if(existing) existing.remove();

        // Fetch current data (override or backend)
        let current = getTranslationOverride(word);
        if(!current){
            try { current = await getTranslation(word); } catch(_e){ current = { data: [] }; }
        }
        const curReading = current?.data?.[0]?.reading || rowEl?.getAttribute('data-reading') || '';
        const defs = current?.data?.[0]?.definitions;
        const defsLines = Array.isArray(defs) ? defs.join('\n') : (defs ? String(defs) : '');
        const structured = current?.data?.[1]?.definitions ? String(current.data[1].definitions) : '';
        const curPitch = (()=>{
            try{ return (current?.data?.[2]?.[2]?.pitches?.[0]?.position) ?? ''; }catch{ return ''; }
        })();

        // Build modal DOM
        const overlay = doc.createElement('div');
        overlay.className = 'ml-modal-overlay';
        const modal = doc.createElement('div');
        modal.className = 'ml-modal';
        modal.innerHTML = `
            <div class="ml-modal-header">
                <div style="font-size:16px;font-weight:600;">Edit translation – ${word}</div>
                <button class="ml-close" style="background:transparent;border:0;color:inherit;font-size:18px;cursor:pointer;">×</button>
            </div>
            <div class="ml-modal-content">
                <label>Word</label>
                <input type="text" value="${word}" disabled>

                <label>Reading (furigana)</label>
                <input id="ml-reading" type="text" value="${curReading}" placeholder="かな / reading">

                <label>Pitch accent</label>
                <div class="ml-pitch-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <input id="ml-pitch" type="number" inputmode="numeric" min="0" value="${curPitch}" placeholder="0 (Heiban), 1, 2, 3…" style="flex:0 0 120px; padding:8px; border:1px solid ${settings.dark_mode? '#333':'#ccc'}; background:${settings.dark_mode? '#222':'#fff'}; color:inherit; border-radius:6px;">
                    <div id="ml-pitch-name" style="flex:1 1 auto;opacity:0.9;"></div>
                    <div id="ml-pitch-preview" style="flex:1 1 auto;text-align:right;min-height:24px;"></div>
                </div>
                
                <label>Definitions (one per line)</label>
                <textarea id="ml-defs" rows="6" placeholder="Definition per line">${defsLines}</textarea>

                <label>Structured content (optional)</label>
                <div id="ml-struct" contenteditable="true">${structured}</div>
            </div>
            <div class="ml-modal-footer">
                <button class="ml-revert" style="background:${settings.dark_mode? '#5a1b1b':'#ffdede'};color:${settings.dark_mode? '#ffdede':'#8a0000'};border:1px solid ${settings.dark_mode? '#7a2a2a':'#ffcccc'};border-radius:6px; padding:8px 12px;cursor:pointer;">Remove Override</button>
                <button class="ml-cancel" style="background:${settings.dark_mode? '#2a2b2f':'#f3f3f3'};color:inherit;border:1px solid ${settings.dark_mode? '#333':'#ddd'};border-radius:6px; padding:8px 12px;cursor:pointer;">Cancel</button>
                <button class="ml-save" style="background:#1976d2;color:#fff;border:1px solid #115da6;border-radius:6px; padding:8px 12px;cursor:pointer;">Save</button>
            </div>
        `;
        overlay.appendChild(modal);
        doc.body.appendChild(overlay);

        const byId = (id)=> modal.querySelector('#'+id);
        const $reading = byId('ml-reading');
        const $pitch = byId('ml-pitch');
    const $defs = byId('ml-defs');
    const $struct = byId('ml-struct');
    const $pitchName = modal.querySelector('#ml-pitch-name');
    const $pitchPreview = modal.querySelector('#ml-pitch-preview');

        const close = ()=> overlay.remove();
        modal.querySelector('.ml-close')?.addEventListener('click', close);
        modal.querySelector('.ml-cancel')?.addEventListener('click', close);
        overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });

        function pitchTypeName(p){
            if(p === null || p === undefined || Number.isNaN(p)) return '—';
            if(p === 0) return 'Heiban (平板)';
            if(p === 1) return 'Atamadaka (頭高)';
            if(p === 2) return 'Nakadaka (中高)';
            if(p === 3) return 'Odaka (尾高)';
            if(typeof p === 'number' && Number.isFinite(p) && p >= 4) return `Drop after mora ${p}`;
            return '—';
        }

        function updatePitchPreview(){
            const r = ($reading?.value || '').trim();
            let pStr = ($pitch?.value || '').trim();
            // enforce minimum >= 0
            if(pStr === ''){
                // empty -> treat as 0 (minimum)
                pStr = '0';
                if($pitch) $pitch.value = '0';
            }
            let p = Number(pStr);
            if(!Number.isFinite(p) || p < 0){ p = 0; if($pitch) $pitch.value = '0'; }
            if($pitchName) $pitchName.textContent = pitchTypeName(p);
            if($pitchPreview){
                while($pitchPreview.firstChild) $pitchPreview.removeChild($pitchPreview.firstChild);
                if(r && p !== null && Number.isFinite(p)){
                    const sp = statsWindow.document.createElement('span');
                    sp.textContent = r;
                    $pitchPreview.appendChild(sp);
                    try{ attachPitchAccentToWord($(sp), r, r, p); }catch(_e){}
                }
            }
        }
        // initialize and bind
        updatePitchPreview();
        $reading?.addEventListener('input', updatePitchPreview);
        $pitch?.addEventListener('input', updatePitchPreview);

        async function refreshRowFromData(obj){
            // Extract values for UI
            const r = $reading.value.trim();
            const defsArr = (()=>{
                const raw = $defs.value.split('\n').map(s=>s.trim()).filter(Boolean);
                return raw;
            })();
            const fullT2 = defsArr.join(', ');
            let short = fullT2 || '-';
            if(short.length > 25) short = short.slice(0,25) + '...';
            const p = $pitch.value === '' ? null : Number($pitch.value);
            const level = (wordFreq[word]?.raw_level ?? -1);
            const tracker = rowEl?.getAttribute('data-tracker') || 'nothing';
            const status = parseInt(rowEl?.getAttribute('data-status') || '0');
            await addEntry(word, short, level, tracker, status, false, rowEl, r || null, fullT2, (p===null||Number.isNaN(p))? null : p);
        }

        // Save override
        modal.querySelector('.ml-save')?.addEventListener('click', async ()=>{
            try{
                const reading = $reading.value.trim();
                const pitchVal = $pitch.value.trim();
                const defsArr = $defs.value.split('\n').map(s=>s.trim()).filter(Boolean);
                const structuredVal = $struct.innerHTML.trim();
                const data = [];
                // primary entry
                data.push({ reading, definitions: defsArr });
                // structured entry (optional)
                if(structuredVal && structuredVal.length){ data.push({ reading, definitions: structuredVal }); }
                // pitch entry (optional)
                if(pitchVal !== ''){
                    const pos = Number(pitchVal);
                    if(!Number.isFinite(pos) || pos < 0){ throw new Error('Pitch must be a non-negative integer or empty'); }
                    data.push([word, 'pitch', { reading, pitches: [{ position: pos }] }]);
                }
                const obj = { data };
                setTranslationOverride(word, obj);
                await refreshRowFromData(obj);
                close();
            }catch(err){ statsWindow.alert('Failed to save: ' + err); }
        });

        // Remove override
        modal.querySelector('.ml-revert')?.addEventListener('click', async ()=>{
            try{
                clearTranslationOverride(word);
                // Re-fetch from backend and update UI
                const tr = await getTranslation(word);
                // Prefill fields from backend for user feedback
                $reading.value = tr?.data?.[0]?.reading || '';
                const d0 = tr?.data?.[0]?.definitions;
                $defs.value = Array.isArray(d0) ? d0.join('\n') : (d0 || '');
                const d1 = tr?.data?.[1]?.definitions; $struct.innerHTML = d1 ? String(d1) : '';
                const pv = tr?.data?.[2]?.[2]?.pitches?.[0]?.position; $pitch.value = (pv ?? '').toString();
                await refreshRowFromData(tr);
                close();
            }catch(err){ statsWindow.alert('Failed to revert: ' + err); }
        });
    }

    // Build and attach pitch accent overlay to the provided span element.
    function attachPitchAccentToWord($span, real_word, reading, pitch){
        try{
            if(!reading || reading === '-' || reading.length <= 1) return console.log('attachPitchAccentToWord: skipping', real_word, reading, pitch);
            if(pitch === undefined || pitch === null) return console.log('attachPitchAccentToWord: skipping', real_word, reading, pitch);
            // Construct overlay
            const el = $('<div class="mLearn-pitch-accent"></div>');
            const accent_type = Number(pitch);
            const word_in_letters = String(reading);
            // Build segment flags
            const arr = [];
            for(let i = 0;i<word_in_letters.length;i++){
                switch(accent_type){
                    case 0: // Heiban (平板)
                        arr.push(i!==0);
                        break;
                    case 1: // Atamadaka (頭高)
                        arr.push(i===0);
                        break;
                    case 2: // Nakadaka (中高)
                        arr.push(i===1);
                        break;
                    case 3: // Odaka (尾高)
                        arr.push(i!==0);
                        break;
                    default: //drop after accent_type mora
                        arr.push(i !== 0 && i < accent_type);
                        break;
                }
            }
            let html = '';
            for(let i = 0; i < word_in_letters.length; i++){
                const b = !arr[i];
                const t = arr[i];
                const l = i >= 1 ? (arr[i-1] !== arr[i]) : false;
                let cls = 'box';
                if(b) cls += ' bottom';
                if(t) cls += ' top';
                if(l) cls += ' left';
                html += `<div class="${cls}"></div>`;
            }
            // Particle accent box (matching subtitle behavior; shown always)
            const particle_accent = (accent_type === 0);
            {
                const b = !particle_accent;
                const t = particle_accent;
                const l = (arr[word_in_letters.length-1] !== particle_accent);
                let cls = 'box particle-box';
                if(b) cls += ' bottom';
                if(t) cls += ' top';
                if(l) cls += ' left';
                html += `<div class="${cls}" style="margin-right:${-100/word_in_letters.length}%;"></div>`;
            }
            el.html(html);
            // If we have ruby, append inside rt; else append to span
            const $ruby = $span.find('ruby');
            if($ruby.length && $ruby.find('rt').length){
                $ruby.find('rt').append(el);
                $span.css('--pitch-accent-height', '2px');
            } else {
                $span.append(el);
                if($span.css('position') === 'static' || !$span.css('position')){ $span.css('position','relative'); }
                $span.css('--pitch-accent-height', '5px');
            }
        }catch(_e){console.log(_e)}
    }

    $(d).ready(async ()=>{
        $('body',d).removeClass('dark').removeClass('light').addClass(settings.dark_mode ? 'dark' : 'light');
        let [trackedWords,trackingInfo] = await getWordsLearnedInAppMoreInfo();
        const fs = Flashcards();
        // Build ease cache once for quick status rendering
        try{
            if(Array.isArray(fs?.flashcards)){
                for(const fc of fs.flashcards){
                    const w = fc?.content?.word;
                    if(w && easeByWord[w] === undefined) easeByWord[w] = fc.ease;
                }
            }
        }catch(_e){}
        // Build an index of items for sorting
    const itemsIndex = {};
        const uuids = Object.keys(trackedWords);
    uuids.forEach(uuid => {
            itemsIndex[uuid] = {
                uuid,
                status: Number(trackedWords[uuid]),
                tracker: trackingInfo[uuid] || 'unknown',
                word: undefined,
                translation: undefined,
                level: undefined,
        reading: undefined,
            };
        });

        // Prepare IntersectionObserver for on-demand rendering within the child window
        const visibleTimers = new Map(); // element -> timeout id
        const visibleSet = new Set(); // elements currently visible
        const io = new statsWindow.IntersectionObserver(async (entries) => {
            for(const entry of entries){
                const ph = entry.target;
                if(ph.dataset.loaded === '1') { io.unobserve(ph); continue; }
                if(entry.isIntersecting){
                    // mark visible and start a 1s timer if not running
                    visibleSet.add(ph);
                    if(!visibleTimers.has(ph)){
                        const tid = statsWindow.setTimeout(async () => {
                            visibleTimers.delete(ph);
                            if(!visibleSet.has(ph) || ph.dataset.loaded === '1') return;
                            // Now load after being visible for ~1s
                            ph.dataset.loaded = '1';

                            const uuid = ph.getAttribute('data-uuid');
                            const status = ph.getAttribute('data-status');
                            const tracker = ph.getAttribute('data-tracker') || 'unknown';

                            // Resolve word and details lazily
                            let word = ph.getAttribute('data-word') || knownMap[uuid] || await getWordByUUID(uuid);
                            if(word) knownMap[uuid] = word;

                // Translation/reading from existing flashcards (if available)
                let translation = ph.getAttribute('data-translation') || '-';
                let fullTranslation = translation;
                            let reading = ph.getAttribute('data-reading') || null;
                            let pitch = ph.hasAttribute('data-pitch') ? Number(ph.getAttribute('data-pitch')) : undefined;
                            if(word && fs?.flashcards?.length){
                                const found = fs.flashcards.find(fc => fc?.content?.word === word);
                                if(found?.content?.translation){
                                    const t = found.content.translation;
                    fullTranslation = Array.isArray(t) ? t.join(', ') : String(t);
                    translation = fullTranslation;
                                }
                                if(!reading && found?.content?.pronunciation){
                                    reading = found.content.pronunciation;
                                }
                                if(pitch === undefined && found?.content?.pitchAccent !== undefined){
                                    pitch = found.content.pitchAccent;
                                }
                            }
                            // fallback: wordFreq reading
                            if(!reading && wordFreq[word]?.reading){
                                reading = wordFreq[word].reading;
                            }
                            // If we still need any of translation/reading/pitch, fetch once from backend
                            const needsTranslation = (!translation || translation === '-' || translation === '—');
                            const needsReading = !reading;
                            const needsPitch = (settings?.language === 'ja' && settings?.showPitchAccent && (pitch === undefined || pitch === null));
                            if((needsTranslation || needsReading || needsPitch) && word){
                                try{
                                    const tr = await getTranslation(word);
                                    if(needsTranslation){
                                        const defs = tr?.data?.[0]?.definitions;
                                        if(defs && defs.length){
                                            fullTranslation = Array.isArray(defs) ? defs.join(', ') : String(defs);
                                            translation = fullTranslation;
                                        }
                                    }
                                    if(needsReading && tr?.data?.[0]?.reading){
                                        reading = tr.data[0].reading;
                                    }
                                    if(needsPitch){
                                        const p = tr?.data?.[2]?.[2]?.pitches?.[0]?.position;
                                        if(p !== undefined) pitch = p;
                                    }
                                }catch(_e){ /* ignore */ }
                            }
                            const lvl = word && wordFreq[word]?.raw_level !== undefined ? wordFreq[word].raw_level : -1;

                            // Replace placeholder with the real entry
                            if(translation && translation.length > 25) translation = translation.slice(0,25) + '...';
                            if(!uuid || !word){
                                ph.remove();
                                io.unobserve(ph);
                                return;
                            }
                            await addEntry(word || '(unknown)', translation, lvl, tracker, parseInt(status), false, ph, reading, fullTranslation, pitch);
                            io.unobserve(ph);
                        }, 1000);
                        visibleTimers.set(ph, tid);
                    }
                } else {
                    // no longer visible; cancel any pending timer
                    visibleSet.delete(ph);
                    const tid = visibleTimers.get(ph);
                    if(tid){
                        statsWindow.clearTimeout(tid);
                        visibleTimers.delete(ph);
                    }
                }
            }
        }, { root: null, rootMargin: '0px 0px', threshold: 0.01 });

        // Create lightweight placeholders for each item and observe them
        const container = $('.word-adjust-content', d).get(0);
        const frag = d.createDocumentFragment();
    for (const [uuid, status] of Object.entries(trackedWords)) {
            const placeholder = d.createElement('div');
            placeholder.className = 'entry contains_pills placeholder';
            placeholder.setAttribute('data-uuid', uuid);
            placeholder.setAttribute('data-status', String(status));
            placeholder.setAttribute('data-tracker', trackingInfo[uuid] || 'unknown');
            // Basic skeleton layout matching the 5-column structure
            placeholder.innerHTML = `
                <div><span>Loading…</span></div>
                <div><span>—</span></div>
                <div><div class="pill" level="-1">…</div></div>
                <div><span>${(trackingInfo[uuid] || 'unknown')}</span></div>
                <div><span></span></div>
            `;
            frag.appendChild(placeholder);
        }
        container.appendChild(frag);

        // Observe after appending to DOM
        container.querySelectorAll('.entry.placeholder').forEach(el => io.observe(el));

        // Also add every word from wordFreq as placeholders (batch to avoid jank)
        const freqEntries = Object.entries(wordFreq);
        const existingUUIDs = new Set(uuids);
        const BATCH_SZ = 500;
        async function addFreqPlaceholders(){
            let batchFrag = d.createDocumentFragment();
            let count = 0;
            for(const [word, data] of freqEntries){
                // Compute uuid for the word
                const uuid = await toUniqueIdentifier(word);
                if(existingUUIDs.has(uuid)) continue;
                // Skip if row already exists in DOM (search may add one early)
                if(container.querySelector(`.entry[data-uuid="${uuid}"]`)){
                    existingUUIDs.add(uuid);
                    continue;
                }
                existingUUIDs.add(uuid);
                // index entry (prefill known fields)
                itemsIndex[uuid] = {
                    uuid,
                    status: 0,
                    tracker: 'nothing',
                    word,
                    translation: undefined,
                    level: (data && (data.raw_level !== undefined)) ? data.raw_level : -1,
                };
                uuids.push(uuid);
                // placeholder DOM
                const placeholder = d.createElement('div');
                placeholder.className = 'entry contains_pills placeholder';
                placeholder.setAttribute('data-uuid', uuid);
                placeholder.setAttribute('data-status', '0');
                placeholder.setAttribute('data-tracker', 'nothing');
                placeholder.setAttribute('data-word', word);
                if(data && data.reading) placeholder.setAttribute('data-reading', data.reading);
                placeholder.setAttribute('data-level', String(itemsIndex[uuid].level));
                const lvlName = lang_data[settings.language].freq_level_names?.[String(itemsIndex[uuid].level)] || `Level ${itemsIndex[uuid].level}`;
                placeholder.innerHTML = `
                    <div><span>${word}</span></div>
                    <div><span>—</span></div>
                    <div><div class="pill" level="${itemsIndex[uuid].level}">${lvlName}</div></div>
                    <div><span>nothing</span></div>
                    <div><span></span></div>
                `;
                batchFrag.appendChild(placeholder);
                count++;
                if(count % BATCH_SZ === 0){
                    container.appendChild(batchFrag);
                    // Observe newly appended placeholders
                    container.querySelectorAll('.entry.placeholder').forEach(el => {
                        if(!el.__observed){ io.observe(el); el.__observed = true; }
                    });
                    batchFrag = d.createDocumentFragment();
                    // Yield to UI
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            if(batchFrag.childNodes.length){
                container.appendChild(batchFrag);
                container.querySelectorAll('.entry.placeholder').forEach(el => {
                    if(!el.__observed){ io.observe(el); el.__observed = true; }
                });
            }
        }
        // Kick off adding frequency list placeholders without blocking
        addFreqPlaceholders();

    // Search helpers
        async function ensureRowForWord(word){
            if(!word) return null;
            const uuid = await toUniqueIdentifier(word);
            let row = container.querySelector(`.entry[data-uuid="${uuid}"]`);
            if(row) return row;
            // Create a placeholder on demand at the end and observe it
            const placeholder = d.createElement('div');
            placeholder.className = 'entry contains_pills placeholder';
            placeholder.setAttribute('data-uuid', uuid);
            placeholder.setAttribute('data-status', String(0));
            placeholder.setAttribute('data-tracker', 'nothing');
            placeholder.setAttribute('data-word', word);
            if(wordFreq[word]?.reading) placeholder.setAttribute('data-reading', wordFreq[word].reading);
            const lvl = (wordFreq[word]?.raw_level ?? -1);
            placeholder.setAttribute('data-level', String(lvl));
            const lvlName = lang_data[settings.language].freq_level_names?.[String(lvl)] || `Level ${lvl}`;
            placeholder.innerHTML = `
                <div><span>${word}</span></div>
                <div><span>—</span></div>
                <div><div class="pill" level="${lvl}">${lvlName}</div></div>
                <div><span>nothing</span></div>
                <div><span></span></div>
            `;
            container.appendChild(placeholder);
            if(!placeholder.__observed){ io.observe(placeholder); placeholder.__observed = true; }
            // index
            if(!itemsIndex[uuid]){
                itemsIndex[uuid] = { uuid, status: 0, tracker: 'nothing', word, translation: undefined, level: lvl };
            }
            if(!existingUUIDs.has(uuid)){
                existingUUIDs.add(uuid);
                uuids.push(uuid);
            }
            return placeholder;
        }

        async function searchAndScroll(query){
            if(!query) return;
            // Attempt exact match first
            let targetWord = null;
            if(wordFreq[query]) targetWord = query;
            // If not exact, try case/intl variations
            if(!targetWord){
                const lower = query.toLowerCase();
                const keys = Object.keys(wordFreq);
                targetWord = keys.find(k => k.toLowerCase() === lower) || null;
            }
            // If still nothing, just use the input as-is
            if(!targetWord) targetWord = query;
            const row = await ensureRowForWord(targetWord);
            if(!row) return;
            // Scroll into view and highlight briefly
            row.scrollIntoView({behavior:'smooth', block:'center'});
            row.classList.add('highlight');
            setTimeout(()=> row.classList.remove('highlight'), 1200);
        }

        // Wire search UI
        const $searchInput = $('#word-search-input', d);
        const $searchBtn = $('#word-search-go', d);
        $searchBtn.on('click', async ()=>{ await searchAndScroll(($searchInput.val()||'').toString().trim()); });
        $searchInput.on('keydown', async (e)=>{ if(e.key === 'Enter'){ await searchAndScroll(($searchInput.val()||'').toString().trim()); }});

        // Layout adjustments: place header below search bar and push content
        try{
            const searchBar = d.querySelector('.search-bar');
            const headerEl = container.querySelector('.entry.header');
            if(searchBar && headerEl){
                const h = searchBar.getBoundingClientRect().height;
                headerEl.style.top = `${h}px`;
                // original margin-top is ~39px for header height; add search bar height
                const base = 39;
                container.style.marginTop = `${base + Math.ceil(h)}px`;
            }
        }catch(_e){}

        // expose sorter state for UI updates from handlers
        statsWindow.__wordAdjust = {
            itemsIndex,
            setTracker: (uuid, value) => { if(itemsIndex[uuid]) itemsIndex[uuid].tracker = value; }
        };

        // Sorting helpers
        const header = container.querySelector('.entry.header');
        const headerCells = header ? header.querySelectorAll(':scope > div') : [];
        let sortKey = null; // 'word' | 'translation' | 'level' | 'tracker' | 'status'
        let sortDir = 1; // 1 asc, -1 desc

        // Visual sort indicators in header (adds ↑/↓ to active column)
        const mapIdxToKey = ['word','translation','level','tracker','status'];
        function updateSortIndicators(){
            if(!headerCells) return;
            headerCells.forEach((cell, idx) => {
                const span = cell.querySelector('span') || cell.firstElementChild;
                if(!span) return;
                // Save original label once
                let base = span.getAttribute('data-base-label');
                if(!base){
                    // Strip any leftover arrows just in case
                    base = (span.textContent || '').replace(/[\s]*[↑↓]$/, '').trim();
                    span.setAttribute('data-base-label', base);
                }
                const key = mapIdxToKey[idx];
                if(key && sortKey === key){
                    const arrow = (sortDir === 1) ? '↑' : '↓';
                    span.textContent = base + ' ' + arrow;
                } else {
                    span.textContent = base;
                }
            });
        }

        async function ensureFields(requiredKeys){
            const needWord = requiredKeys.includes('word') || requiredKeys.includes('translation') || requiredKeys.includes('level');
            const promises = [];
            for(const uuid of uuids){
                const item = itemsIndex[uuid];
                if(needWord && !item.word){
                    promises.push((async () => {
                        // resolve word
                        let w = knownMap[uuid] || await getWordByUUID(uuid);
                        if(w){
                            knownMap[uuid] = w;
                            item.word = w;
                            // level
                            item.level = (wordFreq[w]?.raw_level !== undefined) ? wordFreq[w].raw_level : -1;
                            // translation from flashcards
                            if(fs?.flashcards?.length){
                                const found = fs.flashcards.find(fc => fc?.content?.word === w);
                                if(found?.content?.translation){
                                    const t = found.content.translation;
                                    let tr = Array.isArray(t) ? t.join(', ') : String(t);
                                    if(tr && tr.length > 25) tr = tr.slice(0,25) + '...';
                                    item.translation = tr;
                                }
                                if(!item.reading && found?.content?.pronunciation){
                                    item.reading = found.content.pronunciation;
                                }
                            }
                            if(!item.reading && wordFreq[w]?.reading){
                                item.reading = wordFreq[w].reading;
                            }
                        } else {
                            item.word = '(unknown)';
                            item.level = -1;
                        }
                    })());
                }
            }
            if(promises.length) await Promise.all(promises);
        }

        function compareNullable(a, b){
            const aU = (a === undefined || a === null);
            const bU = (b === undefined || b === null);
            if(aU && bU) return 0;
            if(aU) return 1; // undefined last in asc
            if(bU) return -1;
            if(typeof a === 'string' && typeof b === 'string'){
                return a.localeCompare(b);
            }
            return (a < b) ? -1 : (a > b ? 1 : 0);
        }

        // Sorting overlay helpers
        function showBlocker(message){
            const $el = $('.fullscreen-load-blocker', d);
            $('.settingsMenuContent',d).addClass('dont-scroll');
            if($el && $el.length){ $el.text(message || 'Sorting…').show(); }
        }
        function hideBlocker(){
            const $el = $('.fullscreen-load-blocker', d);
            $('.settingsMenuContent',d).removeClass('dont-scroll');
            if($el && $el.length){ $el.hide(); }
        }
        function getVisibleEntries(){
            const viewportH = statsWindow?.innerHeight || d.documentElement?.clientHeight || 800;
            const header = container.querySelector('.entry.header');
            const rows = Array.from(container.querySelectorAll('.entry:not(.header)'));
            const visible = [];
            for(const row of rows){
                const r = row.getBoundingClientRect();
                if(r.bottom < 0) continue;
                if(r.top > viewportH) break;
                visible.push(row);
            }
            return visible;
        }
        async function waitForVisibleLoaded(timeoutMs = 12000){
            const start = Date.now();
            while(true){
                const visible = getVisibleEntries();
                const pending = visible.filter(el => el.classList.contains('placeholder') && el.dataset.loaded !== '1');
                if(pending.length === 0) return;
                if(Date.now() - start > timeoutMs) return;
                await new Promise(r => setTimeout(r, 150));
            }
        }

        async function sortAndRender(newKey){
            showBlocker('Sorting…');
            statsWindow.scrollTo(0,0);
            // toggle logic
            if(sortKey === newKey){
                sortDir = -sortDir;
            } else {
                sortKey = newKey;
                sortDir = 1;
            }
            // Update header arrows immediately for responsiveness
            updateSortIndicators();
            // ensure necessary fields
            if(newKey === 'word' || newKey === 'translation' || newKey === 'level'){
                await ensureFields([newKey]);
            }
            // sort uuids
            uuids.sort((a,b)=>{
                const A = itemsIndex[a];
                const B = itemsIndex[b];
                let res = 0;
                switch(newKey){
                    case 'word': {
                        // Prefer reading for Japanese if available, else latinized word
                        const aKey = (A.reading || A.word || '').toLowerCase?.();
                        const bKey = (B.reading || B.word || '').toLowerCase?.();
                        res = compareNullable(aKey, bKey);
                        break;
                    }
                    case 'translation': res = compareNullable((A.translation||'').toLowerCase(), (B.translation||'').toLowerCase()); break;
                    case 'level': res = compareNullable(A.level, B.level); break;
                    case 'tracker': res = compareNullable((A.tracker||'').toLowerCase(), (B.tracker||'').toLowerCase()); break;
                    case 'status': res = compareNullable(A.status, B.status); break;
                }
                if(res === 0){
                    // stable fallback by word/uuid
                    res = compareNullable(A.word?.toLowerCase?.(), B.word?.toLowerCase?.());
                    if(res === 0) res = compareNullable(a, b);
                }
                return res * sortDir;
            });

            // Reorder DOM according to sorted uuids
            const nodes = [];
            for(const uuid of uuids){
                const el = container.querySelector(`.entry[data-uuid="${uuid}"]`);
                if(el) nodes.push(el);
            }
            // Append in bulk to minimize reflows
            nodes.forEach(n => container.appendChild(n));

            // Wait for current viewport items to finish lazy loading before hiding overlay
            await waitForVisibleLoaded();
            hideBlocker();
        }

        // Attach click listeners to header
        headerCells.forEach((cell, idx) => {
            const key = mapIdxToKey[idx];
            if(!key) return;
            cell.style.cursor = 'pointer';
            cell.title = 'Click to sort';
            cell.addEventListener('click', async () => { await sortAndRender(key); });
        });

    // Remove blocking loader immediately; entries will render on scroll and sorting is available
    $('.fullscreen-load-blocker',d).hide();
    // Initialize header indicators (no sort selected yet)
    updateSortIndicators();
    });

    statsWindow.changeKnownBtnStatus = async (uuid, status) => {
        try{
            const el = d.getElementById(`status-pill-${uuid}`);
            const word = knownMap[uuid] || await getWordByUUID(uuid);
            if(!word) return;
            if(el){ el.outerHTML = await generateStatusPillHTML(word, status); }
            changeKnownStatus(word, status);
        }catch(_e){}
    };
}

window.mLearnIPC.onOpenWordDbEditor(adjustWordsByLevel);


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