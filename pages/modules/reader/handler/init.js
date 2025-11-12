import {initDragAndDrop} from "./dragndrop-lib.js";
import {createAndAddPageEntry} from "../elements/page-entry.js";
import {parseSubtitleName} from "../../subtitler/subtitleParsers.js";
import {setCurrentPage, setPages, updateImagePages, getCurrentIndex} from "./sequencer.js";
import {refreshPositioning} from "../front-end/positioning.js";
let isInit = false;


export const isInitialized = () => isInit;
export function initReaderDnD(winDoc) {
    // Initialize drag-n-drop on the reader window document
    const dnd = initDragAndDrop(winDoc);

    // React to the event fired after a successful drop
    winDoc.addEventListener("reader:images-dropped", (ev) => {
        const { images } = ev.detail;
        const bookTitle = images.length ? parseSubtitleName(images[0].source) : null;
        setPages(images, bookTitle);
        renderImages(winDoc, images, { bookTitle });
        isInit = true;
    });

    // Optional: if you prefer awaiting instead of the event
    // (Uncomment to use Promise style)
    // (async () => {
    //   const images = await dnd.waitForNextDrop();
    //   renderImages(winDoc, images);
    // })();
}

function renderImages(doc, images, options = {}) {
    updateImagePages(doc);

    try {
        const welcomeEl = doc.querySelector('.reader-welcome');
        if (welcomeEl) {
            if (Array.isArray(images) && images.length > 0) {
                welcomeEl.classList.add('hidden');
            } else {
                welcomeEl.classList.remove('hidden');
            }
        }
    } catch (_e) {
        /* non-critical */
    }

    // Update basic title/progress if you want
    const titleEls = doc.querySelectorAll(".book-title");
    const totalPages = images.length;
    const currentIdx = getCurrentIndex();
    const nameOfWork = options.bookTitle ?? (totalPages ? parseSubtitleName(images[0].source) : "No book loaded");
    titleEls.forEach((el) => {
        el.textContent = totalPages ? `${nameOfWork}` : "No book loaded";
    });
    $("title",doc).text(totalPages ? `mLearn Reader - ${nameOfWork}` : "mLearn Reader");
    const progressEls = doc.querySelectorAll(".book-progress");
    progressEls.forEach((el) => {
        const displayIndex = totalPages ? Math.min(currentIdx + 1, totalPages) : 0;
        el.textContent = totalPages ? `${displayIndex}/${totalPages}` : "0/0";
    });
    // You can also populate the sidebar with thumbnails if needed
    // Example thumbnail rendering:
    images.forEach((img, idx) => {
      const thumb = createAndAddPageEntry(doc,parseSubtitleName(img.name), img.url);
      thumb.addEventListener("click", () => {
          console.log("Clicked on thumbnail", idx);
          setCurrentPage(idx);
          updateImagePages(doc);
      });
    });

    waitForDisplayedPages(doc).finally(() => {
        refreshPositioning(doc);
    });
}

function waitForDisplayedPages(doc) {
    const selectors = ".main-content .main-page .page-left img, .main-content .main-page .page-right img";
    const pageImages = Array.from(doc.querySelectorAll(selectors));
    if (!pageImages.length) return Promise.resolve();
    const waits = pageImages.map((img) => {
        if (!img) return Promise.resolve();
        if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
        });
    });
    return Promise.all(waits);
}