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

// Helper: transcode any image Blob to PNG using canvas without blob: URLs (CSP-safe)
async function transcodeBlobToPng(blob){
    // Fast path: if already PNG, return as-is
    if (!blob || blob.type === 'image/png') return blob;
    // Try ImageBitmap path first (no URL required)
    try{
        if (typeof createImageBitmap === 'function'){
            const bmp = await createImageBitmap(blob);
            // Prefer OffscreenCanvas if available
            const useOffscreen = typeof OffscreenCanvas !== 'undefined';
            const canvas = useOffscreen ? new OffscreenCanvas(bmp.width, bmp.height) : document.createElement('canvas');
            if (!useOffscreen){
                canvas.width = bmp.width; canvas.height = bmp.height;
            }
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
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
    const canvas = document.createElement('canvas');
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('Image has no intrinsic size');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to create PNG blob')), 'image/png', 0.92);
    });
}

// Convert various inputs to a Blob or base64 string
function inputToBlobOrBase64(input, type='image/png', quality=0.92){
    return new Promise(async (resolve, reject) => {
        try{
            // If it's a Blob/File already
            if (input instanceof Blob){
                // Only transcode if the type is likely unsupported by server-side Pillow
                const t = (input.type || '').toLowerCase();
                const needsTranscode = t.includes('webp') || t.includes('avif') || t.includes('heic') || t.includes('heif');
                if (needsTranscode){
                    try{
                        const png = await transcodeBlobToPng(input);
                        return resolve({ blob: png });
                    }catch(_e){
                        // Fallback to original blob
                        return resolve({ blob: input });
                    }
                }
                return resolve({ blob: input });
            }

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
                }, 'image/png', 0.92);
                return;
            }

            // If it's a URL string (non-data), try fetch
            if (typeof input === 'string'){
                try{
                    const res = await fetch(input, { mode: 'cors' });
                    const blob = await res.blob();
                    const t = (blob.type || '').toLowerCase();
                    const needsTranscode = t.includes('webp') || t.includes('avif') || t.includes('heic') || t.includes('heif');
                    if (needsTranscode){
                        try{
                            const png = await transcodeBlobToPng(blob);
                            return resolve({ blob: png });
                        }catch(_e){ /* fall through */ }
                    }
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