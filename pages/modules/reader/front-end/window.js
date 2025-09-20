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
