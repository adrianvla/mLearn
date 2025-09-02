import {settings} from "./settings/settings.js";

// Local overrides for translations (persisted in localStorage)
const OVERRIDE_KEY = 'ml_translation_overrides';

function readOverrides(){
    try{
        const raw = localStorage.getItem(OVERRIDE_KEY);
        if(!raw) return {};
        const obj = JSON.parse(raw);
        return (obj && typeof obj === 'object') ? obj : {};
    }catch(_e){
        return {};
    }
}

function writeOverrides(map){
    try{
        localStorage.setItem(OVERRIDE_KEY, JSON.stringify(map));
    }catch(_e){ /* ignore quota/errors */ }
}

function deepClone(obj){
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
}

export function getTranslationOverride(word){
    if(!word) return null;
    const map = readOverrides();
    return map[word] ? deepClone(map[word]) : null;
}

export function setTranslationOverride(word, value){
    if(!word) return;
    const map = readOverrides();
    if(value === null || value === undefined){
        delete map[word];
    } else {
        map[word] = value;
    }
    writeOverrides(map);
}

export function clearTranslationOverride(word){
    setTranslationOverride(word, null);
}
function tokenise(text){
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                resolve(response.tokens);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', settings.tokeniserUrl);
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({"text":text}));
    });
}
function getCards(text){
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', settings.getCardUrl);
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({"word":text}));
    });
}

function getTranslation(text){
    // If there's a local override, return it immediately
    try{
        const ov = getTranslationOverride(text);
        if(ov) return Promise.resolve(ov);
    }catch(_e){ /* ignore */ }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
            } catch (e) {
                reject(e);
                console.log(xhr.responseText);
            }
        });

        xhr.open('POST', settings.getTranslationUrl);
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({"word":text}));
    });
}
window.getTranslation = getTranslation;
// Expose override helpers for debugging/manual tweaks
window.getTranslationOverride = getTranslationOverride;
window.setTranslationOverride = setTranslationOverride;
window.clearTranslationOverride = clearTranslationOverride;

function sendRawToAnki(data){
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', settings.ankiUrl);
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(data));
    });
}
window.mLearnIPC.sendLS(localStorage);

export {tokenise, getCards, getTranslation, sendRawToAnki};