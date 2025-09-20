import {getPages} from "../handler/sequencer.js";
import {sendToReader} from "./dispatcher.js";

export const readPage = async (pageNum, el) => {
    const pages = getPages();
    const thisPage = pages[pageNum];
    let resp = await sendToReader(thisPage, pageNum);
    // Cache next page automatically (if exists)
    const nextIndex = pageNum + 1;
    if (nextIndex < pages.length) {
        const nextPage = pages[nextIndex];
        if (nextPage) sendToReader(nextPage, nextIndex, "Caching...");
    }
    console.log(pageNum,resp);
}