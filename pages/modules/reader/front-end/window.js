import {initPositioning} from "./positioning.js";
import {initReaderDnD} from "../handler/init.js";
import {initSequencer} from "../handler/sequencer.js";
import {setDocument as setDoc1} from "../ocr/dispatcher.js";
import {setDocument as setDoc2} from "../ocr/read.js";

let readerWindow = null;
let hasLoaded = false;

$(".open-mlearn-reader").on("click", () => {
    if (readerWindow) return;
    readerWindow = window.open("reader.html", "ReaderWindow", "width=1400,height=900");
    const winRef = readerWindow;

    // Track window lifecycle
    winRef.addEventListener('unload', () => {
        if (!hasLoaded) return;
        if (readerWindow === winRef) readerWindow = null;
        hasLoaded = false;
    });

    // Run any reader-specific initialization after the content loads
    winRef.onload = () => {
        hasLoaded = true;
        initPositioning(winRef.document);
        initReaderDnD(winRef.document);
        initSequencer(winRef.document);
        setDoc1(winRef.document);
        setDoc2(winRef.document);
        try{
            // Bridge pill functions if parent window has them
            if(window.mLearnPills){
                winRef.mLearnPills = winRef.mLearnPills || {};
                for(const k of Object.keys(window.mLearnPills)){
                    winRef.mLearnPills[k] = window.mLearnPills[k];
                }
                // Also expose legacy globals expected by inline onclick attributes
                if(window.mLearnPills.clickAddToFlashcards) winRef.clickAddToFlashcards = window.mLearnPills.clickAddToFlashcards;
                if(window.mLearnPills.changeKnownBtnStatus) winRef.changeKnownBtnStatus = window.mLearnPills.changeKnownBtnStatus;
                if(window.mLearnPills.clickAddFlashcardBtn) winRef.clickAddFlashcardBtn = window.mLearnPills.clickAddFlashcardBtn;
                if(window.mLearnPills.clickLLMExplain) winRef.clickLLMExplain = window.mLearnPills.clickLLMExplain;
            }
        }catch(e){ console.warn("Failed to bridge pill functions to reader window", e); }
    };
});

// Optional: allow other modules or IPC to request opening the reader window
if (window.mLearnIPC && typeof window.mLearnIPC.onOpenReaderRequest === 'function') {
    window.mLearnIPC.onOpenReaderRequest(() => {
        $(".open-mlearn-reader").trigger("click");
    });
}

export function closeWindow() {
    if (readerWindow && !readerWindow.closed) readerWindow.close();
}

export function getDocument() {
    return readerWindow ? readerWindow.document : null;
}
