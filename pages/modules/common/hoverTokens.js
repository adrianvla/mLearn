// Shared hoverable token rendering used by subtitler and OCR overlays
// This mirrors the behavior in subtitler.js for per-word hovers, translations, pills, and (optional) flashcards.

import {settings, TRANSLATABLE, wordFreq} from "../settings/settings.js";
import {getCards, getTranslation, sendRawToAnki, tokenise} from "../networking.js";
import {blurWord, isNotAllKana, randomUUID, screenshotVideo, toUniqueIdentifier} from "../utils.js";
import {makeFlashcard} from "../flashcards/anki.js";
import {addPills, resetWordUUIDs} from "../subtitler/pillHtml.js";
import {changeKnownStatus, getKnownStatus, WORD_STATUS_KNOWN} from "../stats/saving.js";
import {trackWordAppearance} from "../flashcards/storage.js";

// Lightweight state containers (kept local to each render to avoid global collisions)
function createLocalState() {
    return {
        hoveredIds: {},
        already_added: {},
        flashcardFunctions: {},
        processingDB: {},
        hasBeenLoadedDB: {},
    };
}

// Preloaded translation cache so that attachInteractiveText can wait for getTranslation calls to finish.
// Key: word (actual_word); Value: translation_data returned by getTranslation.
const translationPreloadCache = {};

// Tokenisation cache with promise de-duplication to prevent storm of requests
// Key: raw text string -> { tokens, ts }
const tokeniseResultCache = new Map();
// In-flight promises to collapse concurrent requests
const tokeniseInFlight = new Map();
const TOKENISE_MAX_CACHE = 1000; // simple LRU trim threshold

function cachedTokenise(text){
    if(typeof text !== 'string' || !text.trim()){
        return Promise.resolve([{actual_word: text, word: text, type: '名詞'}]);
    }
    const key = text;
    if(tokeniseResultCache.has(key)){
        return Promise.resolve(tokeniseResultCache.get(key).tokens);
    }
    if(tokeniseInFlight.has(key)) return tokeniseInFlight.get(key);
    const p = (async ()=>{
        try{
            const tokens = await tokenise(key);
            // Basic LRU: if beyond threshold, delete oldest (FIFO order of Map iteration)
            tokeniseResultCache.set(key, { tokens, ts: Date.now() });
            if(tokeniseResultCache.size > TOKENISE_MAX_CACHE){
                const firstKey = tokeniseResultCache.keys().next().value;
                if(firstKey) tokeniseResultCache.delete(firstKey);
            }
            return tokens;
        }catch(e){
            return [{actual_word: key, word: key, type: '名詞'}];
        }finally{
            tokeniseInFlight.delete(key);
        }
    })();
    tokeniseInFlight.set(key, p);
    return p;
}

export function warmTokeniseCache(texts){
    try{
        const arr = Array.isArray(texts) ? texts : [texts];
        for(const t of arr){ cachedTokenise(String(t)); }
    }catch(_e){}
}

// --- Simple hover positioning helper ---
// Places hover above anchor by default; flips below if needed; clamps inside viewport horizontally & vertically.
function simplePosition($hover, $anchor){
    try{
        const hoverEl = $hover.get(0);
        const anchorEl = $anchor.get(0);
        if(!hoverEl || !anchorEl) return;
        // Ensure anchor is positioning context
        if(getComputedStyle(anchorEl).position === 'static') anchorEl.style.position = 'relative';
        // Reset dynamic styles
        Object.assign(hoverEl.style, { top: '', bottom: '', left: '', right: '', width: hoverEl.style.width });
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Initial placement attempt: above, centered
        const anchorRect = anchorEl.getBoundingClientRect();
        const hw = hoverEl.offsetWidth || 0;
        const hh = hoverEl.offsetHeight || 0;
        let left = (anchorRect.width - hw)/2; // relative to anchor
        let top = -(hh + 8); // above
        // Apply baseline
        hoverEl.style.left = `${left}px`;
        hoverEl.style.top = `${top}px`;
        // Measure viewport position
        let rect = hoverEl.getBoundingClientRect();
        // Flip below if top overflow
        if(rect.top < 0){
            top = anchorRect.height + 8; // below
            hoverEl.style.top = `${top}px`;
            rect = hoverEl.getBoundingClientRect();
        }
        // Vertical clamp if bottom overflow
        if(rect.bottom > vh){
            const delta = rect.bottom - vh + 4;
            hoverEl.style.top = `${top - delta}px`;
            rect = hoverEl.getBoundingClientRect();
        }
        // Horizontal clamp
        if(rect.left < 4){
            const shift = 4 - rect.left;
            hoverEl.style.left = `${(parseFloat(hoverEl.style.left)||0) + shift}px`;
            rect = hoverEl.getBoundingClientRect();
        } else if(rect.right > vw - 4){
            const shift = rect.right - (vw - 4);
            hoverEl.style.left = `${(parseFloat(hoverEl.style.left)||0) - shift}px`;
            rect = hoverEl.getBoundingClientRect();
        }
        // If still wider than viewport, force max width & center relative to viewport
        if(rect.width > vw - 8){
            hoverEl.style.width = `${vw - 8}px`;
            const nw = hoverEl.getBoundingClientRect().width;
            const centeredViewportLeft = (vw - nw)/2;
            // Translate to anchor-relative left
            const newLeftRel = centeredViewportLeft - anchorRect.left;
            hoverEl.style.left = `${newLeftRel}px`;
        }
    }catch(_e){ /* silent */ }
}

function addFrequencyStars(word){
    if(word in wordFreq){
        let level = wordFreq[word].raw_level;
        let s = `<span class="frequency" level="${level}">`;
        for(let i=0;i<level;i++) s += `<span class="star"></span>`;
        s += `</span>`;
        return s;
    }
    return "";
}

function updateHoverElHTML($hover, h, p){
    const realHTML = `<div class='subtitle_hover_relative'><div class='subtitle_hover_content'>${h}</div>${p}</div>`;
    $hover.html(realHTML);
}

function hoverElState($hover, state, word, pos, isOCR){
    switch(state){
        case "loading":
            $hover.html("Loading...");
            break;
        case "not_found":
            (async ()=>{
                const pills = await addPills(word, pos, false, !!isOCR);
                updateHoverElHTML($hover, "No translation found", pills);
            })();
            break;
    }
}

// Adds furigana on the element using provided reading HTML
function addFuriganaToEl($el, real_word, reading_html, pos){
    let reading_text = reading_html;
    const accent_start = reading_text.indexOf("<!-- accent_start -->");
    if(accent_start !== -1) reading_text = reading_text.substring(0, accent_start);
    if(pos === "動詞"){ // rough verb tail adjust
        if(real_word[real_word.length-1] !== reading_text[reading_text.length-1]){
            reading_text = reading_text.substring(0, reading_text.length - 1);
        }
    }
    let correction = "";
    for(let i = reading_text.length; i < real_word.length; i++) correction += "&nbsp;";
    $el.html(`<ruby>${real_word}<rt>${reading_text}${correction}</rt></ruby>`);
    return reading_text;
}

function addPitchAccentToEl($targetWordEl, accentData, word_in_letters, real_word, pos, look_ahead_token){
    try{
        if(settings.language !== "ja") return;
        if(!accentData || Object.keys(accentData).length === 0) return;
        if(real_word.length <= 1 || word_in_letters.length <= 1) return;
        const accent_type = accentData[2]?.pitches?.[0]?.position;
        if(typeof accent_type !== 'number') return;
        let arr = [];
        const particle_accent = accent_type === 0;
        for(let i = 0; i < word_in_letters.length; i++){
            switch(accent_type){
                case 0: // Heiban
                    arr.push(i !== 0);
                    break;
                case 1: // Atamadaka
                    arr.push(i === 0);
                    break;
                case 2: // Nakadaka (approx)
                    arr.push(i <= 1);
                    break;
                case 3: // Odaka (approx)
                    arr.push(i !== 0);
                    break;
                default:
                    arr.push(i !== 0 && i < accent_type);
            }
        }

        let html_string = "";
        for(let i = 0; i < word_in_letters.length; i++){
            const b = !arr[i];
            const t = arr[i];
            const l = i >= 1 ? arr[i-1] !== arr[i] : false;
            let classString = "box";
            if(b) classString += " bottom";
            if(t) classString += " top";
            if(l) classString += " left";
            html_string += `<div class="${classString}"></div>`;
        }
        if(!(pos === "動詞" && look_ahead_token === "動詞")){
            const b = !particle_accent;
            const t = particle_accent;
            const l = arr[word_in_letters.length-1] !== particle_accent;
            let classString = "box particle-box";
            if(b) classString += " bottom";
            if(t) classString += " top";
            if(l) classString += " left";
            html_string += `<div class="${classString}" style="margin-right:${-100/word_in_letters.length}%;"></div>`;
        }
        for(let i = word_in_letters.length; i < real_word.length; i++) html_string += `<div class="box"></div>`;

        const $accentEl = $('<div class="mLearn-pitch-accent"></div>').html(html_string);
        if(isNotAllKana(real_word)){
            const $ruby = $targetWordEl.find('ruby');
            if($ruby.length){
                const $rt = $ruby.find('rt');
                if($rt.length){
                    $rt.append($accentEl);
                }
            }
        }else{
            $targetWordEl.append($accentEl);
            $targetWordEl.css("--pitch-accent-height", "5px");
        }
    }catch(_e){ /* best effort */ }
}

async function buildHoverForWord(word, real_word, pos, look_ahead_pos, state, $wordEl, $hoverEl, opts = {}){
    const { disablePitchAccent = false, isOCR = false } = opts || {};
    const uuid = $wordEl.data('uuid');
    const $hover = $hoverEl;

    // lazy-load on first hover
    if(state.processingDB[uuid] || state.hasBeenLoadedDB[uuid]) return;
    state.processingDB[uuid] = true;

    // Use preloaded translation if available, otherwise fetch now (and cache).
    let translation_data = translationPreloadCache[word];
    if(!translation_data){
        try{ translation_data = await getTranslation(word); translationPreloadCache[word] = translation_data; }
        catch(_e){ translation_data = { data: [] }; }
    }
    let hoverEl_html = "";
    // Always include pills in hover like subtitler.js; add Anki button only if enabled
    let pill_html = await addPills(word, pos, !!settings.enable_flashcard_creation, isOCR);
    let raw_flashcard_data = {example:"", front:word, pitch:"", definitions:"", image:""};

    translation_data.data.forEach((meaning)=>{
        const reading_html = meaning.reading;
        const translation_html = meaning.definitions;
        if(translation_html) hoverEl_html += `<div class="hover_translation">${translation_html}</div>`;
        if(reading_html) hoverEl_html += `<div class="hover_reading">${reading_html}</div>`;
        if(translation_html) raw_flashcard_data.definitions += `<p>${translation_html}</p>`;
        if(reading_html) raw_flashcard_data.definitions += `<p>${reading_html}</p>`;
    });

    state.hasBeenLoadedDB[uuid] = true;
    if(translation_data.data.length === 0){
    hoverElState($hover, "not_found", word, pos, isOCR);
        state.processingDB[uuid] = false;
        return;
    }
    updateHoverElHTML($hover, hoverEl_html, pill_html);

    if(settings.enable_flashcard_creation && !state.already_added[word]){
        const encodedWord = await toUniqueIdentifier(word);
        state.flashcardFunctions[encodedWord] = async ()=>{
            // Capture example sentence as HTML snapshot of words around this hoverable element if available
            const $iframe = $("iframe");
            try{
                $iframe[0].contentWindow.document.body.innerHTML = $wordEl.closest('body').find('.subtitles').html() || real_word;
                $iframe.contents().find(".subtitle_hover").remove();
                $iframe.contents().find(`.subtitle_word.word_${uuid}`).addClass("defined");
                raw_flashcard_data.example = $iframe[0].contentWindow.document.body.innerHTML;
                $iframe[0].contentWindow.document.body.innerHTML = "";
            }catch(_e){ raw_flashcard_data.example = real_word; }
            raw_flashcard_data.image = screenshotVideo();

            let card_creation_data = makeFlashcard(raw_flashcard_data, word, "", raw_flashcard_data.definitions, true);
            let response = await sendRawToAnki({"action":"addNote","version":6,"params":card_creation_data});
            if(!response.error){ state.already_added[word] = true; }
        };
        // Regenerate pills to ensure Anki button presence (already true since enable is on)
    pill_html = await addPills(word, pos, true, isOCR);
        updateHoverElHTML($hover, hoverEl_html, pill_html);
    }

    // Optional immediate pitch accent
    if(settings.showPitchAccent && !disablePitchAccent){
        try{
            const reading = translation_data.data[0]?.reading || real_word;
            addPitchAccentToEl($wordEl, translation_data.data[2], reading, real_word, pos, look_ahead_pos);
        }catch(_e){}
    }

    // Initial simple positioning after content build
    requestAnimationFrame(()=> simplePosition($hover, $wordEl));
    // Re-check whenever hovering over the hover itself (user moves into panel)
    $hover.on('mouseenter', ()=> simplePosition($hover, $wordEl));
    // (Optional) quick second pass after 60ms for late layout changes
    setTimeout(()=> simplePosition($hover, $wordEl), 60);

    state.processingDB[uuid] = false;
}

export async function attachInteractiveText($container, text, options = {}){
    const {
        disableColor = false,
        disableFrequency = false,
        disableThemeClasses = false,
        forceHoverHorizontal = false,
        disablePitchAccent = false,
        isOCR = false,
    } = options || {};
    // Render interactive tokens into provided jQuery container
    if(!$container || $container.length === 0) return;
    $container.empty();

    // tokenise string (await tokenizer readiness)
    let tokens;
    try{ tokens = await cachedTokenise(text); }catch(_e){ tokens = [{actual_word: text, word: text, type: '名詞'}]; }

    // Preload translations for all translatable tokens before proceeding so caller waits until ready.
    try {
        const toPrefetch = [];
        const seen = new Set();
        for(const t of tokens){
            if(!t || !t.actual_word) continue;
            if(!TRANSLATABLE.includes(t.type)) continue;
            if(seen.has(t.actual_word)) continue;
            seen.add(t.actual_word);
            if(!translationPreloadCache[t.actual_word]){
                toPrefetch.push(
                    getTranslation(t.actual_word)
                        .then(data => { translationPreloadCache[t.actual_word] = data; })
                        .catch(()=>{ translationPreloadCache[t.actual_word] = { data: [] }; })
                );
            }
        }
        if(toPrefetch.length) await Promise.all(toPrefetch);
    } catch(_e){ /* best effort prefetch */ }

    const state = createLocalState();
    try{ resetWordUUIDs(); }catch(_e){}

    for(let i = 0; i < tokens.length; i++){
        const token = tokens[i];
        const look_ahead_token = (i < tokens.length - 1) ? tokens[i+1].type : null;
        const word = token.actual_word;
        const real_word = token.word;
        const pos = token.type;
        const uuid = randomUUID();
        const $wordEl = $(`<span class="subtitle_word word_${uuid}">${real_word}</span>`);
        $wordEl.attr("grammar", pos);
        $wordEl.attr("data-uuid", uuid);
        if(!disableColor){
            if(settings.do_colour_codes && settings.colour_codes[pos]){
                $wordEl.css("color", settings.colour_codes[pos]);
            }
        }
        const themeClass = disableThemeClasses ? '' : (settings.dark_mode ? 'dark' : '');
        const $hoverEl = $(`<div class="subtitle_hover hover_${uuid} ${themeClass}"></div>`);
        if(forceHoverHorizontal){
            try{ $hoverEl.css({ writingMode: 'horizontal-tb', textOrientation: 'mixed' }); }catch(_e){}
        }
        updateHoverElHTML($hoverEl, "", "");
        let card_data = {};
        if(TRANSLATABLE.includes(pos)){
            let showDetails = false;
            if(settings.use_anki){
                try{ card_data = await getCards(word); }catch(_e){ card_data.poor = true; }
            }else{ card_data.poor = true; }
            const isWordKnown = (await getKnownStatus(word)) === WORD_STATUS_KNOWN;
            if(card_data.poor){
                $wordEl.attr("known", isWordKnown ? "true" : "false");
                trackWordAppearance(word);
                $wordEl.addClass("has-hover").append($hoverEl);
                hoverElState($hoverEl, "loading", word, pos, isOCR);
                state.hasBeenLoadedDB[uuid] = false;
                state.processingDB[uuid] = false;
                const delayHide = () => setTimeout(()=>{
                    const h = $hoverEl.get(0), w = $wordEl.get(0);
                    if(!h || !w) return;
                    if(!h.matches(':hover') && !w.matches(':hover')) $hoverEl.removeClass('show-hover');
                }, 300);
                $wordEl.hover(()=>{
                    $hoverEl.addClass('show-hover');
                    buildHoverForWord(word, real_word, pos, look_ahead_token, state, $wordEl, $hoverEl, { disablePitchAccent, isOCR });
                    requestAnimationFrame(()=> simplePosition($hoverEl, $wordEl));
                }, ()=>{ delayHide(); });
            }else{
                const current_card = card_data.cards?.[0];
                if(current_card && current_card.factor < settings.known_ease_threshold && isWordKnown){
                    showDetails = true;
                    // Treat as unknown and show translation
                    $wordEl.addClass("has-hover").append($hoverEl);
                    $wordEl.attr("known","false");
                    hoverElState($hoverEl, "loading", word, pos, isOCR);
                    $wordEl.hover(()=>{
                        $hoverEl.addClass('show-hover');
                        buildHoverForWord(word, real_word, pos, look_ahead_token, state, $wordEl, $hoverEl, { disablePitchAccent, isOCR });
                        requestAnimationFrame(()=> simplePosition($hoverEl, $wordEl));
                    }, ()=>{ $hoverEl.removeClass('show-hover'); });
                }else{
                    $wordEl.attr("known","true");
                    changeKnownStatus(word, WORD_STATUS_KNOWN);
                    blurWord($wordEl);
                    if(settings.hover_known_get_from_dictionary){
                        $wordEl.addClass("has-hover").append($hoverEl);
                        $wordEl.hover(()=>{
                            $hoverEl.addClass('show-hover');
                            buildHoverForWord(word, real_word, pos, look_ahead_token, state, $wordEl, $hoverEl, { disablePitchAccent, isOCR });
                            requestAnimationFrame(()=> simplePosition($hoverEl, $wordEl));
                        }, ()=>{ $hoverEl.removeClass('show-hover'); });
                    }
                }
            }
        }
        if(!disableFrequency){ $wordEl.append($(addFrequencyStars(word))); }
        $container.append($wordEl);
    }
}
