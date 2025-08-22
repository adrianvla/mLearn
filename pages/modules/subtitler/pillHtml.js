import {changeKnownStatus, getKnownStatus, saveKnownAdjustment, setKnownAdjustment} from "../stats/saving.js";
import {settings, wordFreq} from "../settings/settings.js";
import {toUniqueIdentifier} from "../utils.js";
import {flashcardFunctions} from "./subtitler.js";
import {countFreq} from "../stats/wordFreq.js";

let wordUUIDs = {};

function resetWordUUIDs() {
    wordUUIDs = {};
}
const unknownStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn red" onclick='changeKnownBtnStatus("${uuid}", 1);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="assets/icons/cross2.svg" alt="">
    </span>
    <span>Unknown</span>
</div>`;
};
const learningStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn orange" onclick='changeKnownBtnStatus("${uuid}", 2);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="assets/icons/check.svg" alt="">
    </span>
    <span>Learning</span>
</div>`;
};
const knownStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn green" onclick='changeKnownBtnStatus("${uuid}", 0);' id="status-pill-${uuid}">
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
const generateStatusPillHTML = async (word, status) => {
    const uuid = await toUniqueIdentifier(word);
    wordUUIDs[uuid] = word;
    if(status == 0){
        return unknownStatusPillHTML(uuid);
    }else if(status == 1){
        return learningStatusPillHTML(uuid);
    }else if(status == 2){
        return knownStatusPillHTML(uuid);
    }
    return "";
};

const changeKnownBtnStatus = async (uuid, status) => {
    const id = `status-pill-${uuid}`;
    const el = document.getElementById(id);
    const word = wordUUIDs[uuid];
    el.outerHTML = await generateStatusPillHTML(word, status);
    console.log("Changed status of word: "+word+" to "+status);
    changeKnownStatus(word, status);
};


const changeKnownStatusButtonHTML = async (word, status = 0) => {
    if(!status)
        status = await getKnownStatus(word);
    return await generateStatusPillHTML(word, status);
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
    if(addAnkiBtn){
        const uuid = await toUniqueIdentifier(word);
        wordUUIDs[uuid] = word;
        s += addAnkiPillHTML(uuid);
    }

    s += `</div></div>`;
    return s;
};

const clickAddFlashcardBtn = (uuid) =>{
    console.log("clickAddFlashcardBtn",uuid);
    flashcardFunctions[uuid]();
};
window.changeKnownBtnStatus = changeKnownBtnStatus;

window.mLearnIPC.onUpdatePills((message)=>{
    const u = JSON.parse(message);
    console.log("Received queued pill updates: ",u);
    u.forEach(async (pair) => {
        setKnownAdjustment(pair.word,parseInt(pair.status));
    });
    saveKnownAdjustment();
});

export {unknownStatusPillHTML, changeKnownStatusButtonHTML, generateStatusPillHTML, addAnkiPillHTML, changeKnownBtnStatus, knownStatusPillHTML, learningStatusPillHTML, addPills, resetWordUUIDs};