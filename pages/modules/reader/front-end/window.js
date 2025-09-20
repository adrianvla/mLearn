// Open the Reader window when the user clicks elements with class `.open-mlearn-reader`
import {initPositioning} from "./positioning.js";

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
        // Place reader init code here if needed, e.g. winRef.someInit && winRef.someInit();
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
