import {getCurrentIndex, getPages} from "../handler/sequencer.js";
import {sendToReader, markRendered} from "./dispatcher.js";
import { formatScaleFactor } from "../../networking.js";
import {settings} from "../../settings/settings.js";
import {attachInteractiveText} from "../../common/hoverTokens.js";
let doc = null;
export const setDocument = (d) => doc = d;

// Cache last known OCR render context so we can recompute overlay positions
// Structure: pageNum -> { ocr, downFactor, el }
const ocrRenderCache = new Map();

// Simple debounce helper (local to this module)
export function debounce(fn, wait = 50){
    let t; return function(...args){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,args), wait); };
}

// Recalculate box positions for all currently rendered pages.
// Keeps existing interactive content (inner spans) & only updates container positioning.
export function refreshOCRPositions(){
    try{
        for(const [pageNum, ctx] of ocrRenderCache.entries()){
            const { ocr, downFactor, el } = ctx || {};
            if(!ocr || !el) continue;
            // Only refresh if page images are still in DOM
            if(!document.contains(el)){
                ocrRenderCache.delete(pageNum);
                continue;
            }
            const rect = el.getBoundingClientRect();
            const origW = (ocr && ocr.original_size && ocr.original_size.width) ? ocr.original_size.width : (el.naturalWidth || rect.width || 1);
            const displayScale = rect.width / (origW || 1);
            const totalScale = downFactor * displayScale;
            // Iterate existing overlays by index mapping
            const $parent = $(el).parent();
            // If overlays missing or count mismatched we fall back to full re-render
            const existing = $parent.find(`.recognized-text[data-ocr-page='${pageNum}']`);
            if(!existing.length){
                // Re-render fully (non-blocking) to restore boxes
                processPage(ocr, downFactor, el, pageNum); // fire & forget
                continue;
            }
            for(const box of ocr.boxes){
                const idx = box.__idx;
                if(idx == null) continue;
                const $box = existing.filter(`[data-ocr-idx='${idx}']`);
                if(!$box.length) continue;
                let x = box.box[0][0];
                let y = box.box[0][1];
                let w = box.box[2][0] - x;
                let h = box.box[2][1] - y;
                x *= totalScale;
                y *= totalScale;
                w *= totalScale;
                h *= totalScale;
                $box.css({ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
            }
        }
    }catch(e){ console.warn("refreshOCRPositions failed", e); }
}

export const scheduleRefreshOCRPositions = debounce(()=>refreshOCRPositions(), 60);

// Track in-flight renders so we can cancel when leaving a page
const renderControllers = new Map(); // pageNum -> { canceled: boolean }
export const cancelPageRender = (pageNum) => {
    const ctrl = renderControllers.get(pageNum);
    if(ctrl){ ctrl.canceled = true; }
    try{ $(`.recognized-text[data-ocr-page='${pageNum}']`).remove(); }catch(_e){}
    try{ markRendered(pageNum); }catch(_e){}
    renderControllers.delete(pageNum);
};

const bindElement = async (el, text, bbox, pageNum)=>{
    // Make the OCR box act like a subtitle token container: hover to see translation popup
    const $el = $(el);
    // Ensure styling classes consistent with subtitler widgets
    $el.addClass("subtitle_word_container");
    // Detect vertical text boxes: bbox is [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]
    let isVertical = false;
    try{
        if(Array.isArray(bbox) && bbox.length >= 2){
            const x0 = bbox[0][0], y0 = bbox[0][1];
            const x2 = bbox[2][0], y2 = bbox[2][1];
            const w = Math.abs(x2 - x0);
            const h = Math.abs(y2 - y0);
            isVertical = h > w * 1.2; // heuristic: clearly taller than wide
        }
    }catch(_e){ /* ignore bbox issues */ }
    // Render interactive content inside the box
    // We nest a span so absolute positioned overlay retains correct size for hover area
    const $inner = $('<span class="ocr-word-inner"></span>');
    if(isVertical){
        try{
            $inner.css({
                writingMode: 'vertical-rl',
                textOrientation: 'mixed',
            });
        }catch(_e){ /* ignore */ }
    }
    $el.empty().append($inner);
    // For OCR overlays we avoid subtitler-specific coloring/styling/stars
    if(renderControllers.get(pageNum)?.canceled) return; // abort early
    try{
        await attachInteractiveText($inner, text, {
            disableColor: true,
            disableFrequency: true,
            disableThemeClasses: true,
            forceHoverHorizontal: true,
            disablePitchAccent: true,
            isOCR: true
        });
    }catch(e){
        console.error("attachInteractiveText failed for OCR box", e);
        // Proceed without interactive hover to avoid blocking the queue
        $inner.text(text);
    }
    // Fit the rendered text using canvas measurement (no DOM style tweaks)
    try{
        const innerNode = $inner.get(0);
        if(!innerNode) return;
        const contW = Math.max(1, $el.innerWidth());
        const contH = Math.max(1, $el.innerHeight());

        // Build canvas context once
        const canvas = bindElement.__measureCanvas || (bindElement.__measureCanvas = document.createElement('canvas'));
        const ctx = canvas.getContext('2d');
        const cs = window.getComputedStyle(innerNode);
        const fontFamily = cs.fontFamily || 'sans-serif';
        const fontWeight = cs.fontWeight || '400';
        const fontStyle = cs.fontStyle || 'normal';
        const basePx = 100; // measure at 100px then scale
        ctx.font = `${fontStyle} ${fontWeight} ${basePx}px ${fontFamily}`;

        const estimateLineHeight = () => {
            const m = ctx.measureText('Mg');
            const h = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
            return h > 0 ? h : basePx * 1.1;
        };
        const lineH = estimateLineHeight();

        const textStr = typeof text === 'string' ? text : (text?.toString?.() || '');

        function measureHorizontal(str){
            // Treat as single line for sizing; DOM can still wrap if smaller
            const m = ctx.measureText(str);
            const reqW = m.width; // measured at basePx
            const reqH = lineH;   // single-line height at basePx
            return { reqW, reqH };
        }

        function measureVertical(str){
            // Stack characters vertically: width = max char width, height = chars * lineH
            let maxW = 0;
            let count = 0;
            for(const ch of str){
                maxW = Math.max(maxW, ctx.measureText(ch).width);
                count++;
            }
            const reqW = maxW; // measured at basePx
            const reqH = count * lineH;
            return { reqW, reqH };
        }

        const { reqW, reqH } = isVertical ? measureVertical(textStr) : measureHorizontal(textStr);
        // Scale from basePx to fit container
        const scaleW = contW / Math.max(1, reqW);
        const scaleH = contH / Math.max(1, reqH);
        let target = Math.floor(basePx * Math.max(0.1, Math.min(scaleW, scaleH)));
        // Clamp to sensible range
        target = Math.max(6, Math.min(96, target));
        if(!renderControllers.get(pageNum)?.canceled){
            $inner.css('font-size', `${target}px`);
        }
    }catch(_e){ /* best-effort fitting only */ }
    // Pills are included inside each word's hover as in subtitler.js; no external pill bar here.
};

const processPage = async (ocr, scaleFactor, el, num)=> {
    // Prepare controller for this page and clear previous overlays
    renderControllers.set(num, { canceled: false });
    try{ $(`.recognized-text[data-ocr-page='${num}']`).remove(); }catch(_e){}
    try{
        if(num !== (Math.floor(getCurrentIndex()/2)*2) && num !== (Math.floor(getCurrentIndex()/2)*2 + 1)){
            // This page is no longer in view; signal completion so the queue doesn't wait forever
            return;
        }
        console.log(ocr,scaleFactor,el);
        const rect = el.getBoundingClientRect();
        const origW = (ocr && ocr.original_size && ocr.original_size.width) ? ocr.original_size.width : (el.naturalWidth || rect.width || 1);
        const displayScale = rect.width / (origW || 1); // map original pixels -> CSS pixels
        const totalScale = scaleFactor * displayScale; // (original/sent) * (displayed/original) = displayed/sent
        $(el).parent().find(".recognized-text").remove();

        let boxIndex = 0;
        for(const box of ocr.boxes){
            if(renderControllers.get(num)?.canceled) break;
            let x = box.box[0][0];
            let y = box.box[0][1];
            let w = box.box[2][0] - x;
            let h = box.box[2][1] - y;
            x *= totalScale;
            y *= totalScale;
            w *= totalScale;
            h *= totalScale;

            const text = box.text;
            // Tag each overlay with stable index to support refresh recalculation
            box.__idx = boxIndex;
            const txEl = $(`<div class="recognized-text ${settings.devMode ? 'debug-highlight' : ''}" data-ocr-page='${num}' data-ocr-idx='${boxIndex}' style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
            // Append immediately so the page looks responsive; enhance asynchronously
            $(el).parent().append(txEl);
            if(renderControllers.get(num)?.canceled){ break; }
            (async () => {
                try{
                    await bindElement(txEl,text, box.box, num);
                }catch(e){
                    console.error("bindElement failed for OCR box", e);
                    try{ txEl.text(text); }catch(_e){}
                }
            })();
            boxIndex++;
        }
    }catch(e){
        console.error("processPage failed", e);
    }finally{
        // Signal that page overlays finished rendering (even on error/early return)
        if(!renderControllers.get(num)?.canceled){
            try{ markRendered(num); }catch(_e){}
        }
        renderControllers.delete(num);
    }
}

export const readPage = async (pageNum, el) => {
    // Cancel any in-flight other pages when switching
    for(const [n, ctrl] of renderControllers.entries()){
        if(n !== pageNum && !ctrl.canceled){ cancelPageRender(n); }
    }
    const pages = getPages();
    const thisPage = pages[pageNum];
    let resp = await sendToReader(thisPage, pageNum);
    // Attach and/or display client-side scale info for correct box rendering
    // resp.client_scale is the factor applied to the original (<=1). To map boxes returned
    // for the sent image to the original rendered page, multiply by 1/resp.client_scale.
    if (resp && typeof resp.client_scale === 'number' && el){
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
        // Cache context then render
        ocrRenderCache.set(pageNum, { ocr: resp, downFactor, el });
        processPage(resp, downFactor, el, pageNum); // intentionally not awaited
    } else {
        // If we can't render (missing element or scaling), don't block the dispatcher
        try{ markRendered(pageNum); }catch(_e){}
    }
}