import {refreshFitMode} from "../front-end/positioning.js";
import {readPage} from "../ocr/read.js";
import {sendToReader} from "../ocr/dispatcher.js";
import {parseSubtitleName} from "../../subtitler/subtitleParsers.js";

let pages = [];
let currentIndex = 0;
let currentMode = "double"; //also "single"
let doc = null;
let currentBookId = null;

const STORAGE_KEY_PREFIX = "reader:last-page:";

const getView = () => {
    if (doc && doc.defaultView) return doc.defaultView;
    if (typeof window !== "undefined") return window;
    return null;
};

const getStorage = () => {
    const view = getView();
    if (!view) return null;
    try {
        return view.localStorage;
    } catch (err) {
        console.warn("[Reader][Storage] localStorage unavailable", err);
        return null;
    }
};

const makeStorageKey = (bookId) => `${STORAGE_KEY_PREFIX}${bookId}`;

const loadSavedPageIndex = (bookId) => {
    if (!bookId) return null;
    const storage = getStorage();
    if (!storage) return null;
    try {
        const raw = storage.getItem(makeStorageKey(bookId));
        if (raw === null) return null;
        const val = Number.parseInt(raw, 10);
        return Number.isFinite(val) ? val : null;
    } catch (err) {
        console.warn("[Reader][Storage] Failed to read page index", err);
        return null;
    }
};

const persistCurrentPage = () => {
    if (!currentBookId) return;
    const storage = getStorage();
    if (!storage) return;
    if (!pages.length) return;
    const normalized = Math.min(Math.max(currentIndex, 0), pages.length - 1);
    try {
        storage.setItem(makeStorageKey(currentBookId), String(normalized));
    } catch (err) {
        console.warn("[Reader][Storage] Failed to persist page index", err);
    }
};

const normalizeCurrentIndex = () => {
    if (!pages.length) {
        currentIndex = 0;
        return;
    }
    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= pages.length) currentIndex = pages.length - 1;
};
export const initSequencer = (d) => {
    doc = d;
    pages = [];
    currentIndex = 0;
    currentMode = "double";
    currentBookId = null;
    $("select#page-mode-select",d).on("change", (e) => {
        setCurrentMode(e.target.value);
        updateCurrentMode(d);
        updateImagePages(d);
    });
    $(".nav .left-btn",d).on("click", ()=>{
        previousPage();
        updateImagePages(d);
    });
    $(".nav .right-btn",d).on("click", ()=>{
        nextPage();
        updateImagePages(d);
    });
    $(d).on("keydown", (e) => {
        if (e.key === "ArrowLeft") {
            $(".nav .left-btn", d).trigger("click");
        }
        if (e.key === "ArrowRight") {
            $(".nav .right-btn", d).trigger("click");
        }
    });
};

export const setPages = (newPages, bookId) => {
    pages = Array.isArray(newPages) ? newPages : [];
    const trimmedBookId = typeof bookId === "string" ? bookId.trim() : null;
    const derivedFromPages = pages.length ? parseSubtitleName(pages[0].source || pages[0].name || "") : null;
    currentBookId = trimmedBookId || derivedFromPages || null;
    currentIndex = 0;
    const savedIndex = loadSavedPageIndex(currentBookId);
    if (typeof savedIndex === "number") {
        currentIndex = savedIndex;
    }
    normalizeCurrentIndex();
    updatePageIndicators();
    persistCurrentPage();
    return currentIndex;
};
export const getPages = () => pages;

export const getCurrentPage = () => {
    if(pages.length === 0) return [null];
    if(pages.length === 1) return [pages[0]];
    if(currentIndex < 0) return [null];
    if(currentMode === "double") return Math.floor(currentIndex/2)*2+1 >= pages.length ? [pages[currentIndex],null] : [pages[Math.floor(currentIndex/2)*2], pages[Math.floor(currentIndex/2)*2+1]];
    else return [pages[currentIndex]];
};
export const setCurrentPage = (newIndex) => {
    currentIndex = newIndex;
    normalizeCurrentIndex();
    updatePageIndicators();
    persistCurrentPage();
};
const updatePageIndicators = ()=>{
    if(!doc) return;
    const $progress = $(".book-progress", doc);
    if(!$progress.length) return;
    const totalPages = pages.length;
    const displayIndex = totalPages ? Math.min(Math.max(currentIndex, 0), totalPages - 1) + 1 : 0;
    $progress.text(`${displayIndex}/${totalPages}`);
};
export const nextPage = () => {
    currentIndex += currentMode === "double" ? 2 : 1;
    normalizeCurrentIndex();
    updatePageIndicators();
    persistCurrentPage();
};
export const previousPage = () => {
    currentIndex -= currentMode === "double" ? 2 : 1;
    normalizeCurrentIndex();
    updatePageIndicators();
    persistCurrentPage();
};
export const getCurrentIndex = () => currentIndex;
export const setCurrentMode = (newMode) => {
    currentMode = newMode;
    if(currentMode != "single" && currentMode != "double")
        throw new Error(
            `Invalid mode: ${currentMode}. Mode must be either "single" or "double".`
        );
}
export const getCurrentMode = () => currentMode;

export const updateCurrentMode = (d)=>{
    const pl = $(".main-content .main-page .page-left",d);
    // const pr = $(".main-content .main-page .page-right",d);
    const mainPage = $(".main-content",d);
    if(currentMode === "double"){
        mainPage.removeClass("single-page");
        pl.removeClass("dn");
    }else{
        mainPage.addClass("single-page");
        pl.addClass("dn");
    }
};
export const anticipatePages = 2;

export const getCacheOffset = () => {
    return currentMode === "double" ? 2 : 1;
}

export const updateImagePages = (d, doRefresh = true) => {
    updateCurrentMode(d);
    const pl = d.querySelector(".page-left img");
    const pr = d.querySelector(".page-right img");
    const currPage = getCurrentPage();
    if(currentMode === "double"){
        pr.src = currPage[0].url;
        pl.src = currPage[1].url;
        readPage(Math.floor(currentIndex/2)*2, pr); //promise ignored intentionally
        if(Math.floor(currentIndex/2)*2 + 1 <= pages.length - 1)
            readPage(Math.floor(currentIndex/2)*2+1, pl); //promise ignored intentionally
    }else{
        pr.src = currPage[0].url;
        pl.src = "";
        readPage(getCurrentIndex(), pr); //promise ignored intentionally
    }
    if(!doRefresh) return;
    refreshFitMode();
    // const nextIndex = pageNum + 1;
    // if (nextIndex < pages.length) {
    //     const nextPage = pages[nextIndex];
    //     if (nextPage) sendToReader(nextPage, nextIndex, "Caching...");
    // }
    const cacheOffset = getCacheOffset();
    const flooredCurrIndex = Math.floor(currentIndex/2)*2;
    for(let i = flooredCurrIndex + cacheOffset; i < flooredCurrIndex + cacheOffset + anticipatePages; i++){
        if(i >= pages.length) break;
        const pageToCache = pages[i];
        if(pageToCache) sendToReader(pageToCache, i, `Caching ${i - flooredCurrIndex - cacheOffset + 1}/${anticipatePages}...`);
    }
}