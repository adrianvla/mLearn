import { sendImageForOCR } from "../../networking.js";
import {anticipatePages, getCacheOffset, getCurrentIndex} from "../handler/sequencer.js";

// Simple FIFO task queue for OCR requests
let cache = {};
let doc = null;
let taskQueue = [];
let processing = false;
const pending = new Map(); // key -> { promise, resolve, reject }

export const setDocument = (d) => (doc = d);

const setOCRStatus = (s) => {
    if (!doc) return;
    if(s === "Ready") $(".progress-container",doc).addClass("dn");
    else $(".progress-container",doc).removeClass("dn");
    $(".ocr-status", doc).text(s);
};

const waitNms = (n) => new Promise((resolve) => setTimeout(resolve, n));

async function processQueue() {
    if (processing) return;
    processing = true;
    try {
        while (taskQueue.length > 0) {
            const task = taskQueue.shift();
            try {
                if(task.key in cache){
                    task.resolve(cache[task.key]);
                }else{
                    if(task.pageNum >= (Math.floor(getCurrentIndex()/2)*2) && task.pageNum <= (Math.floor(getCurrentIndex()/2)*2 + anticipatePages + getCacheOffset())){
                        if (!task.page || !task.page.blob) {
                            throw new Error("OCR task is missing a valid page blob");
                        }
                        setOCRStatus(task.mode || "Processing...");
                        console.log("%cSending image for OCR", "color: #4CAF50; font-weight: bold; font-size:16px;");
                        // Send the raw Blob directly; the networking layer will package it into FormData
                        const resp = await sendImageForOCR(task.page.blob);
                        cache[task.key] = resp;
                        task.resolve(resp);
                        // Wait until this page's overlays finish rendering before processing next task
                        // Skip waiting for caching tasks, since those pages won't render immediately
                        const isCachingTask = typeof task.mode === 'string' && /^Caching\b/.test(task.mode);
                        if(!isCachingTask){
                            await waitForRender(task.pageNum);
                        }
                    }else{
                        task.reject("Canceled");
                    }
                }
            } catch (err) {
                console.error("OCR task failed:", err);
                setOCRStatus("Error");
                task.reject(err);
            } finally {
                pending.delete(task.key);
            }
        }
    } finally {
        setOCRStatus("Ready");
        processing = false;
    }
}

export async function sendToReader(page, pageNum = 0, mode = "Processing...") {
    if (!page) {
        setOCRStatus("Ready");
        return Promise.resolve({ boxes: [] });
    }
    const key = `${pageNum}-${page.name || 'page'}`;

    // Return cached result if available
    if (key in cache) {
        setOCRStatus("Ready");
        return cache[key];
    }

    // If a task with the same key is already queued/running, return its promise
    if (pending.has(key)) {
        return pending.get(key).promise;
    }

    // Enqueue a new task and return its promise
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    pending.set(key, { promise, resolve, reject });

    taskQueue.push({ key, page, mode, resolve, reject, pageNum });
    processQueue();
    return promise;
}

// Rendering coordination: block the queue until a page reports it's done drawing overlays
const renderWaiters = new Map(); // pageNum -> [resolvers]
const renderedPages = new Set();

export function markRendered(pageNum){
    try{
        renderedPages.add(pageNum);
        const arr = renderWaiters.get(pageNum) || [];
        for(const r of arr){ try{ r(); }catch(_e){} }
        renderWaiters.delete(pageNum);
    }catch(_e){ /* ignore */ }
}

export function waitForRender(pageNum){
    if(renderedPages.has(pageNum)) return Promise.resolve();
    return new Promise((resolve)=>{
        const arr = renderWaiters.get(pageNum) || [];
        arr.push(resolve);
        renderWaiters.set(pageNum, arr);
    });
}