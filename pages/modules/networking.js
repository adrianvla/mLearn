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

// Max target area for OCR (preserve aspect ratio)
const MAX_OCR_AREA = 1000 * 1600; // pixels

// Helper: transcode any image Blob to PNG using canvas without blob: URLs (CSP-safe)
async function transcodeBlobToPng(blob, targetW, targetH){
    // If a size is provided, draw at that size; else keep intrinsic size
    // Try ImageBitmap path first (no URL required)
    try{
        if (typeof createImageBitmap === 'function'){
            const bmp = await createImageBitmap(blob);
            const w = targetW || bmp.width;
            const h = targetH || bmp.height;
            const useOffscreen = typeof OffscreenCanvas !== 'undefined';
            const canvas = useOffscreen ? new OffscreenCanvas(w, h) : document.createElement('canvas');
            if (!useOffscreen){
                canvas.width = w; canvas.height = h;
            }
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bmp, 0, 0, w, h);
            if (useOffscreen && typeof canvas.convertToBlob === 'function'){
                return await canvas.convertToBlob({ type: 'image/png', quality: 0.92 });
            }
            return await new Promise((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to create PNG blob')), 'image/png', 0.92);
            });
        }
    }catch(_e){ /* fallthrough to data URL path */ }

    // Fallback: data URL via FileReader (allowed by img-src 'self' data:)
    const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('Failed to read blob as data URL'));
        fr.readAsDataURL(blob);
    });
    const img = new Image();
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load data URL for transcode'));
        img.src = dataUrl;
    });
    const w = targetW || img.naturalWidth || img.width;
    const h = targetH || img.naturalHeight || img.height;
    if (!w || !h) throw new Error('Image has no intrinsic size');
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to create PNG blob')), 'image/png', 0.92);
    });
}

async function prepareBlobForOCR(blob){
    // Read dimensions without blob URLs, then resize/transcode to PNG if needed
    let w = 0, h = 0;
    try{
        if (typeof createImageBitmap === 'function'){
            const bmp = await createImageBitmap(blob);
            w = bmp.width; h = bmp.height;
        } else {
            // Fallback: use FileReader->Image path
            const dataUrl = await new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = () => reject(new Error('Failed to read blob as data URL'));
                fr.readAsDataURL(blob);
            });
            const img = new Image();
            await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
            w = img.naturalWidth || img.width; h = img.naturalHeight || img.height;
        }
    }catch(_e){ /* ignore; we will attempt direct transcode at native size */ }

    // Compute target size under MAX_OCR_AREA while preserving aspect ratio
    let targetW = w, targetH = h;
    if (w && h){
        const area = w * h;
        if (area > MAX_OCR_AREA){
            const scale = Math.sqrt(MAX_OCR_AREA / area);
            targetW = Math.max(1, Math.floor(w * scale));
            targetH = Math.max(1, Math.floor(h * scale));
        }
    }
    const t = (blob.type || '').toLowerCase();
    const needTranscode = t !== 'image/png' || (w && h && (w * h > MAX_OCR_AREA));
    if (!needTranscode){
        return blob;
    }
    return await transcodeBlobToPng(blob, targetW, targetH);
}

// Convert various inputs to a Blob or base64 string
function inputToBlobOrBase64(input, type='image/png', quality=0.92){
    return new Promise(async (resolve, reject) => {
        try{
            // If it's a Blob/File already
            if (input instanceof Blob){
                try{
                    const processed = await prepareBlobForOCR(input);
                    return resolve({ blob: processed });
                }catch(_e){
                    return resolve({ blob: input });
                }
            }

            // If it's a data URL string
            if (typeof input === 'string' && input.startsWith('data:')){
                return resolve({ base64: input });
            }

            // If it's a canvas
            if (typeof HTMLCanvasElement !== 'undefined' && input instanceof HTMLCanvasElement){
                const w = input.width, h = input.height;
                const area = w * h;
                if (area > MAX_OCR_AREA){
                    const scale = Math.sqrt(MAX_OCR_AREA / area);
                    const newW = Math.max(1, Math.floor(w * scale));
                    const newH = Math.max(1, Math.floor(h * scale));
                    const canvas = document.createElement('canvas');
                    canvas.width = newW; canvas.height = newH;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(input, 0, 0, newW, newH);
                    canvas.toBlob((blob) => {
                        if (blob) resolve({ blob }); else reject('Failed to create blob from canvas');
                    }, 'image/png', 0.92);
                } else {
                    input.toBlob((blob) => {
                        if (blob) resolve({ blob }); else reject('Failed to create blob from canvas');
                    }, 'image/png', 0.92);
                }
                return;
            }

            // If it's an image element
            if (typeof HTMLImageElement !== 'undefined' && input instanceof HTMLImageElement){
                const w = input.naturalWidth || input.width;
                const h = input.naturalHeight || input.height;
                if(!w || !h) return reject('Image has no intrinsic size');
                const area = w * h;
                let newW = w, newH = h;
                if (area > MAX_OCR_AREA){
                    const scale = Math.sqrt(MAX_OCR_AREA / area);
                    newW = Math.max(1, Math.floor(w * scale));
                    newH = Math.max(1, Math.floor(h * scale));
                }
                const canvas = document.createElement('canvas');
                canvas.width = newW; canvas.height = newH;
                const ctx = canvas.getContext('2d');
                try {
                    ctx.drawImage(input, 0, 0, newW, newH);
                } catch (e){
                    // Likely cross-origin taint; try fetching the src directly
                    try{
                        const res = await fetch(input.src, { mode: 'cors' });
                        const blob = await res.blob();
                        const processed = await prepareBlobForOCR(blob);
                        return resolve({ blob: processed });
                    }catch(_e){
                        return reject('Cannot access image data due to cross-origin restrictions.');
                    }
                }
                canvas.toBlob((blob) => {
                    if (blob) resolve({ blob }); else reject('Failed to create blob from image');
                }, 'image/png', 0.92);
                return;
            }

            // If it's a URL string (non-data), try fetch
            if (typeof input === 'string'){
                try{
                    const res = await fetch(input, { mode: 'cors' });
                    const blob = await res.blob();
                    const processed = await prepareBlobForOCR(blob);
                    return resolve({ blob: processed });
                }catch(_e){
                    return reject('Failed to fetch image from URL');
                }
            }

            // If it's a data URL string
            if (typeof input === 'string' && input.startsWith('data:')){
                try{
                    // Convert to blob first for unified processing
                    const response = await fetch(input);
                    const blob = await response.blob();
                    const processed = await prepareBlobForOCR(blob);
                    return resolve({ blob: processed });
                }catch(_e){
                    return reject('Failed to process data URL for OCR');
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