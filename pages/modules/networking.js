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

// Helper: derive OCR URL if not explicitly set
function deriveOcrUrl(){
    if (settings.ocrUrl) return settings.ocrUrl;
    if (settings.getTranslationUrl && settings.getTranslationUrl.includes('/translate')){
        return settings.getTranslationUrl.replace('/translate','/ocr');
    }
    if (settings.tokeniserUrl && settings.tokeniserUrl.includes('/tokenize')){
        return settings.tokeniserUrl.replace('/tokenize','/ocr');
    }
    return null;
}

// Convert various inputs to a Blob or base64 string
function inputToBlobOrBase64(input, type='image/png', quality=0.92){
    return new Promise(async (resolve, reject) => {
        try{
            // If it's a Blob/File already
            if (input instanceof Blob) return resolve({ blob: input });

            // If it's a data URL string
            if (typeof input === 'string' && input.startsWith('data:')){
                return resolve({ base64: input });
            }

            // If it's a canvas
            if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement){
                input.toBlob((blob) => {
                    if (blob) resolve({ blob }); else reject('Failed to create blob from canvas');
                }, type, quality);
                return;
            }

            // If it's an image element
            if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement){
                const canvas = document.createElement('canvas');
                const w = input.naturalWidth || input.width;
                const h = input.naturalHeight || input.height;
                if(!w || !h) return reject('Image has no intrinsic size');
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                try {
                    ctx.drawImage(input, 0, 0);
                } catch (e){
                    // Likely cross-origin taint; try fetching the src directly
                    try{
                        const res = await fetch(input.src, { mode: 'cors' });
                        const blob = await res.blob();
                        return resolve({ blob });
                    }catch(_e){
                        return reject('Cannot access image data due to cross-origin restrictions.');
                    }
                }
                canvas.toBlob((blob) => {
                    if (blob) resolve({ blob }); else reject('Failed to create blob from image');
                }, type, quality);
                return;
            }

            // If it's a URL string (non-data), try fetch
            if (typeof input === 'string'){
                try{
                    const res = await fetch(input, { mode: 'cors' });
                    const blob = await res.blob();
                    return resolve({ blob });
                }catch(_e){
                    return reject('Failed to fetch image from URL');
                }
            }

            reject('Unsupported input type for OCR');
        }catch(e){ reject(e); }
    });
}

function sendImageForOCR(imageInput){
    return new Promise(async (resolve, reject) => {
        const url = deriveOcrUrl();
        if(!url) return reject('OCR URL not configured');
        let payload;
        try{
            payload = await inputToBlobOrBase64(imageInput);
        }catch(e){
            return reject(e);
        }

        const form = new FormData();
        if (payload.blob){
            // Name the file for better server-side defaults
            form.append('file', payload.blob, 'image.png');
        } else if (payload.base64){
            form.append('image_base64', payload.base64);
        } else {
            return reject('Failed to prepare image data');
        }

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
        xhr.open('POST', url);
        // Note: do not set Content-Type manually for FormData
        xhr.send(form);
    });
}
window.sendImageForOCR = sendImageForOCR;

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

export {tokenise, getCards, getTranslation, sendRawToAnki, sendImageForOCR};