import {video} from "../playback/elements.js";
import {settings, saveSettings, lang_data, wordFreq} from "../settings/settings.js";
import {knownAdjustment, changeKnownStatus} from "./saving.js";
import {Flashcards, getAllSRSTrackedWords, getSRSWordKnownStatusUUID, getWordByUUID, addFlashcard, saveFlashcards} from "../flashcards/storage.js";
import {toUniqueIdentifier} from "../utils.js";
import {generateStatusPillHTML} from "../subtitler/pillHtml.js";
import $ from "../../lib/jquery.min.js";
import {getTranslation, setTranslationOverride, getTranslationOverride, clearTranslationOverride} from "../networking.js";
import {buildPitchAccentHtml, getPitchAccentInfo} from "../common/pitchAccent.js";

let timeWatched = 0;
let lastUpdateTime = 0;
let isTracking = false;
const lookupStatus = {
    0: "Viewed",
    1: "Learning",
    2: "Learned"
};

// Time tracking functions (restored)
const initTimeWatched = () => {
    timeWatched = settings.timeWatched || 0;
};
const startTimeTracking = () => {
    if (!isTracking && video && !video.paused) {
        isTracking = true;
        lastUpdateTime = Date.now();
    }
};
const stopTimeTracking = () => {
    if (isTracking) {
        updateTimeWatched();
        isTracking = false;
    }
};
const updateTimeWatched = () => {
    if (isTracking && lastUpdateTime > 0) {
        const currentTime = Date.now();
        const elapsed = Math.floor((currentTime - lastUpdateTime) / 1000);
        timeWatched += elapsed;
        settings.timeWatched = timeWatched;
        saveSettings();
        lastUpdateTime = currentTime;
    }
};
const getTimeWatchedSeconds = () => timeWatched;
const setTimeWatchedSeconds = (seconds) => {
    if (typeof seconds === 'number' && seconds >= 0) {
        timeWatched = seconds;
        settings.timeWatched = timeWatched;
        saveSettings();
    } else {
        console.error('Invalid seconds value:', seconds);
    }
};
window.setTimeWatchedSeconds = setTimeWatchedSeconds;
const getTimeWatchedFormatted = () => {
    const totalSeconds = timeWatched;
    if (totalSeconds === 0) return '0 seconds';
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const parts = ['Time watched:'];
    if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
    if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);
    if (parts.length === 0) return '0 seconds';
    return parts.join('<br>');
};
const setupVideoTracking = () => {
    if (!video) return;
    video.addEventListener('play', startTimeTracking);
    video.addEventListener('pause', stopTimeTracking);
    video.addEventListener('ended', stopTimeTracking);
    setInterval(() => { if (isTracking) updateTimeWatched(); }, 10000);
    window.addEventListener('beforeunload', () => { if (isTracking) updateTimeWatched(); });
};
if (typeof window !== 'undefined' && window.settings) {
    initTimeWatched();
    setupVideoTracking();
} else {
    document.addEventListener('DOMContentLoaded', () => { setTimeout(() => { initTimeWatched(); setupVideoTracking(); }, 100); });
}

// getWordsLearnedInAppMoreInfo (restored)
async function getWordsLearnedInAppMoreInfo(){
    let trackedWords = {};
    let trackingInfo = {};
    for(const uuid of Object.keys(getAllSRSTrackedWords())){
        trackedWords[uuid] = getSRSWordKnownStatusUUID(uuid);
        trackingInfo[uuid] = 'flashcards';
    }
    for(const word of Object.keys(knownAdjustment)){
        const uuid = await toUniqueIdentifier(word);
        trackedWords[uuid] = Math.max(knownAdjustment[word], trackedWords[uuid] || 0);
        if(!(uuid in trackingInfo)) trackingInfo[uuid] = 'user pills';
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
    for(const level_id of levelsNumeric){
        if(!(level_id in trackedWordsPerLevel)) {
            trackedWordsPerLevel[level_id] = {};
            console.log("Adding empty level", level_id);
        }
    }
    console.log(trackedWordsPerLevel);

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
<link href="flashcard_style.css" rel="stylesheet">
<link href="style.css" rel="stylesheet">
<style>
body {background: #000}
.load-progress{display:none; height:8px; width:220px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden; margin-left:8px; align-self:center}
.load-progress .bar{height:100%; width:0%; background:#1976d2; transition:width 0.15s ease}
.search-bar{display:flex; gap:8px; align-items:center}
.search-bar .button[disabled]{opacity:0.6; cursor:not-allowed}
</style>
<body class="settings-body dark">
<div class="search-bar">
    <input type="text" id="word-search-input" placeholder="Search word…">
    <button id="word-search-go" class="button">Search</button>
    <button id="load-all-btn" class="button">Load all</button>
    <div id="load-progress" class="load-progress"><div class="bar"></div></div>
    <select id="level-select" class="button styled" style="min-width:180px"></select>
    <button id="add-level-btn" class="button">Add level flashcards</button>
    <div id="add-level-progress" class="load-progress"><div class="bar"></div></div>
    <span>Enter to search; exact matches prioritized. If the word doesn't exist, it'll be created. To search for translations, please press Load all first.</span>
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
    // Register so shared pill logic can discover this window for element lookups
    try{ if(typeof window.registerMLearnChildWindow === 'function') window.registerMLearnChildWindow(statsWindow); }catch(_e){}
    // Translation search index and element map
    // token(lowercased) -> Set(uuid)
    const translationTokenIndex = new Map();
    // uuid -> Set(tokens) for easy reindexing
    const uuidToTokens = new Map();
    // uuid -> current DOM element (placeholder or loaded)
    const uuidToElement = new Map();
    const tokenize = (str) => {
        return String(str || '')
            .toLowerCase()
            .split(/[\s,;|\/\u3000、。・·]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
    };
    const indexTranslationTokens = (uuid, fullTranslation) => {
        if(!uuid) return;
        // Remove previous tokens
        const prev = uuidToTokens.get(uuid);
        if(prev){
            for(const t of prev){
                const set = translationTokenIndex.get(t);
                if(set){
                    set.delete(uuid);
                    if(set.size === 0) translationTokenIndex.delete(t);
                }
            }
        }
        const toks = new Set(tokenize(fullTranslation));
        uuidToTokens.set(uuid, toks);
        for(const t of toks){
            if(!translationTokenIndex.has(t)) translationTokenIndex.set(t, new Set());
            translationTokenIndex.get(t).add(uuid);
        }
    };
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
        // Resolve uuid (prefer existing row uuid when replacing)
        let uuidResolved = null;
        try{
            uuidResolved = replaceTarget?.getAttribute?.('data-uuid') || await toUniqueIdentifier(word);
        }catch(_e){ /* ignore */ }
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
                    const $editFc = $('<span class="pill pill-btn gray edit-flashcard-btn" style="margin-left:8px;" title="Edit flashcard contents">Edit</span>');
                    $trackerCell.append($remove).append($editFc);
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
                    $editFc.on('click', async (ev)=>{
                        ev.stopPropagation();
                        await openEditFlashcardDialog(word, $row.get(0));
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
            // Update uuid -> element map
            const rowEl = el.get(0);
            if(rowEl && uuidResolved){ uuidToElement.set(uuidResolved, rowEl); }
        } else {
            if(reading) el.attr('data-reading', reading);
            if(pitch !== null && pitch !== undefined) el.attr('data-pitch', String(pitch));
            $('.word-adjust-content',d).append(el);
            // Update uuid -> element map
            const rowEl = el.get(0);
            if(rowEl && uuidResolved){ uuidToElement.set(uuidResolved, rowEl); }
        }
        // Index translation tokens for search
        try{
            if(uuidResolved && fullT){ indexTranslationTokens(uuidResolved, fullT); }
        }catch(_e){}
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
                    <input id="ml-pitch" type="number" inputmode="numeric" min="0" value="${curPitch}" placeholder="0 (Heiban), 1, 2, 3…">
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

    // Close on clicking outside (overlay background)
    overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
    // Prevent overlay handler when clicking inside modal
    modal.addEventListener('click', (e)=> e.stopPropagation());
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

    // Modal editor for full flashcard content (word-level SRS data) mirroring review.js editable fields
    async function openEditFlashcardDialog(word, rowEl){
        const doc = statsWindow.document;
        const existing = doc.querySelector('.ml-modal-overlay');
        if(existing) existing.remove();
        const fs = Flashcards();
        let cardIndex = -1;
        let card = null;
        if(Array.isArray(fs.flashcards)){
            cardIndex = fs.flashcards.findIndex(fc => fc?.content?.word === word);
            if(cardIndex !== -1) card = fs.flashcards[cardIndex];
        }
        const now = Date.now();
        if(!card){
            card = {
                content:{
                    word,
                    pitchAccent: '',
                    pronunciation: '',
                    translation: [],
                    definition: '',
                    example: '',
                    exampleMeaning: '',
                    screenshotUrl: '',
                    pos: '',
                    level: (word in wordFreq ? (wordFreq[word]?.raw_level ?? -1) : -1)
                },
                dueDate: now,
                lastReviewed: now,
                lastUpdated: now,
                ease: 2.5,
                reviews: 0
            };
        }
        const c = card.content;
        const translationText = Array.isArray(c.translation) ? c.translation.join(', ') : (c.translation || '');
        const intervalMs = card.dueDate - card.lastReviewed;
        // Build level options for dropdown
        const freqNames = (lang_data?.[settings.language]?.freq_level_names) || {};
        let levelOptions = `<option value="-1" ${(-1 === Number(c.level)?'selected':'')}>None / -1</option>`;
        const levelKeys = Object.keys(freqNames).map(k=>Number(k)).filter(n=>!Number.isNaN(n));
        levelKeys.sort((a,b)=> b-a);
        for(const k of levelKeys){
            const label = freqNames[String(k)] || `Level ${k}`;
            levelOptions += `<option value="${k}" ${(Number(c.level)===k)?'selected':''}>${label}</option>`;
        }
        if(c.level !== undefined && c.level !== null && ![-1, ...levelKeys].includes(Number(c.level))){
            levelOptions += `<option value="${c.level}" selected>${c.level}</option>`;
        }

        const overlay = doc.createElement('div');
        overlay.className = 'ml-modal-overlay';
        const modal = doc.createElement('div');
        modal.className = 'ml-modal';
        modal.style.maxWidth = '760px';
        modal.innerHTML = `
            <div class="ml-modal-header">
                <div style="font-size:16px;font-weight:600;">Edit flashcard – ${word}</div>
                <button class="ml-close" style="background:transparent;border:0;color:inherit;font-size:18px;cursor:pointer;">×</button>
            </div>
            <div class="ml-modal-content" style="max-height:60vh;overflow:auto;display:flex;">
                <div style="display:flex;flex-direction: column;gap:8px;width:100%;align-items: center">
                    <div class="ml-modal-content" style="background:unset !important;box-shadow:unset !important; border:unset !important;max-height:unset !important; overflow:unset !important;width:100%">
                        <label>Level </label>
                        <select data-field="levelSelect" class="styled" style="margin:0">
                            ${levelOptions}
                        </select>
                        <label>Pronunciation</label>
                        <input type="text" data-field="pronunciationInput" value="${c.pronunciation || ''}" placeholder="reading" />
                        <label>Pitch accent</label>
                        <div class="ml-pitch-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                            <input id="ml-pitch" data-field="pitchAccentInput" type="number" inputmode="numeric" min="0" value="${c.pitchAccent ?? ''}" placeholder="0 (Heiban), 1, 2, 3…" style="width:110px;"/>
                            <div id="ml-pitch-name" data-field="pitchName" style="flex:1 1 auto;opacity:0.9;"></div>
                            <div id="ml-pitch-preview" data-field="pitchPreview" style="flex:1 1 auto;text-align:right;min-height:24px;position:relative;">
                                <span data-field="pronunciationPreview" style="position:relative;display:inline-block;font-size:16px;font-weight:500;">${c.pronunciation || ''}</span>
                            </div>
                        </div>
                        <label>POS:</label>
                        <input type="text" class="can-be-edited" data-field="pos" placeholder="Grammatical Class..." value="${c.pos || ''}"/>
                    </div>
                    <div class="card-c">
                        <div class="card-item actual-words" style="margin-top:4px;">
                            <h1 class="question" style="margin:4px 0;font-size:28px;" data-field="word">${c.word}</h1>
                            <h1 class="answer can-be-edited" style="margin:4px 0;font-size:20px;white-space:pre-wrap;" data-field="translation" contenteditable="true">${translationText}</h1>
                        </div>
                        <div class="card-item">
                            <div class="example">
                                <div class="sentence can-be-edited" data-field="example" contenteditable="true">${c.example || '-'}</div>
                                <div class="translation">
                                    <p class="translation can-be-edited" data-field="exampleMeaning" contenteditable="true">${c.exampleMeaning || '-'}</p>
                                </div>
                            </div>
                        </div>
                        <div class="divider" style="margin:8px 0;border-top:1px solid ${settings.dark_mode? '#333':'#ddd'};"></div>
                        <div class="card-item" style="display:flex;flex-direction:column;gap:8px;">
                            <div>
                                <div style="font-size:12px;opacity:0.7;margin-bottom:2px;">Definition (HTML allowed)</div>
                                <div class="definition can-be-edited" style="min-height:60px;border:1px solid ${settings.dark_mode? '#333':'#ccc'};padding:4px;border-radius:4px;" data-field="definition" contenteditable="true">${c.definition || ''}</div>
                            </div>
                            <div style="min-width:220px;">
                                <div class="card-item" style="padding:0;border:none;">
                                    <img class="fc-screenshot" src="${c.screenshotUrl || ''}" alt="screenshot" style="max-width:100%;${c.screenshotUrl ? '' : 'display:none;'};border:1px solid ${settings.dark_mode? '#333':'#ccc'};border-radius:4px;" />
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="ml-modal-content" style="background:unset !important;box-shadow:unset !important; border:unset !important;max-height:unset !important; overflow:unset !important;width:100%">
                        <div style="font-weight:600;font-size:16px">Stats</div><span></span>
                        <label>Ease:</label><span data-stat="ease">${card.ease}</span>
                        <label>Reviews:</label><span data-stat="reviews">${card.reviews}</span>
                        <label>Last reviewed:</label><span data-stat="lastReviewedAbs">${new Date(card.lastReviewed).toLocaleString()}</span>
                        <label>Due date:</label><span><span data-stat="dueAbs">${new Date(card.dueDate).toLocaleString()}</span> (<span data-stat="dueRel"></span>)</span>
                        <label>Interval:</label><span data-stat="interval">${intervalMs > 0 ? Math.round(intervalMs/1000/60/60/24*10)/10+'d' : '—'}</span>
                    </div>
                    <div style="font-size:11px;opacity:0.65;padding-bottom:16px">Translations: comma or newline separated. Pitch accent is mora drop position (0=heiban).</div>
                </div>
            </div>
            <div class="ml-modal-footer" style="display:flex;gap:8px;justify-content:flex-end;">
                <button class="ml-cancel" style="background:${settings.dark_mode? '#2a2b2f':'#f3f3f3'};color:inherit;border:1px solid ${settings.dark_mode? '#333':'#ddd'};border-radius:6px; padding:8px 12px;cursor:pointer;">Cancel</button>
                <button class="ml-save" style="background:#673ab7;color:#fff;border:1px solid #4527a0;border-radius:6px; padding:8px 12px;cursor:pointer;">Save</button>
            </div>
        `;

        function close(){
            try{ overlay.remove(); }catch(_e){}
        }
        modal.querySelector('.ml-close')?.addEventListener('click', close);
        modal.querySelector('.ml-cancel')?.addEventListener('click', close);

        overlay.appendChild(modal);
        doc.body.appendChild(overlay);

        // Relative due updater
        const dueRelEl = modal.querySelector('[data-stat="dueRel"]');
        function rel(t){
            const diff = t - Date.now();
            if(diff <= 0) return 'due';
            const m = 60*1000, h = 60*m, d = 24*h;
            if(diff < m) return '<1m';
            if(diff < h) return Math.round(diff/m)+'m';
            if(diff < d) return Math.round(diff/h)+'h';
            return Math.round(diff/d)+'d';
        }
        function tick(){ if(dueRelEl) dueRelEl.textContent = rel(card.dueDate); }
        tick();
        const relTimer = setInterval(tick, 60000);
        overlay.addEventListener('remove', ()=> clearInterval(relTimer));

        function extract(){
            const get = f => modal.querySelector(`[data-field="${f}"]`);
            const translationRaw = get('translation')?.textContent.trim() || '';
            const translationArr = translationRaw.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
            let levelVal = parseInt(modal.querySelector('[data-field="levelSelect"]')?.value || '-1');
            if(!Number.isFinite(levelVal)) levelVal = -1;
            const pitchValRaw = modal.querySelector('[data-field="pitchAccentInput"]')?.value.trim() || '';
            const pitchParsed = pitchValRaw === '' ? undefined : Number(pitchValRaw);
            const pronunciationVal = modal.querySelector('[data-field="pronunciationInput"]')?.value.trim() || '';
            return {
                word: c.word,
                pitchAccent: (pitchParsed !== undefined && Number.isFinite(pitchParsed)) ? pitchParsed : undefined,
                pronunciation: pronunciationVal,
                translation: translationArr,
                definition: modal.querySelector('[data-field="definition"]')?.innerHTML || '',
                example: modal.querySelector('[data-field="example"]')?.innerHTML || '',
                exampleMeaning: modal.querySelector('[data-field="exampleMeaning"]')?.innerHTML || '',
                screenshotUrl: c.screenshotUrl || '', // preserved (no editing in dialog now)
                pos: $(modal.querySelector('[data-field="pos"]')).val().trim() || '',
                level: levelVal
            };
        }

        modal.querySelector('.ml-save')?.addEventListener('click', async ()=>{
            try{
                const updatedContent = extract();
                let updated = null;
                if(cardIndex === -1){
                    updated = {
                        content: updatedContent,
                        ease: card.ease,
                        reviews: card.reviews,
                        dueDate: card.dueDate,
                        lastReviewed: card.lastReviewed,
                        lastUpdated: Date.now()
                    };
                    fs.flashcards.push(updated);
                    cardIndex = fs.flashcards.length - 1;
                } else {
                    fs.flashcards[cardIndex].content = updatedContent;
                    fs.flashcards[cardIndex].lastUpdated = Date.now();
                    updated = fs.flashcards[cardIndex];
                }
                await saveFlashcards();
                const fullT2 = Array.isArray(updated.content.translation)? updated.content.translation.join(', ') : (updated.content.translation || '');
                let short = fullT2 || '-';
                if(short.length > 25) short = short.slice(0,25) + '...';
                const levelVal2 = updated.content.level ?? (wordFreq[word]?.raw_level ?? -1);
                const tracker = 'flashcards';
                const status = parseInt(rowEl?.getAttribute('data-status') || '0');
                await addEntry(word, short, levelVal2, tracker, status, false, rowEl, updated.content.pronunciation || null, fullT2, updated.content.pitchAccent ?? null);
                close();
            }catch(err){ statsWindow.alert('Failed to save flashcard: '+err); }
        });

        // Live pitch accent preview (applies ONLY to pronunciation preview span)
        try{
            const pitchInput = modal.querySelector('[data-field="pitchAccentInput"]');
            const pronunciationInput = modal.querySelector('[data-field="pronunciationInput"]');
            const pronunciationEl = modal.querySelector('[data-field="pronunciationPreview"]');
            const pitchNameEl = modal.querySelector('[data-field="pitchName"]');
            function accentName(reading, n){
                if(n === null || n === undefined || Number.isNaN(n)) return '—';
                if(n === 0) return 'Heiban (平板)';
                if(n === 1) return 'Atamadaka (頭高)';
                if(n === 2) return 'Nakadaka (中高)';
                if(n === 3) return 'Odaka (尾高)';
                if(typeof n === 'number' && Number.isFinite(n) && n >= 4) return `Drop after mora ${n}`;
                return '—';
            }
            function refreshPitch(){
                try{
                    // Remove existing overlays inside pronunciation
                    if(pronunciationEl){
                        $(pronunciationEl).find('.mLearn-pitch-accent').remove();
                    }
                    // Update preview text from input
                    if(pronunciationEl && pronunciationInput){
                        pronunciationEl.textContent = pronunciationInput.value.trim();
                    }
                    const valRaw = pitchInput?.value.trim();
                    const reading = pronunciationInput?.value.trim();
                    const n = Number(valRaw);
                    if(pitchNameEl){
                        if(valRaw === '' || !Number.isFinite(n) || n < 0){
                            pitchNameEl.textContent = '';
                        } else {
                            pitchNameEl.textContent = accentName(reading, n);
                        }
                    }
                    if(!valRaw || !Number.isFinite(n) || n < 0 || !reading){
                        return; // no overlay
                    }
                    attachPitchAccentToWord($(pronunciationEl), reading, reading, n);
                }catch(_e){}
            }
            pitchInput?.addEventListener('input', refreshPitch);
            pronunciationInput?.addEventListener('input', refreshPitch);
            // initial
            refreshPitch();
        }catch(_e){}
    }

    // Build and attach pitch accent overlay to the provided span element.
    function attachPitchAccentToWord($span, real_word, reading, pitch){
        try{
            if(!reading || reading === '-') return console.log('attachPitchAccentToWord: skipping', real_word, reading, pitch);
            if(pitch === undefined || pitch === null) return console.log('attachPitchAccentToWord: skipping', real_word, reading, pitch);
            const word_in_letters = String(reading);
            const accent_type = Number(pitch);
            if(!Number.isFinite(accent_type)) return console.log('attachPitchAccentToWord: skipping', real_word, reading, pitch);
            const accentInfo = getPitchAccentInfo(accent_type, word_in_letters);
            if(!accentInfo) return console.log('attachPitchAccentToWord: skipping', real_word, reading, pitch);
            const html = buildPitchAccentHtml(accentInfo, real_word.length, { includeParticleBox: true });
            if(!html) return;
            const el = $('<div class="mLearn-pitch-accent"></div>').html(html);
            const $ruby = $span.find('ruby');
            if($ruby.length && $ruby.find('rt').length){
                $ruby.find('rt').append(el);
                $span.css('--pitch-accent-height', '2px');
            } else {
                $span.append(el);
                if($span.css('position') === 'static' || !$span.css('position')){ $span.css('position','relative'); }
                $span.css('--pitch-accent-height', '2px');
            }
        }catch(_e){console.log(_e);}
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
                    // Pre-index flashcard translations for search
                    try{
                        const t = fc?.content?.translation;
                        if(w && t){
                            const fullT = Array.isArray(t) ? t.join(', ') : String(t);
                            const uuid = await toUniqueIdentifier(w);
                            indexTranslationTokens(uuid, fullT);
                        }
                    }catch(_e){}
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
        // Single-placeholder loader used by IO and eager loader
        async function loadPlaceholder(ph){
            if(!ph || ph.dataset.loaded === '1') return;
            ph.dataset.loaded = '1';
            const uuid = ph.getAttribute('data-uuid');
            const status = ph.getAttribute('data-status');
            const tracker = ph.getAttribute('data-tracker') || 'unknown';
            // Resolve word and details lazily
            let word = ph.getAttribute('data-word') || knownMap[uuid] || await getWordByUUID(uuid);
            if(word) knownMap[uuid] = word;
            // Translation/reading from flashcards (if available)
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
            if(!reading && word && wordFreq[word]?.reading){
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
                return;
            }
            await addEntry(word || '(unknown)', translation, lvl, tracker, parseInt(status), false, ph, reading, fullTranslation, pitch);
        }

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
                            await loadPlaceholder(ph);
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
            // map uuid -> element for scrolling
            uuidToElement.set(uuid, placeholder);
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
                uuidToElement.set(uuid, placeholder);
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
            uuidToElement.set(uuid, placeholder);
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
            if(targetWord && (wordFreq[targetWord] || Object.values(knownMap).includes(targetWord))){
                const row = await ensureRowForWord(targetWord);
                if(!row) return;
                row.scrollIntoView({behavior:'smooth', block:'center'});
                row.classList.add('highlight');
                setTimeout(()=> row.classList.remove('highlight'), 1200);
                return;
            }
            // Fallback: search by translation tokens
            const tokens = tokenize(query);
            for(const t of tokens){
                const set = translationTokenIndex.get(t);
                if(set && set.size){
                    // pick first uuid
                    const uuid = set.values().next().value;
                    let el = uuidToElement.get(uuid);
                    if(!el){
                        // ensure row exists; need the word
                        let w = knownMap[uuid] || await getWordByUUID(uuid);
                        if(w){
                            knownMap[uuid] = w;
                            el = await ensureRowForWord(w);
                        }
                    }
                    if(el){
                        el.scrollIntoView({behavior:'smooth', block:'center'});
                        el.classList.add('highlight');
                        setTimeout(()=> el.classList.remove('highlight'), 1200);
                        return;
                    }
                }
            }
            // If still nothing, create/find by literal and scroll
            const row = await ensureRowForWord(query);
            if(row){
                row.scrollIntoView({behavior:'smooth', block:'center'});
                row.classList.add('highlight');
                setTimeout(()=> row.classList.remove('highlight'), 1200);
            }
        }

        // Wire search UI
        const $searchInput = $('#word-search-input', d);
        const $searchBtn = $('#word-search-go', d);
        $searchBtn.on('click', async ()=>{ await searchAndScroll(($searchInput.val()||'').toString().trim()); });
        $searchInput.on('keydown', async (e)=>{ if(e.key === 'Enter'){ await searchAndScroll(($searchInput.val()||'').toString().trim()); }});
        // (Kanji grid opener moved to Settings and Menubar)

        // Load all with progress
        const $loadAllBtn = $('#load-all-btn', d);
        const $progress = $('#load-progress', d);
        const $bar = $('#load-progress .bar', d);
        async function loadAllEntries(){
            if(!$loadAllBtn.length) return;
            const placeholders = Array.from(container.querySelectorAll('.entry.placeholder'));
            const total = placeholders.length;
            if(total === 0) return;
            $loadAllBtn.attr('disabled','disabled');
            $progress.show();
            let done = 0;
            const update = ()=>{
                const pct = Math.floor((done/Math.max(1,total))*100);
                $bar.css('width', pct+'%');
            };
            update();
            // Process in small async batches to keep UI responsive
            const BATCH = 25;
            for(let i=0;i<placeholders.length;i+=BATCH){
                const slice = placeholders.slice(i, i+BATCH);
                await Promise.all(slice.map(ph => loadPlaceholder(ph).catch(()=>{})));
                done = Math.min(total, i + slice.length);
                update();
                // yield to UI
                await new Promise(r => setTimeout(r, 0));
            }
            // Hide progress after a short delay
            setTimeout(()=>{ $progress.hide(); $bar.css('width','0%'); $loadAllBtn.removeAttr('disabled'); }, 400);
        }
        $loadAllBtn.on('click', async ()=>{ await loadAllEntries(); });

        // Populate level selector and wire bulk add
        try{
            const $levelSel = $('#level-select', d);
            const $addBtn = $('#add-level-btn', d);
            const $addProg = $('#add-level-progress', d);
            const $addBar = $('#add-level-progress .bar', d);
            if($levelSel && $levelSel.length){
                // Collect unique levels from wordFreq
                const levelsSet = new Set();
                for(const v of Object.values(wordFreq||{})){
                    const lv = (v && typeof v.raw_level === 'number') ? v.raw_level : -1;
                    levelsSet.add(lv);
                }
                const levels = Array.from(levelsSet).sort((a,b)=>a-b);
                // Build options using language names if available
                const names = (lang_data?.[settings.language]?.freq_level_names) || {};
                $levelSel.append(`<option value="" disabled selected>Select level…</option>`);
                for(const lv of levels){
                    const key = String(lv);
                    const label = (lv === -1 ? 'Unlisted (-1)' : (names[key] || `Level ${lv}`));
                    $levelSel.append(`<option value="${lv}">${label}</option>`);
                }
            }
            if($addBtn && $addBtn.length){
                $addBtn.on('click', async ()=>{
                    try{
                        const selected = ($('#level-select', d).val()||'').toString();
                        if(!selected.length) return;
                        const levelNum = Number(selected);
                        if(!Number.isFinite(levelNum)) return;
                        const WORD_STATUS_KNOWN_SAFE = (typeof WORD_STATUS_KNOWN === 'number') ? WORD_STATUS_KNOWN : 2;

                        const fs = Flashcards();
                        const existingWords = new Set(Array.isArray(fs?.flashcards) ? fs.flashcards.map(fc=>fc?.content?.word).filter(Boolean) : []);
                        // Build a fast lookup for alreadyCreated uuids
                        const alreadyMap = (fs && fs.alreadyCreated) ? fs.alreadyCreated : {};

                        // Gather words at the selected level
                        const words = [];
                        for(const [w, data] of Object.entries(wordFreq||{})){
                            const lv = (data && typeof data.raw_level === 'number') ? data.raw_level : -1;
                            if(lv === levelNum){ words.push(w); }
                        }
                        if(words.length === 0) return;

                        // UI: disable while running
                        $addBtn.attr('disabled','disabled');
                        $levelSel.attr('disabled','disabled');
                        $addProg.show();
                        let done = 0;
                        const update = ()=>{ const pct = Math.floor((done/Math.max(1,words.length))*100); $addBar.css('width', pct+'%'); };
                        update();

                        for(const w of words){
                            try{
                                // Resolve uuid once for both status and alreadyCreated checks
                                let uuid = null;
                                try{ uuid = await toUniqueIdentifier(w); }catch(_e){ uuid = null; }

                                // Skip if status is KNOWN from any source (tracked, SRS, or knownUnTracked)
                                const stTracked = (uuid && (uuid in trackedWords)) ? Number(trackedWords[uuid]) : -1;
                                const stSrs = (uuid) ? Number(getSRSWordKnownStatusUUID(uuid)) : -1;
                                const isKnownUnTracked = !!(uuid && fs?.knownUnTracked && (uuid in fs.knownUnTracked));
                                if((Number.isFinite(stTracked) && stTracked >= WORD_STATUS_KNOWN_SAFE) ||
                                   (Number.isFinite(stSrs) && stSrs >= WORD_STATUS_KNOWN_SAFE) ||
                                   isKnownUnTracked){
                                    done++; update(); continue;
                                }

                                // Skip if already has a flashcard
                                if(existingWords.has(w)) { done++; update(); continue; }
                                // Check uuid against alreadyCreated
                                if(uuid && alreadyMap && (uuid in alreadyMap)) { done++; update(); continue; }
                                await createFlashcardForWord(w, levelNum);
                                existingWords.add(w);
                            }catch(_e){ /* skip on error */ }
                            done++; update();
                            // yield to UI occasionally
                            if(done % 10 === 0){ await new Promise(r => setTimeout(r, 0)); }
                        }

                        // Small delay then reset UI
                        setTimeout(()=>{ $addProg.hide(); $addBar.css('width','0%'); }, 400);
                        $addBtn.removeAttr('disabled');
                        $levelSel.removeAttr('disabled');
                    }catch(_err){
                        // Best-effort reset
                        $addBtn.removeAttr('disabled');
                        $levelSel.removeAttr('disabled');
                        $addProg.hide();
                        $addBar.css('width','0%');
                    }
                });
            }
        }catch(_e){ /* ignore UI wiring errors */ }

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
            setTracker: (uuid, value) => { if(itemsIndex[uuid]) itemsIndex[uuid].tracker = value; },
            translationTokenIndex,
            uuidToElement
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

    // Delegate status changes to shared pillHtml implementation for single source of truth
    statsWindow.changeKnownBtnStatus = (...args) => {
        try{
            if(window.mLearnPills && typeof window.mLearnPills.changeKnownBtnStatus === 'function'){
                return window.mLearnPills.changeKnownBtnStatus(...args);
            }
            if(typeof window.changeKnownBtnStatus === 'function'){
                return window.changeKnownBtnStatus(...args);
            }
            console.warn('Delegated changeKnownBtnStatus: shared handler not available');
        }catch(e){ console.error('Delegated changeKnownBtnStatus error (stats window)', e); }
    };
}

window.mLearnIPC.onOpenWordDbEditor(adjustWordsByLevel);
// Allow menubar or other IPC to open Kanji grid directly
if(window?.mLearnIPC && typeof window.mLearnIPC.onOpenKanjiGrid === 'function'){
    window.mLearnIPC.onOpenKanjiGrid(()=>{ try{ showKnownKanjiGrid(); }catch(_e){} });
}

// -----------------------------
// Kanji Grid Window
// -----------------------------
const WINDOW_HTML_KANJI_GRID = `<!doctypehtml>
<html lang="en">
<meta charset="UTF-8">
<title>Known Kanji Grid</title>
<link href="style.css" rel="stylesheet">
<style>
.kg-stats{font-size:12px; opacity:0.9; margin:6px 0 10px}
/* Align legends using CSS Grid */
.kg-topbar{ display:grid; row-gap:8px; align-content:start }
.kg-legend{ display:grid; grid-template-columns: 90px 16px 12px 16px; align-items:center; column-gap:6px }
.kg-legend .arrow{ text-align:center; opacity:0.8 }
</style>
<body class="settings-body dark">
<div class="kg-root">
  <div class="kg-title">Character knowledge overview</div>
  <div class="kg-sub">Colors: learning (orange→yellow), known (green→light-green); unknown (gray). Hover a level to highlight expected character. This is all the character found in all tested words included in all levels of your language exam.</div>
    <div class="kg-row">
    <div class="kg-grid"></div>
    <div class="kg-topbar">
        <div class="kg-legend"><span class="label">learning:</span>
            <span class="box" style="background:#E65100"></span> <span class="arrow">→</span>
            <span class="box" style="background:#FFEB3B"></span></div>
        <div class="kg-legend"><span class="label">known:</span>
            <span class="box" style="background:#2E7D32"></span> <span class="arrow">→</span>
            <span class="box" style="background:#81C784"></span></div>
        <div class="kg-legend">
            <span class="label">unknown:</span>
            <span class="box" style="background:#616161"></span>
            <span class="arrow"></span>
            <span class="box" style="visibility:hidden"></span>
        </div>
        <div class="kg-stats"></div>
    <div class="kg-levels contains_pills"><p>Kanji contained in words per levels</p><p>(some of them don't have to be learned): </p><div></div></div>
    </div>
    </div>

</div>
</body>
</html>`;

let kanjiGridWindow = null;
function isKanjiChar(ch){
    if(!ch) return false;
    const code = ch.codePointAt(0);
    return (
        (code >= 0x4E00 && code <= 0x9FFF) || // CJK Unified Ideographs
        (code >= 0x3400 && code <= 0x4DBF) || // Extension A
        (code >= 0xF900 && code <= 0xFAFF)    // Compatibility Ideographs
    );
}

function lerp(a,b,t){return a + (b-a)*Math.max(0,Math.min(1,t));}
function hexToRgb(hex){
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    if(!m) return {r:0,g:0,b:0};
    return { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) };
}
function rgbToHex({r,g,b}){
    const c = (n)=>{
        const v = Math.max(0, Math.min(255, Math.round(n)));
        return v.toString(16).padStart(2,'0');
    };
    return `#${c(r)}${c(g)}${c(b)}`;
}
function mixHex(c1,c2,t){
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return rgbToHex({ r: lerp(a.r,b.r,t), g: lerp(a.g,b.g,t), b: lerp(a.b,b.b,t) });
}

function buildFrequencyStars(doc, word){
    try{
        if(!(word in wordFreq)) return null;
        const level = wordFreq[word]?.raw_level;
        if(typeof level !== 'number' || level <= 0) return null;
        const freq = doc.createElement('span');
        freq.className = 'frequency';
        freq.setAttribute('level', level);
        for(let i=0;i<level;i++){
            const star = doc.createElement('span');
            star.className = 'star';
            freq.appendChild(star);
        }
        return freq;
    }catch(_e){ return null; }
}

async function buildKanjiStats(){
    // Aggregate kanji knowledge from tracked words
    const [trackedWords] = await getWordsLearnedInAppMoreInfo();
    const kanjiMap = new Map(); // kanji -> { score, hasKnown, learnCount, knownCount }
    const wordsByKanjiKnown = new Map();    // kanji -> Set(words)
    const wordsByKanjiLearning = new Map(); // kanji -> Set(words)
    const wordsByKanjiUnknown = new Map();  // kanji -> Set(words)
    const knownWordSet = new Set();         // word strings with status Known
    const learningWordSet = new Set();      // word strings with status Learning
    const seenWords = [];
    for(const [uuid, status] of Object.entries(trackedWords)){
        let word = null;
        try{ word = await getWordByUUID(uuid); }catch(_e){ word = null; }
        if(!word) continue;
        seenWords.push(word);
        const chars = Array.from(word);
        const uniqueKanji = new Set(chars.filter(isKanjiChar));
        if(uniqueKanji.size === 0) continue;
        for(const k of uniqueKanji){
            if(!kanjiMap.has(k)) kanjiMap.set(k, { score:0, hasKnown:false, learnCount:0, knownCount:0 });
            const it = kanjiMap.get(k);
            if(Number(status) === 2){
                it.score += 1; it.hasKnown = true; it.knownCount += 1;
                if(!wordsByKanjiKnown.has(k)) wordsByKanjiKnown.set(k, new Set());
                wordsByKanjiKnown.get(k).add(word);
                knownWordSet.add(word);
            } else if(Number(status) === 1){
                it.score += 0.5; it.learnCount += 1;
                if(!wordsByKanjiLearning.has(k)) wordsByKanjiLearning.set(k, new Set());
                wordsByKanjiLearning.get(k).add(word);
                learningWordSet.add(word);
            }
        }
    }
    // Add remaining kanji from frequency list and also build per-level kanji sets
    const levelKanji = {}; // level -> Set(kanji)
    if(typeof wordFreq === 'object'){
        for(const [w, data] of Object.entries(wordFreq)){
            const lvl = (data && (data.raw_level !== undefined)) ? data.raw_level : -1;
            if(levelKanji[lvl] === undefined) levelKanji[lvl] = new Set();
            const chars = Array.from(w);
            for(const ch of chars){
                if(!isKanjiChar(ch)) continue;
                levelKanji[lvl].add(ch);
                if(!kanjiMap.has(ch)) kanjiMap.set(ch, { score:0, hasKnown:false, learnCount:0, knownCount:0 });
                // If word is not in known or learning sets, consider it unknown for tooltip purposes
                if(!knownWordSet.has(w) && !learningWordSet.has(w)){
                    if(!wordsByKanjiUnknown.has(ch)) wordsByKanjiUnknown.set(ch, new Set());
                    wordsByKanjiUnknown.get(ch).add(w);
                }
            }
        }
    }
    // Classify and compute min/max for scales
    let maxKnown = 1, maxLearn = 0.5;
    for(const v of kanjiMap.values()){
        if(v.hasKnown){ maxKnown = Math.max(maxKnown, v.score); }
        else if(v.score > 0){ maxLearn = Math.max(maxLearn, v.score); }
    }
    return { kanjiMap, levelKanji, maxKnown, maxLearn, wordsByKanjiKnown, wordsByKanjiLearning, wordsByKanjiUnknown };
}

export async function showKnownKanjiGrid(){
    if(kanjiGridWindow){ kanjiGridWindow.focus(); return; }
    kanjiGridWindow = window.open("", "KanjiGridWindow", "width=1200,height=800");
    kanjiGridWindow.document.write(WINDOW_HTML_KANJI_GRID);
    kanjiGridWindow.window.addEventListener('unload', ()=>{ kanjiGridWindow = null; });
    const d = kanjiGridWindow.document;
    // Theme
    try{ d.body.classList.remove('dark','light'); d.body.classList.add(settings.dark_mode ? 'dark' : 'light'); }catch(_e){}

    // Build data and render
    const { kanjiMap, levelKanji, maxKnown, maxLearn, wordsByKanjiKnown, wordsByKanjiLearning, wordsByKanjiUnknown } = await buildKanjiStats();
    const grid = d.querySelector('.kg-grid');
    const levelsEl = d.querySelector('.kg-levels > div');
    const statsEl = d.querySelector('.kg-stats');

    // Prepare ordered kanji: known -> learning -> unknown, within groups by score desc, then by char
    const entries = Array.from(kanjiMap.entries()).map(([k, v])=>{
        const category = v.hasKnown ? 'known' : (v.score > 0 ? 'learning' : 'unknown');
        return [k, { ...v, category }];
    });
    entries.sort((a,b)=>{
        const order = { known:0, learning:1, unknown:2 };
        const ca = a[1].category, cb = b[1].category;
        if(order[ca] !== order[cb]) return order[ca]-order[cb];
        if(a[1].score !== b[1].score) return b[1].score - a[1].score;
        return a[0].localeCompare(b[0]);
    });

    function colorFor(item){
        if(item.category === 'known'){
            const t = (maxKnown > 1) ? (item.score - 1) / (maxKnown - 1) : 0;
            return mixHex('#2E7D32', '#81C784', t);
        }else if(item.category === 'learning'){
            const t = (maxLearn > 0.5) ? (item.score - 0.5) / (maxLearn - 0.5) : 0;
            return mixHex('#E65100', '#FFEB3B', t);
        }
        return settings.dark_mode ? '#616161' : '#9E9E9E';
    }

    // Render grid
    const frag = d.createDocumentFragment();
    let tooltipEl = null;
    const destroyTooltip = ()=>{ try{ tooltipEl?.remove(); tooltipEl = null; }catch(_e){} };
    const showTooltip = (ev, kanji, info)=>{
        destroyTooltip();
    const listKnown = Array.from(wordsByKanjiKnown.get(kanji) || []);
    const listLearning = Array.from(wordsByKanjiLearning.get(kanji) || []);
    const listUnknown = Array.from(wordsByKanjiUnknown.get(kanji) || []);
    if(listKnown.length === 0 && listLearning.length === 0 && listUnknown.length === 0) return;
        tooltipEl = d.createElement('div');
        tooltipEl.className = 'kg-tooltip contains_pills';
        const title = d.createElement('div');
        title.className = 'title';
        title.innerHTML = `Words containing ${kanji}<span style="opacity:0.5;"> - ${info.category} (score ${Math.round(info.score*10)/10}, known:${info.knownCount} learning:${info.learnCount})</span>`;
        const wordsWrap = d.createElement('div');
        wordsWrap.className = 'words';
        const addPill = (word, cls)=>{
            const pill = d.createElement('div');
            pill.className = `pill ${cls}`;
            pill.textContent = word;
            const stars = buildFrequencyStars(d, word);
            if(stars) pill.appendChild(stars);
            wordsWrap.appendChild(pill);
        };
    const CAP = 200;
    listKnown.slice(0,CAP).forEach(w=> addPill(w,'green'));
    listLearning.slice(0,CAP).forEach(w=> addPill(w,'orange'));
    listUnknown.slice(0,CAP).forEach(w=> addPill(w,'gray'));
        tooltipEl.appendChild(title);
        tooltipEl.appendChild(wordsWrap);
        d.body.appendChild(tooltipEl);
        // position
        const pad = 8;
        let x = ev.clientX + pad;
        let y = ev.clientY + pad;
        const rect = tooltipEl.getBoundingClientRect();
        const vw = d.documentElement.clientWidth;
        const vh = d.documentElement.clientHeight;
        if(x + rect.width + pad > vw) x = ev.clientX - rect.width - pad;
        if(y + rect.height + pad > vh) y = ev.clientY - rect.height - pad;
        tooltipEl.style.left = `${Math.max(0, x)}px`;
        tooltipEl.style.top = `${Math.max(0, y)}px`;
    };

    for(const [kanji, info] of entries){
        const div = d.createElement('div');
        div.className = 'kg-cell';
        div.setAttribute('data-kanji', kanji);
        div.setAttribute('data-status', info.category);
        // div.title = `${kanji} – ${info.category}\nscore ${Math.round(info.score*10)/10}  (known:${info.knownCount} learning:${info.learnCount})`;
        div.style.background = colorFor(info);
        // Text contrast for light backgrounds
        if(info.category !== 'unknown'){
            div.style.color = '#111';
        } else {
            div.style.color = settings.dark_mode ? '#ddd' : '#222';
        }
        const span = d.createElement('div');
        span.className = 'label';
        span.textContent = kanji;
        div.appendChild(span);
        // Tooltip events
        div.addEventListener('mousemove', (ev)=>{
            showTooltip(ev, kanji, info);
        });
        div.addEventListener('mouseleave', ()=>{
            destroyTooltip();
        });
        frag.appendChild(div);
    }
    grid.appendChild(frag);

    // Stats summary
    try{
        let knownCount = 0, learningCount = 0, unknownCount = 0;
        kanjiMap.forEach(v=>{
            if(v.hasKnown) knownCount++;
            else if(v.score > 0) learningCount++;
            else unknownCount++;
        });
        const total = knownCount + learningCount + unknownCount;
        if(statsEl){
            const pct = (n)=> total? Math.round(n/total*1000)/10 : 0;
            statsEl.innerHTML = ` · Known: <b>${knownCount}</b> (${pct(knownCount)}%)<br> · Learning: <b>${learningCount}</b> (${pct(learningCount)}%)<br> · Unknown: <b>${unknownCount}</b> (${pct(unknownCount)}%)<br> · Total Found: <b>${total}</b>`;
        }
    }catch(_e){}

    // Level chips
    const freqNames = (lang_data?.[settings.language]?.freq_level_names) || {};
    let levelKeys = Object.keys(freqNames).map(k=>Number(k)).filter(n=>!Number.isNaN(n));
    if(levelKeys.length === 0){
        levelKeys = Object.keys(levelKanji).map(k=>Number(k));
    }
    levelKeys.sort((a,b)=> b-a);
    const chipFrag = d.createDocumentFragment();
    for(const lvl of levelKeys){
        const name = freqNames?.[String(lvl)] || `Level ${lvl}`;
        const chip = d.createElement('div');
        chip.className = 'pill pill-btn';
        chip.setAttribute('level', String(lvl));
        chip.textContent = name;
        // Hover filter: dim cells not in this level set
        chip.addEventListener('mouseenter', ()=>{
            const set = levelKanji[lvl] || new Set();
            grid.querySelectorAll('.kg-cell').forEach(el=>{
                const k = el.getAttribute('data-kanji');
                const keep = set.has(k);
                el.setAttribute('dimmed', keep ? '0' : '1');
            });
        });
        chip.addEventListener('mouseleave', ()=>{
            grid.querySelectorAll('.kg-cell').forEach(el=> el.setAttribute('dimmed','0'));
        });
        chipFrag.appendChild(chip);
    }
    levelsEl.appendChild(chipFrag);
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
    getWordsLearnedInAppFormatted,
};