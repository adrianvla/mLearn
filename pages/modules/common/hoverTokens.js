// Shared hoverable token rendering used by subtitler and OCR overlays
// This mirrors the behavior in subtitler.js for per-word hovers, translations, pills, and (optional) flashcards.

import {settings, TRANSLATABLE, wordFreq} from "../settings/settings.js";
import {getCards, getTranslation, sendRawToAnki, tokenise} from "../networking.js";
import {blurWord, isNotAllKana, randomUUID, screenshotVideo, toUniqueIdentifier} from "../utils.js";
import {addTranslationCard} from "../subtitler/liveWordTranslator.js";
import {makeFlashcard} from "../flashcards/anki.js";
import {addPills, resetWordUUIDs} from "../subtitler/pillHtml.js";
import {changeKnownStatus, getKnownStatus, WORD_STATUS_KNOWN} from "../stats/saving.js";
import {attemptFlashcardCreation, trackWordAppearance} from "../flashcards/storage.js";

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

function hoverElState($hover, state, word, pos){
    switch(state){
        case "loading":
            $hover.html("Loading...");
            break;
        case "not_found":
            (async ()=>{
                const pills = await addPills(word, pos);
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
    const { disablePitchAccent = false } = opts || {};
    const uuid = $wordEl.data('uuid');
    const $hover = $hoverEl;

    // lazy-load on first hover
    if(state.processingDB[uuid] || state.hasBeenLoadedDB[uuid]) return;
    state.processingDB[uuid] = true;

    let translation_data = await getTranslation(word);
    let hoverEl_html = "";
    // Always include pills in hover like subtitler.js; add Anki button only if enabled
    let pill_html = await addPills(word, pos, !!settings.enable_flashcard_creation);
    let raw_flashcard_data = {example:"", front:word, pitch:"", definitions:"", image:""};

    translation_data.data.forEach((meaning)=>{
        const reading_html = meaning.reading;
        const translation_html = meaning.definitions;
        hoverEl_html += `<div class="hover_translation">${translation_html}</div>`;
        hoverEl_html += `<div class="hover_reading">${reading_html}</div>`;
        raw_flashcard_data.definitions += `<p>${translation_html}</p>`;
        raw_flashcard_data.definitions += `<p>${reading_html}</p>`;
    });

    state.hasBeenLoadedDB[uuid] = true;
    if(translation_data.data.length === 0){
        hoverElState($hover, "not_found", word, pos);
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
        pill_html = await addPills(word, pos, true);
        updateHoverElHTML($hover, hoverEl_html, pill_html);
    }

    // Optional immediate pitch accent
    if(settings.showPitchAccent && !disablePitchAccent){
        try{
            const reading = translation_data.data[0]?.reading || real_word;
            addPitchAccentToEl($wordEl, translation_data.data[2], reading, real_word, pos, look_ahead_pos);
        }catch(_e){}
    }

    // layout sizing once content ready
    $hover.ready(()=>{
        let calcW = $hover.find(".footer").width() + 26;
        if(!Number.isFinite(calcW) || calcW < 250) calcW = 600;
        $hover.css("width", `${calcW}px`);
        const $w = $wordEl;
        let hover_left = -(calcW - $w.width())/2;
        $hover.css("left", `${hover_left}px`);
    });

    state.processingDB[uuid] = false;
}

export async function attachInteractiveText($container, text, options = {}){
    const {
        disableColor = false,
        disableFrequency = false,
        disableThemeClasses = false,
        forceHoverHorizontal = false,
        disablePitchAccent = false,
    } = options || {};
    // Render interactive tokens into provided jQuery container
    if(!$container || $container.length === 0) return;
    $container.empty();

    // tokenise string
    let tokens;
    try{ tokens = await tokenise(text); }catch(_e){ tokens = [{actual_word: text, word: text, type: '名詞'}]; }

    const state = createLocalState();
    // Optional reset for pills ID mapping
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
        // POS coloring
        if(!disableColor){
            if(settings.do_colour_codes && settings.colour_codes[pos]){
                $wordEl.css("color", settings.colour_codes[pos]);
            }
        }

        // Hover container
    const themeClass = disableThemeClasses ? '' : (settings.dark_mode ? 'dark' : '');
    const $hoverEl = $(`<div class="subtitle_hover hover_${uuid} ${themeClass}"></div>`);
        if(forceHoverHorizontal){
            try{
                $hoverEl.css({ writingMode: 'horizontal-tb', textOrientation: 'mixed' });
            }catch(_e){ /* ignore */ }
        }
        updateHoverElHTML($hoverEl, "", "");

        // Determine known/Anki and behavior similar to subtitler
        let card_data = {};
        let showDetails = false;
        if(TRANSLATABLE.includes(pos)){
            if(settings.use_anki){
                try{ card_data = await getCards(word); }catch(_e){ card_data.poor = true; }
            }else{
                card_data.poor = true;
            }
            const isWordKnown = (await getKnownStatus(word)) === WORD_STATUS_KNOWN;
            if(card_data.poor){
                showDetails = true;
                $wordEl.attr("known", isWordKnown ? "true" : "false");
                trackWordAppearance(word);
                // lazy hover fetch
                $wordEl.addClass("has-hover").append($hoverEl);
                hoverElState($hoverEl, "loading", word, pos);
                state.hasBeenLoadedDB[uuid] = false;
                state.processingDB[uuid] = false;
                const delayHide = () => setTimeout(()=>{
                    const h = $hoverEl.get(0), w = $wordEl.get(0);
                    if(!h || !w) return;
                    if(!h.matches(':hover') && !w.matches(':hover')) $hoverEl.removeClass('show-hover');
                }, 300);
                $wordEl.hover(()=>{
                    $hoverEl.addClass('show-hover');
                    buildHoverForWord(word, real_word, pos, look_ahead_token, state, $wordEl, $hoverEl, { disablePitchAccent });
                }, ()=>{ delayHide(); });
            }else{
                const current_card = card_data.cards?.[0];
                if(current_card && current_card.factor < settings.known_ease_threshold && isWordKnown){
                    showDetails = true;
                    // Treat as unknown and show translation
                    $wordEl.addClass("has-hover").append($hoverEl);
                    $wordEl.attr("known","false");
                    hoverElState($hoverEl, "loading", word, pos);
                    $wordEl.hover(()=>{
                        $hoverEl.addClass('show-hover');
                        buildHoverForWord(word, real_word, pos, look_ahead_token, state, $wordEl, $hoverEl, { disablePitchAccent });
                    }, ()=>{ $hoverEl.removeClass('show-hover'); });
                }else{
                    $wordEl.attr("known","true");
                    changeKnownStatus(word, WORD_STATUS_KNOWN);
                    blurWord($wordEl);
                    if(settings.hover_known_get_from_dictionary){
                        $wordEl.addClass("has-hover").append($hoverEl);
                        $wordEl.hover(()=>{
                            $hoverEl.addClass('show-hover');
                            buildHoverForWord(word, real_word, pos, look_ahead_token, state, $wordEl, $hoverEl, { disablePitchAccent });
                        }, ()=>{ $hoverEl.removeClass('show-hover'); });
                    }
                }
            }
        }

        // frequency stars and append
        if(!disableFrequency){
            $wordEl.append($(addFrequencyStars(word)));
        }
        $container.append($wordEl);
    }
}
