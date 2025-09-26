import {
    changeKnownStatus,
    getKnownStatus,
    saveKnownAdjustment,
    setKnownAdjustment, WORD_STATUS_KNOWN, WORD_STATUS_LEARNING,
    WORD_STATUS_UNKNOWN
} from "../stats/saving.js";
import {settings, wordFreq} from "../settings/settings.js";
import {getTranslation} from "../networking.js";
import {
    addFlashcard,
    saveFlashcards,
    getAllSRSTrackedWords,
    Flashcards,
    knownStatusToEaseFunction
} from "../flashcards/storage.js";
import {toUniqueIdentifier, screenshotVideo} from "../utils.js";
import {flashcardFunctions} from "./subtitler.js";
import {countFreq} from "../stats/wordFreq.js";

let wordUUIDs = {};
let wordPosByUUID = {};
let srsMapRef = null; // cached reference to alreadyCreated hashmap (uuid -> true)
let easeByWordRef = null; // cached map: word -> ease

function getSrsMap(){
    if(!srsMapRef) srsMapRef = getAllSRSTrackedWords();
    return srsMapRef || {};
}

function getEaseByWord(){
    if(!easeByWordRef){
        easeByWordRef = {};
        try{
            const fs = Flashcards();
            if(fs && Array.isArray(fs.flashcards)){
                for(const fc of fs.flashcards){
                    const w = fc?.content?.word;
                    if(w) easeByWordRef[w] = fc.ease;
                }
            }
        }catch(_e){ /* ignore */ }
    }
    return easeByWordRef;
}

// Cross-window resolver: attempts to locate the element in the current window first,
// then in any known reader window (opened via window.open) if bridged.
function findElementByIdAnyWindow(id){
    let el = null;
    try{ el = document.getElementById(id); }catch(_e){}
    if(el) return el;
    try{
        // If this is the main window, attempt to access the reader window reference (if stored globally)
        if(window.readerWindow && !window.readerWindow.closed){
            try{ el = window.readerWindow.document.getElementById(id); }catch(_e){}
            if(el) return el;
        }
    }catch(_e){}
    // Fallback: scan open child windows tracked in a simple list (future extension)
    return el;
}

function resetWordUUIDs() {
    wordUUIDs = {};
}
const unknownStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn red" onclick='changeKnownBtnStatus(this, "${uuid}", 1);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="assets/icons/cross2.svg" alt="">
    </span>
    <span>Unknown</span>
</div>`;
};
const learningStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn orange" onclick='changeKnownBtnStatus(this, "${uuid}", 2);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="assets/icons/check.svg" alt="">
    </span>
    <span>Learning</span>
</div>`;
};
const knownStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn green" onclick='changeKnownBtnStatus(this, "${uuid}", 0);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="assets/icons/check.svg" alt="">
    </span>
    <span>Known</span>
</div>`;
};
const addAnkiPillHTML = (uuid) => {
    return `<div class="pill pill-btn blue" onclick='clickAddFlashcardBtn("${uuid}");'>
    <span class="icon">
        <img src="assets/icons/cross2.svg" alt="" style="transform: rotate(45deg);">
    </span>
    <span>Anki</span>
</div>`;
};
const addToFlashcardsPillHTML = (uuid) => {
    return `<div class="pill pill-btn blue" onclick='clickAddToFlashcards(this, "${uuid}");' id="add-to-srs-pill-${uuid}">
    <span class="icon">
        <img src="assets/icons/cross2.svg" alt="" style="transform: rotate(45deg);">
    </span>
    <span>Flashcard</span>
</div>`;
};
const checkMarkFlashcardPillHTML = () => {
    return `<div class="pill pill-btn green">
    <span class="icon">
        <img src="assets/icons/check.svg" alt="">
    </span>
    <span>Tracked</span>
</div>`;
};
const easePillHTML = (ease)=>{
    return `<div class="pill yellow">
    <span>Ease: ${ease}</span>
</div>`;
};
const generateStatusPillHTML = async (word, status) => {
    const uuid = await toUniqueIdentifier(word);
    wordUUIDs[uuid] = word;
    if(status === WORD_STATUS_UNKNOWN){
        return unknownStatusPillHTML(uuid);
    }else if(status === WORD_STATUS_LEARNING){
        return learningStatusPillHTML(uuid);
    }else if(status === WORD_STATUS_KNOWN){
        return knownStatusPillHTML(uuid);
    }
    return "";
};

const changeKnownBtnStatus = async (...args) => {
    // Support signatures: (el, uuid, status) OR (uuid, status)
    let el = null, uuid = null, status = null;
    if(args.length === 3){
        [el, uuid, status] = args;
    }else if(args.length === 2){
        [uuid, status] = args;
    }else{
        console.warn("changeKnownBtnStatus called with unexpected args", args);
        return;
    }
    if(!uuid){
        console.warn("changeKnownBtnStatus missing uuid", args);
        return;
    }
    if(el == null){
        const id = `status-pill-${uuid}`;
        el = findElementByIdAnyWindow(id);
    }
    if(!el){
        console.warn("changeKnownBtnStatus: element not found for uuid", uuid);
        return;
    }
    try{
        const word = wordUUIDs[uuid];
        if(!word){
            console.warn("changeKnownBtnStatus: word not found for uuid", uuid);
            return;
        }
        const newHTML = await generateStatusPillHTML(word, status);
        // Replace carefully: if outerHTML not available (should be), fallback to manual replace
        if(typeof el.outerHTML === 'string'){
            el.outerHTML = newHTML;
        }else if(el.parentNode){
            const temp = document.createElement('div');
            temp.innerHTML = newHTML;
            el.parentNode.replaceChild(temp.firstElementChild, el);
        }
        console.log("Changed status of word:", word, "to", status);
        changeKnownStatus(word, status);
    }catch(e){
        console.error("changeKnownBtnStatus error", e);
    }
};


const changeKnownStatusButtonHTML = async (word, status = 0) => {
    if(!status)
        status = await getKnownStatus(word);
    return await generateStatusPillHTML(word, status);
};
const addEasePill = async (word) => {
    const easeMap = getEaseByWord();
    const easeVal = easeMap[word];
    return easePillHTML(easeVal !== undefined ? (Math.round(easeVal*100)/100) : "?");
};

const addPills = async (word,pos, addAnkiBtn = false)=>{
    //check if word is in wordFreq
    let s = `<div class="footer"><div class="pills">`;
    if(word in wordFreq){
        countFreq(wordFreq[word].raw_level);
        s += `<div class="pill" level="${wordFreq[word].raw_level}">${wordFreq[word].level}</div>`;
    }
    if(settings.show_pos){
        s += `<div class="pill">${pos}</div>`;
    }
    s += await changeKnownStatusButtonHTML(word);
    const uuid = await toUniqueIdentifier(word);
    wordUUIDs[uuid] = word;
    wordPosByUUID[uuid] = pos;
    // Determine if this word is already in the SRS system (O(1) hashmap lookup)
    let isInSRS = false;
    try{
        const srsMap = getSrsMap();
        if(srsMap && (uuid in srsMap)) isInSRS = true;
    }catch(_e){ /* ignore */ }
    if(isInSRS){
        s += checkMarkFlashcardPillHTML();
        s += await addEasePill(word);
    }else{
        if(addAnkiBtn)
            s += addAnkiPillHTML(uuid);
        s+=addToFlashcardsPillHTML(uuid);
    }


    s += `</div></div>`;
    return s;
};

const clickAddFlashcardBtn = (uuid) =>{
    console.log("clickAddFlashcardBtn",uuid);
    flashcardFunctions[uuid]();
};
// Namespace support for multi-window usage
if(!window.mLearnPills) window.mLearnPills = {};
window.mLearnPills.changeKnownBtnStatus = changeKnownBtnStatus;
// Keep legacy global for existing inline handlers
window.changeKnownBtnStatus = changeKnownBtnStatus;

// Create a flashcard immediately with the same content shape used when calling attemptFlashcardCreation in subtitler.js
async function clickAddToFlashcards(...args){
    // Signatures: (el, uuid) OR (uuid)
    let el = null, uuid = null;
    if(args.length === 2){
        [el, uuid] = args;
    }else if(args.length === 1){
        [uuid] = args;
    }else{
        console.warn("clickAddToFlashcards called with unexpected args", args);
        return;
    }
    if(!uuid){
        console.warn("clickAddToFlashcards missing uuid", args);
        return;
    }
    if(el == null){
        el = findElementByIdAnyWindow(`add-to-srs-pill-${uuid}`);
    }
    try{
        const word = wordUUIDs[uuid];
        if(!word) return;
        const pos = wordPosByUUID[uuid] || "";
        const translation_data = await getTranslation(word);
        if(!translation_data?.data || translation_data.data.length === 0) return;
        // Build example HTML snapshot similar to subtitler's cardNotFound
        let exampleHtml = "-";
        try{
            const $iframe = window.$ && window.$("iframe");
            if($iframe && $iframe.length){
                const body = $iframe[0].contentWindow.document.body;
                body.innerHTML = window.$(".subtitles").html();
                $iframe.contents().find(".subtitle_hover").remove();
                $iframe.contents().find(`.subtitle_word.word_${uuid}`).addClass("defined");
                exampleHtml = body.innerHTML || "-";
                body.innerHTML = "";
            }
        }catch(_e){ /* ignore snapshot issues */ }
        const content = {
            word: word,
            pitchAccent: translation_data.data?.[2]?.[2]?.pitches?.[0]?.position,
            pronunciation: translation_data.data?.[0]?.reading,
            translation: translation_data.data?.[0]?.definitions,
            definition: translation_data.data?.[1]?.definitions,
            example: exampleHtml,
            exampleMeaning: "",
            screenshotUrl: screenshotVideo(),
            pos: pos,
            level: (word in wordFreq ? (wordFreq[word]?.raw_level ?? -1) : -1),
        };
        // Create immediately (bypass candidate/attempt gating)
    const newEase = knownStatusToEaseFunction(await getKnownStatus(word));
    await addFlashcard(word, content, newEase);
    await saveFlashcards();
    // Update local caches for instant UI reflect
    try{ getSrsMap()[await toUniqueIdentifier(word)] = true; }catch(_e){}
    try{ getEaseByWord()[word] = newEase; }catch(_e){}

        if(!el){
            console.warn("clickAddToFlashcards: element not found for uuid", uuid);
        }else{
            try{ el.insertAdjacentHTML('afterend', await addEasePill(word)); }catch(_e){/* ignore */}
            try{ el.outerHTML = checkMarkFlashcardPillHTML(); }catch(_e){/* ignore */}
        }
        console.log(`Created SRS flashcard for word: ${word}`);
    }catch(e){
        console.error("Failed to add SRS flashcard:", e);
    }
}
window.mLearnPills.clickAddToFlashcards = clickAddToFlashcards;
window.clickAddToFlashcards = clickAddToFlashcards; // legacy

window.mLearnIPC.onUpdatePills((message)=>{
    const u = JSON.parse(message);
    console.log("Received queued pill updates: ",u);
    u.forEach(async (pair) => {
        setKnownAdjustment(pair.word,parseInt(pair.status));
    });
    saveKnownAdjustment();
});

// Export additional helper for reader window if needed
window.mLearnPills.clickAddFlashcardBtn = clickAddFlashcardBtn;
window.clickAddFlashcardBtn = clickAddFlashcardBtn; // legacy

export {unknownStatusPillHTML, changeKnownStatusButtonHTML, generateStatusPillHTML, addAnkiPillHTML, changeKnownBtnStatus, knownStatusPillHTML, learningStatusPillHTML, addPills, resetWordUUIDs};