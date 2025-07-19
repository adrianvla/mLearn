import {saveSettings, settings, TRANSLATABLE, wordFreq} from "./settings.js";
import {getCards, getTranslation, sendRawToAnki, tokenise} from "./networking.js";
import {blurWord, isNotAllKana, randomUUID, screenshotVideo, toUniqueIdentifier} from "./utils.js";
import $ from '../jquery.min.js'
import {findCurrentSub, findSub, lastIndex} from "./subUtils.js";
import {playPauseButton, progressBar, video} from "./elements.js";
import {addToRecentlyWatched} from "./recentlyWatched.js";
import {currentPlayingVideo} from "./streaming.js";
import {addTranslationCard} from "./liveWordTranslator.js";
import {makeFlashcard} from "./flashcards.js";
import {addPills, resetWordUUIDs} from "./pillHtml.js";
import {changeKnownStatus, getKnownStatus} from "./saving.js";
import {isWatchTogether} from "./watchTogether.js";




let already_added = {};
let last_lastIndex = 0;
let createFlashcardWindow = null;
let wordList = [];

let flashcardFunctions = {};
let hoveredIds = {};
let hoveredWordsCount = 0;
let hoveredWords = {};
let subs = null;
let lastSub = null;
let hasReachedHalfPoint = false;

const setSubs = (newSubs) => {
    subs = newSubs;
    console.log("Subtitles set:", subs);
}
const updateVideo = async (time) => {
    if(subs == null) return;
    let currentSub = findCurrentSub(time);
    if (!currentSub){
        $(".subtitles").addClass("not-shown");
        return;
    }
    if (currentSub === lastSub) return;
    $(".subtitles").html("");
    await modify_sub(currentSub.text);
    lastSub = currentSub;
};
const videoTimeUpdateCallback = () => {
    updateVideo(video.currentTime+settings.subsOffsetTime);
    const progress = (video.currentTime / video.duration) * 1000;
    progressBar.value = progress;
    if((video.currentTime / video.duration)==1){
        playPauseButton.innerHTML = '<img src="assets/icons/play.svg">';
    }
    $(".total-time").text(new Date(video.duration * 1000).toISOString().substr(11, 8));
    $(".current-time").text(new Date(video.currentTime * 1000).toISOString().substr(11, 8));
    if (!hasReachedHalfPoint && video.currentTime >= 10) {
        addToRecentlyWatched(currentPlayingVideo);
        hasReachedHalfPoint = true;
    }
};


video.addEventListener('timeupdate',videoTimeUpdateCallback);
const resetHoveredWordsCount = () => {
    hoveredWordsCount = 0;
    hoveredWords = {};
    $(".stats-c").addClass("hide");
};

const hoveredWordTracker = (word,uuid) => {
    if(hoveredIds[uuid]) return;
    hoveredIds[uuid] = true;
    hoveredWordsCount++;
    if(hoveredWords[word])
        hoveredWords[word]++;
    else
        hoveredWords[word] = 1;
};
function setHoveredWordsCount(count) {
    hoveredWordsCount = count;
}

const modify_sub = async (subtitle) => {
    //console log lastIndex in big blue font
    console.log("%c"+lastIndex,"font-size: 20px; color: blue;");
    console.log("%cDO NOT PASTE ANYTHING IN THIS CONSOLE IF YOU DON'T KNOW WHAT YOU'RE DOING; IF SOMEBODY ASKED YOU TO DO IT, THERE'S A 100% CHANCE YOU'RE GETTING SCAMMED","font-size: 20px; color: red;");
    //only once
    if(last_lastIndex == lastIndex) return;
    last_lastIndex = lastIndex;

    // get the text of the subtitle
    $(".subtitles").addClass("quick-transition");
    $(".subtitles").addClass("not-shown");
    //remove any HTML from the subtitle
    subtitle = subtitle.replace(/(<([^>]+)>)/gi, "");

    let toAddToWordList = [];


    let tokens = await tokenise(subtitle);
    console.log(tokens);

    hoveredIds = {};
    resetWordUUIDs();
    //create spans
    let show_subtitle = false;

    const addFrequencyStars = (word) => {
        if(word in wordFreq){
            let level = wordFreq[word].raw_level;
            let s = `<span class="frequency" level="${level}">`;
            for(let i=0;i<level;i++){
                s += `<span class="star"></span>`;
            }
            s += `</span>`;
            return s;
        }
        return "";
    };
    const processToken = async (token, look_ahead_token) => {
        let word = token.actual_word;
        let pos = token.type;
        let real_word = token.word;
        let uuid = randomUUID();
        let newEl = $(`<span class="subtitle_word word_${uuid}">${real_word}</span>`);
        let hoverEl = $(`<div class="subtitle_hover hover_${uuid} ${settings.dark_mode ? 'dark' : ''}"></div>`);
        let hoverEl_html = "";
        let pill_html = "";
        let doAppend = false;
        let doAppendHoverLazy = false;
        let hasFurigana = false;

        const cardNotFound = async () => {
            let $word = newEl;
            if(!(settings.immediateFetch || settings.openAside)) {
                $word.append($(`${real_word}`));
                return;
            }
            let translation_data = await getTranslation(word);
            console.log("Translation data for word: "+word, translation_data);
            if(translation_data.data.length == 0) return;
            if(settings.openAside){
                //force fetch the word from the dictionary
                doAppend = true;
                const first_meaning = translation_data.data[0];
                addTranslationCard(first_meaning.definitions, first_meaning.reading);
            }
            if(settings.immediateFetch || settings.openAside){
                //translate the word + put in cache
                if(pos === "動詞") {
                    let temp_translation_data = await getTranslation(real_word);
                    if( temp_translation_data.data.length > 0) translation_data = temp_translation_data;
                    //fix the reading if it's a verb
                    let rd = translation_data.data[0].reading;
                    if(real_word[real_word.length-1] !== rd[rd.length - 1] && real_word.length == rd.length){
                        rd = rd.substring(0, rd.length - 1) + real_word[real_word.length-1];
                        translation_data.data[0].reading = rd;
                    }
                    // console.log("%ctranslation then: "+real_word, "color: red; font-weight: bold;", translation_data);
                }
                if (settings.furigana && isNotAllKana(real_word)){
                    $word.contents().filter(function() {
                        return this.nodeType === 3;
                    }).remove();
                    // console.log("%ctranslation now: "+word, "color: red; font-weight: bold;", translation_data);
                    if($word.is(".has-hover")){
                        let rd = translation_data.data[0].reading;
                        for(let i = translation_data.data[0].reading.length; i < real_word.length; i++){
                            rd += "&nbsp;";
                        }
                        $word.append($(`<ruby>${real_word}<rt>${rd}</rt></ruby>`));
                    }else{
                        let rd = translation_data.data[0].reading;
                        for(let i = translation_data.data[0].reading.length; i < real_word.length; i++){
                            rd += "&nbsp;";
                        }
                        $word.html(`<ruby>${real_word}<rt>${rd}</rt></ruby>`);
                    }
                }
                if(settings.showPitchAccent) {
                    // if(pos === "動詞") translation_data = await getTranslation(real_word);
                    addPitchAccent(translation_data.data[2], translation_data.data[0].reading); //dict form and conjugated form got the same length in the tokenizer
                }
            }
        };
        const addFurigana = (reading_html) => {
            let reading_text = reading_html;
            // remove when see <!-- accent_start -->
            let accent_start = reading_text.indexOf("<!-- accent_start -->");
            if(accent_start != -1){
                reading_text = reading_text.substring(0,accent_start);
            }

            if(pos === "動詞"){
                if(real_word[real_word.length-1] != reading_text[reading_text.length-1]){
                    reading_text = reading_text.substring(0,reading_text.length-1);
                }
            }
            console.log(`%c reading_html.length: ${reading_html.length} real_word.length: ${real_word.length} reading_text.length: ${reading_text.length}`, "color: blue; font-weight: bold;");
            let correction = "";
            for(let i = reading_text.length; i < real_word.length; i++){
                correction += "&nbsp;";
            }
            newEl.html(`<ruby>${real_word}<rt>${reading_text}${correction}</rt></ruby>`);
            hasFurigana = true;
            return reading_text;
        };
        const addPitchAccent = (accent, word_in_letters) => {
            //append to newEl inside an element
            if(settings.language !== "ja") return; //only for japanese
            if(accent === {}) return;
            if(real_word.length <= 1 || word_in_letters.length <= 1) return; //no pitch accent for single letters
            // if(settings.lang )
            let el = $('<div class="mLearn-pitch-accent"></div>');//we'll draw everything after
            let accent_type = accent[2].pitches[0].position;
            // 0: Heiban (平板) - Flat, ↓↑↑↑↑(↑)
            // 1: Atamadaka (頭高) - ↑↓↓↓↓↓↓↓(↓)
            // 2: Nakadaka (中高) - ↓↑↓↓↓↓↓↓(↓)
            // 3: Odaka (尾高) - ↓↑↑↑↑(↓)
            // >=4: drop after accent_type mora
            let arr = [];
            let particle_accent = accent_type === 0;
            for(let i = 0;i<word_in_letters.length;i++){
                switch(accent_type){
                    case 0: // Heiban (平板)
                        arr.push(i!==0);
                        break;
                    case 1: // Atamadaka (頭高)
                        arr.push(i===0);
                        break;
                    case 2: // Nakadaka (中高)
                        arr.push(i===1);
                        break;
                    case 3: // Odaka (尾高)
                        arr.push(i!==0);
                        break;
                    default: //drop after accent_type mora
                        arr.push(i !== 0 && i < accent_type);
                        break;
                }
            }

            let html_string = "";

            for(let i = 0; i < word_in_letters.length; i++){
                //just make elements with the pitch accent, those will be divs
                let b = !arr[i];
                let t = arr[i];
                let l = i >= 1 ? arr[i-1] !== arr[i] : false;
                let classString = "box";
                if(b) classString += " bottom";
                if(t) classString += " top";
                if(l) classString += " left";
                html_string += `<div class="${classString}"></div>`;
            }

            if(!(pos === "動詞" && look_ahead_token === "動詞")){
                //if not a verb, add particle accent
                let b = !particle_accent;
                let t = particle_accent;
                let l = arr[word_in_letters.length-1] !== particle_accent;
                let classString = "box particle-box";
                if(b) classString += " bottom";
                if(t) classString += " top";
                if(l) classString += " left";
                html_string += `<div class="${classString}" style="margin-right:${-100/word_in_letters.length}%;"></div>`;
            }
            for(let i = word_in_letters.length; i < real_word.length; i++){
                html_string += `<div class="box"></div>`;
            }
            el.html(html_string);



            if(isNotAllKana(real_word)){
                //there is furigana, so we need to add the pitch accent to the furigana
                //find furigana in newEl
                let furigana = newEl.find("ruby");
                if(furigana.length > 0){
                    //furigana found, add pitch accent to it
                    let furigana_rt = furigana.find("rt");
                    if(furigana_rt.length > 0){
                        furigana_rt.append(el);
                        newEl.css("--pitch-accent-height", "2px");
                    }/*else{
                        console.warn(`No furigana found for word: (W:${word_in_letters}) (R:${real_word}) (L:${look_ahead_token})`);
                    }*/
                }
            }else{
                newEl.append(el);
                newEl.css("--pitch-accent-height", "5px");
            }
            console.log(`%cAdding pitch accent: (W:${word_in_letters}) (A:${accent_type}) (R:${real_word}) (L:${look_ahead_token})`, "color: green; font-weight: bold;");
        }
        const generateTranslationHTML = (translation_html,reading_html) => {
            hoverEl_html += `<div class="hover_translation">${translation_html}</div>`;
            hoverEl_html += `<div class="hover_reading">${reading_html}</div>`;
        };
        const addTranslationToToken = async (current_card) => {
            let translation_html = current_card.fields.Meaning.value;
            let reading_html = current_card.fields.Reading.value;
            generateTranslationHTML(translation_html,reading_html);
            return {translation_html,reading_html};
        }
        const translateWord = async (card_data, current_card) => {
            //translate the word
            let {translation_html,reading_html} = await addTranslationToToken(current_card);
            newEl.attr("known","false");

            wordList.push({word:word, new:false, fetch:false, id: card_data.cards[0].cardId});
            if(settings.openAside) addTranslationCard(translation_html,reading_html);
            //furigana
            let reading = "";
            if(settings.furigana && isNotAllKana(real_word)) reading = addFurigana(reading_html);

            if(settings.immediateFetch || settings.openAside) {
                let translation_data = await getTranslation(word);
                if (settings.showPitchAccent) addPitchAccent(translation_data.data[2], reading);
            }
        };

        const updateHoverElHTML = (h = hoverEl_html, p = pill_html)=>{
            const realHTML = `<div class='subtitle_hover_relative'><div class='subtitle_hover_content'>${h}</div>${p}</div>`;
            hoverEl.html(realHTML);
        };
        const hoverElState = async (state) => {
            switch(state) {
                case "loading":
                    hoverEl.html("Loading...");
                    return;
                case "not_found":
                    // hoverEl.html("No translation found" + await addPills(word,pos));
                    updateHoverElHTML("No translation found", await addPills(word,pos));
                    return;
            }
        };
        const flashcardWindowHTML = (raw_flashcard_data)=>{
            return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <title>New Flashcard - ${word}</title>
    <link rel="stylesheet" href="flashcard_window.css">
</head>
<body class="flashcard-preview-body ${settings.dark_mode ? '':'light'}">
    <div class="createFlashcardContent">
        <h1>Flashcard Preview</h1>
        <button class="createflashcardbtn">Create Flashcard</button>
        <div class="l">
            <label for="show-img">Show Image</label>
            <input type="checkbox" id="show-img" name="show-img" checked>
        </div>
        <div class="card-c ${settings.dark_mode ? '':'light'}">
            <div class="card-item">
                <h1>${raw_flashcard_data.front}</h1>
            </div>
            <div class="card-item">
                <div class="example">
                    <div class="sentence">${raw_flashcard_data.example}</div>
                    <div class="translation">
                        <input type="text" name="" id="" placeholder="Add Translation" spellcheck="false">
                    </div>
                </div>
            </div>
            <div class="divider"></div>
            <div class="card-item">
                <div class="definition" contenteditable="true">
                    ${raw_flashcard_data.definitions}
                </div>
            </div>
            <div class="card-item">
                <img src="${raw_flashcard_data.image}" alt="">
            </div>
        </div>
    </div>
</body>
</html>`};

        const createFlashcardClick = async function(raw_flashcard_data){
            if(already_added[word]) return;
            //calculate actual example sentence by putting it into iframe
            const $iframe = $("iframe");
            $iframe[0].contentWindow.document.body.innerHTML = $(".subtitles").html();
            //remove each .subtitle_hover element
            $iframe.contents().find(".subtitle_hover").remove();
            //remove each .subtitle_word element
            $iframe.contents().find(".subtitle_word.word_"+uuid).addClass("defined");
            raw_flashcard_data.example = $iframe[0].contentWindow.document.body.innerHTML;
            $iframe[0].contentWindow.document.body.innerHTML = "";

            raw_flashcard_data.image = screenshotVideo();

            if(createFlashcardWindow) createFlashcardWindow.close();
            //preview
            createFlashcardWindow = window.open("", "CreateFlashcardWindow", "width=800,height=600");
            createFlashcardWindow.document.write(flashcardWindowHTML(raw_flashcard_data));
            $(createFlashcardWindow.document).ready(()=>{
                //add event listener to the input checkbox
                $("#show-img",createFlashcardWindow.document).change(()=>{
                    $(".card-item img",createFlashcardWindow.document).toggle();
                });
                $('.createflashcardbtn',createFlashcardWindow.document).click(async function(){
                    let card_creation_data = makeFlashcard(raw_flashcard_data, word, $('input',createFlashcardWindow.document).val(), $(".definition",createFlashcardWindow.document).html(), $("#show-img",createFlashcardWindow.document).is(":checked"));

                    let response = await sendRawToAnki({"action":"addNote","version":6,"params":card_creation_data});
                    if(!response.error){
                        hoverEl.find(".create_flashcard").html("Success");
                        already_added[word] = true;
                        hoverEl.find(".create_flashcard").attr("disabled",true);
                        $(".content",createFlashcardWindow.document).html("");
                        $("h1",createFlashcardWindow.document).html("Flashcard Created Successfully");
                        $("button",createFlashcardWindow.document).remove();
                        setTimeout(()=>{
                            createFlashcardWindow.close();
                        },1000);
                    }else{
                        $("h1",createFlashcardWindow.document).html("Failed to create flashcard, check console for details");
                        alert("Failed to create flashcard, check console for details");
                    }
                });
            });
        };
        let processingDB = {};
        let hasBeenLoadedDB = {};
        async function showHoverEl(){
            hoveredWordTracker(word,uuid);
            let $hover = $(`.hover_${uuid}`);
            const $word = $(`.word_${uuid}`);
            $hover.addClass("show-hover");
            if(processingDB[uuid]) return;
            if(hasBeenLoadedDB[uuid]) return;
            processingDB[uuid] = true;
            let translation_data = await getTranslation(word);
            let raw_flashcard_data = {"example":"","front":word,"pitch":"","definitions":"","image":""};
            translation_data.data.forEach((meaning)=>{
                const reading_html = meaning.reading;
                const translation_html = meaning.definitions;
                generateTranslationHTML(translation_html, reading_html);
                raw_flashcard_data.definitions += `<p>${translation_html}</p>`;
                raw_flashcard_data.definitions += `<p>${reading_html}</p>`;
            });
            hasBeenLoadedDB[uuid] = true;
            if(translation_data.data.length==0) {
                hoverElState("not_found");
                return;
            }else{
                updateHoverElHTML();
            }


            if(settings.enable_flashcard_creation && !already_added[word]){
                const encodedWord = await toUniqueIdentifier(word);
                flashcardFunctions[encodedWord] = ()=>{
                    createFlashcardClick(raw_flashcard_data);
                };
                pill_html = await addPills(word,pos,true);
                updateHoverElHTML();
            }

            $hover.ready(()=>{
                let calcW = 600;
                console.log(".footer:",$hover.find(".footer"));
                $hover.find(".footer").css("width","100%");
                $hover.css("width",`${calcW}px`);
                let hover_left = -(calcW-$word.width())/2;
                $hover.css("left",`${hover_left}px`);
                console.log("HOVERED WORD",word,"lazy load");
            });
        }
        let card_data = {};
        if(TRANSLATABLE.includes(pos)){
            console.log("REQUESTING: "+word);
            //check if word is already known by the user
            // let card_data = await getCards(word);
            if(settings.use_anki)
                try{card_data = await getCards(word);}catch(e){card_data.poor = true;}
            else
                card_data.poor = true;

            if(card_data.poor && getKnownStatus(word) < 2){ //card not found
                show_subtitle = true;
                doAppendHoverLazy = true;
                newEl.attr("known","false");
                newEl.on("customLoaded", cardNotFound); //intentionally not awaited, parallelized.
            }else{
                //compare ease
                let current_card = card_data.cards[0];
                if(current_card.factor < settings.known_ease_threshold && getKnownStatus(word) < 2){
                    show_subtitle = true;
                    doAppend = true;
                    await translateWord(card_data, current_card);
                }else{
                    newEl.attr("known","true");
                    changeKnownStatus(word, 2);
                    blurWord(newEl);
                    if(settings.hover_known_get_from_dictionary){
                        doAppendHoverLazy=true;
                    }else{
                        doAppend = true;
                        //translate the word
                        await addTranslationToToken(current_card);
                        hoverEl.addClass("known");
                    }
                }
            }
        }
        updateHoverElHTML();
        if(doAppendHoverLazy){
            toAddToWordList.push({word:word, new:true, fetch:true, screenshot: screenshotVideo()});
            newEl.append(hoverEl);
            newEl.addClass("has-hover");
            hoverElState("loading")
            hasBeenLoadedDB[uuid] = false;
            processingDB[uuid] = false;
            const delayHideHoverEl = (hoverEl, newEl) => {
                setTimeout(() => {
                    if (!hoverEl[0].matches(':hover') && !newEl[0].matches(':hover')) {
                        hoverEl.removeClass('show-hover');
                    }
                }, 300);
            };

            newEl.hover(showHoverEl,async function(){
                delayHideHoverEl(hoverEl, newEl);
            });
        }


        pill_html += await addPills(word,pos);
        updateHoverElHTML();
        if(doAppend){
            if(settings.colour_codes[pos])
                // hoverEl.css("box-shadow",`rgba(100, 66, 66, 0.16) 0px 1px 4px, ${settings.colour_codes[pos]} 0px 0px 0px 3px`);
                hoverEl.css("border",`${settings.colour_codes[pos]} 3px solid`);
            newEl.append(hoverEl);
            newEl.addClass("has-hover");
            //calculate height
            newEl.hover(function(){
                let $hover = $(`.hover_${uuid}`);
                let $word = $(`.word_${uuid}`);
                $hover.addClass("show-hover");
                hoveredWordTracker(word,uuid);
                $hover.ready(()=>{
                    let calcW = $hover.find(".footer").width()+26;
                    if(calcW < 250) {
                        calcW = 250;
                        $hover.find(".footer").css("width","100%");
                    }
                    $hover.css("width",`${calcW}px`);
                    let hover_left = -(calcW-$word.width())/2;
                    $hover.css("left",`${hover_left}px`);

                });
            },function(){
                $(`.hover_${uuid}`).removeClass("show-hover");
            });
        }else{
            if(settings.do_colour_known){
                newEl.css("color",settings.colour_known);
            }
        }
        if(settings.do_colour_codes)
            if(settings.colour_codes[pos]){
                console.log("COLOURING: "+pos);
                newEl.css("color",settings.colour_codes[pos]);
            }
        newEl.attr("grammar",pos);
        newEl.append($(addFrequencyStars(word)));
        $(".subtitles").append(newEl);
        newEl.trigger("customLoaded");
    };


    for(let i = 0; i < tokens.length; i++){
        // console.log("POS: "+pos, TRANSLATABLE.includes(pos),word,word.length, word.length==1,  TRANSLATABLE.includes(pos) && (!word.length==1));
        await processToken(tokens[i], i<tokens.length-1 ? tokens[i+1].type : null);
    }


    for(let word of toAddToWordList){
        word.currentSubtitle = $(".subtitles").html();
        wordList.push(word);
    }
    console.log("finished_displaying_subs");
    if(!show_subtitle && settings.blur_known_subtitles){
        //blur the subtitle
        $(".subtitles").css("filter",`blur(${settings.blur_amount}px)`);
    }
    $(".subtitles").removeClass("quick-transition");
    $(".subtitles").removeClass("not-shown");

    if(isWatchTogether){
        window.electron_settings.watchTogetherSend({action:"subtitles",subtitle:$(".subtitles").html(), size:settings.subtitle_font_size});
    }
};

window.electron_settings.onContextMenuCommand((cmd)=>{
    switch(cmd){
        case 'copy-sub':
            window.electron_settings.writeToClipboard(lastSub.text);
            break;
    }
});

$(".sync-subs .close").click(()=>{
    $(".sync-subs").addClass("not-shown");
});
$(".sync-subs .backward").click(()=>{
    let current_time = video.currentTime+settings.subsOffsetTime;
    let current_sub = findSub(current_time);
    current_sub = subs[current_sub-1];
    if(current_sub){
        settings.subsOffsetTime = current_sub.start - video.currentTime;
    }
    $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
    if(isNaN(settings.subsOffsetTime)) settings.subsOffsetTime = 0;
    videoTimeUpdateCallback();
    saveSettings();
});
$(".sync-subs .forward").click(()=>{
    let current_time = video.currentTime+settings.subsOffsetTime;
    let next_sub = findSub(current_time);
    next_sub = subs[next_sub+1];
    if(next_sub){
        settings.subsOffsetTime = next_sub.start - video.currentTime;
    }
    $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
    if(isNaN(settings.subsOffsetTime)) settings.subsOffsetTime = 0;
    videoTimeUpdateCallback();
    saveSettings();
});
$(".sync-subs input").change(()=>{
    let val = parseFloat($(".sync-subs input").val());
    if(isNaN(val)) return;
    settings.subsOffsetTime = val;
    $(".sync-subs input").val(val.toFixed(2));
    videoTimeUpdateCallback();
    saveSettings();
});

export {modify_sub, wordList, hoveredWordsCount, hoveredWords, resetHoveredWordsCount, hoveredWordTracker, flashcardFunctions, already_added, setHoveredWordsCount, setSubs, updateVideo, subs};