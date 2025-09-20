import {getCurrentIndex, getPages} from "../handler/sequencer.js";
import {sendToReader} from "./dispatcher.js";
import { formatScaleFactor } from "../../networking.js";
let doc = null;
export const setDocument = (d) => doc = d;

const bindElement = (el)=>{
    console.log(el);
}

const processPage = async (ocr, scaleFactor, el, num)=> {
    if(num !== getCurrentIndex() && num !== getCurrentIndex()+1) return;
    console.log(ocr,scaleFactor,el);
    const rect = el.getBoundingClientRect();
    const origW = (ocr && ocr.original_size && ocr.original_size.width) ? ocr.original_size.width : (el.naturalWidth || rect.width || 1);
    const displayScale = rect.width / (origW || 1); // map original pixels -> CSS pixels
    const totalScale = scaleFactor * displayScale; // (original/sent) * (displayed/original) = displayed/sent
    $(el).parent().find(".recognized-text").remove();
    ocr.boxes.forEach(box => {
        let x = box.box[0][0];
        let y = box.box[0][1];
        let w = box.box[2][0] - x;
        let h = box.box[2][1] - y;
        x *= totalScale;
        y *= totalScale;
        w *= totalScale;
        h *= totalScale;
        const text = box.text;
        const txEl = $(`<div class="recognized-text" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
        $(el).parent().append(txEl);
    });
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
        processPage(resp, downFactor, el, pageNum); //intentionally not awaited
    }
    // Cache next page automatically (if exists)
    const nextIndex = pageNum + 1;
    if (nextIndex < pages.length) {
        const nextPage = pages[nextIndex];
        if (nextPage) sendToReader(nextPage, nextIndex, "Caching...");
    }
}