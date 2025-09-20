import {getPages} from "../handler/sequencer.js";
import {sendToReader} from "./dispatcher.js";
import { formatScaleFactor } from "../../networking.js";
let doc = null;
export const setDocument = (d) => doc = d;

const processPage = async (ocr, scaleFactor, el)=> {

}

export const readPage = async (pageNum, el) => {
    const pages = getPages();
    const thisPage = pages[pageNum];
    let resp = await sendToReader(thisPage, pageNum);
    // Attach and/or display client-side scale info for correct box rendering
    // resp.client_scale is the factor applied to the original (<=1). To map boxes returned
    // for the sent image to the original rendered page, multiply by 1/resp.client_scale.
    if (resp && typeof resp.client_scale === 'number'){
        const cs = resp.client_scale;
        const downFactor = cs > 0 ? (1 / cs) : 1;
        // Store on the element for overlay modules to use
        if (el){
            try{
                el.dataset.ocrScale = String(cs);
                el.dataset.ocrDownscale = String(downFactor);
                el.dataset.ocrScaleLabel = formatScaleFactor(downFactor);
            }catch(_e){ /* dataset may be unavailable on some nodes */ }
        }
        processPage(resp, downFactor, el); //intentionally not awaited
    }
    // Cache next page automatically (if exists)
    const nextIndex = pageNum + 1;
    if (nextIndex < pages.length) {
        const nextPage = pages[nextIndex];
        if (nextPage) sendToReader(nextPage, nextIndex, "Caching...");
    }
}