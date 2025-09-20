import {getPages} from "../handler/sequencer.js";
import {sendToReader} from "./dispatcher.js";

export const readPage = async (pageNum, el) => {
    const pages = getPages();
    const thisPage = pages[pageNum];
    let resp = await sendToReader(thisPage, pageNum);
    {//cache next page automatically
        const nextPage = pages[pageNum+1];
        sendToReader(nextPage, pageNum, "Caching...");
    }
    console.log(pageNum,resp);
}