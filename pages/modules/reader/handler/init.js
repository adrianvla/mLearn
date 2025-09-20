import {initDragAndDrop} from "./dragndrop-lib.js";
import {createAndAddPageEntry} from "../elements/page-entry.js";
import {parseSubtitleName} from "../../subtitler/subtitleParsers.js";
import {setCurrentPage, setPages, updateImagePages} from "./sequencer.js";

export function initReaderDnD(winDoc) {
    // Initialize drag-n-drop on the reader window document
    const dnd = initDragAndDrop(winDoc);

    // React to the event fired after a successful drop
    winDoc.addEventListener("reader:images-dropped", (ev) => {
        const { images } = ev.detail;
        setPages(images);
        renderImages(winDoc, images);
    });

    // Optional: if you prefer awaiting instead of the event
    // (Uncomment to use Promise style)
    // (async () => {
    //   const images = await dnd.waitForNextDrop();
    //   renderImages(winDoc, images);
    // })();
}

function renderImages(doc, images) {
    updateImagePages(doc);

    // Update basic title/progress if you want
    const titleEls = doc.querySelectorAll(".book-title");
    console.log(images);
    const nameOfWork = parseSubtitleName(images[0].source);
    titleEls.forEach((el) => {
        el.textContent = images.length ? `${nameOfWork}` : "No book loaded";
    });
    $("title",doc).text(`mLearn Reader - ${nameOfWork}`);
    const progressEls = doc.querySelectorAll(".book-progress");
    progressEls.forEach((el) => {
        el.textContent = images.length ? `1/${images.length}` : "0/0";
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
}