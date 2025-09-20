import {getCurrentIndex, getPages} from "../handler/sequencer.js";
import {sendToReader} from "./dispatcher.js";
import { formatScaleFactor } from "../../networking.js";
import {settings} from "../../settings/settings.js";
let doc = null;
export const setDocument = (d) => doc = d;

const bindElement = (el)=>{
    console.log(el);
}

const processPage = async (ocr, scaleFactor, el, num)=> {
    if(num !== (Math.floor(getCurrentIndex()/2)*2) && num !== (Math.floor(getCurrentIndex()/2)*2 + 1)) return;
    console.log(ocr,scaleFactor,el);
    const rect = el.getBoundingClientRect();
    const origW = (ocr && ocr.original_size && ocr.original_size.width) ? ocr.original_size.width : (el.naturalWidth || rect.width || 1);
    const displayScale = rect.width / (origW || 1); // map original pixels -> CSS pixels
    const totalScale = scaleFactor * displayScale; // (original/sent) * (displayed/original) = displayed/sent
    $(el).parent().find(".recognized-text").remove();
    
    // Furigana filtering (JP): detect a distinct small-width cluster and drop it
    let boxes = (ocr && Array.isArray(ocr.boxes)) ? [...ocr.boxes] : [];
    if (settings.language === "ja" && boxes.length > 2) {
        try {
            // Work with widths in original OCR pixel space (before any scaling)
            const widths = boxes.map(b => {
                const x0 = (b && b.box && b.box[0]) ? b.box[0][0] : 0;
                const x2 = (b && b.box && b.box[2]) ? b.box[2][0] : x0;
                return Math.max(0, x2 - x0);
            });

            const minW = Math.min(...widths);
            const maxW = Math.max(...widths);
            if (maxW > 0 && maxW > minW) {
                // Simple 1D k-means (k=2) to separate small (furigana) vs regular widths
                let c0 = minW;
                let c1 = maxW;
                const assign = new Array(widths.length).fill(0);
                for (let iter = 0; iter < 10; iter++) {
                    let changed = false;
                    // Assign step
                    for (let i = 0; i < widths.length; i++) {
                        const w = widths[i];
                        const a = (Math.abs(w - c0) <= Math.abs(w - c1)) ? 0 : 1;
                        if (assign[i] !== a) { assign[i] = a; changed = true; }
                    }
                    // Update step
                    let sum0 = 0, n0 = 0, sum1 = 0, n1 = 0;
                    for (let i = 0; i < widths.length; i++) {
                        if (assign[i] === 0) { sum0 += widths[i]; n0++; } else { sum1 += widths[i]; n1++; }
                    }
                    if (n0 > 0) c0 = sum0 / n0;
                    if (n1 > 0) c1 = sum1 / n1;
                    if (!changed) break;
                }
                const bigIdx = (c0 >= c1) ? 0 : 1;
                const bigMean = Math.max(c0, c1);
                const smallMean = Math.min(c0, c1);
                const separation = bigMean / Math.max(1e-6, smallMean);
                // Only filter when bimodality is clear (avoid false positives)
                if (separation >= 1.8) {
                    boxes = boxes.filter((_, i) => assign[i] === bigIdx);
                }
            }
        } catch (_e) {
            // If anything goes wrong, fall back to rendering all boxes
        }
    }

    boxes.forEach(box => {
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
        bindElement(txEl);
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