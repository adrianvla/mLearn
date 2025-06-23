const CSSInjectable = `
     #context-menu {
      position: absolute;
      backdrop-filter:blur(20px) saturate(180%);
      background:rgba(60,60,60,0.5);
      border: 1px solid #444;
      box-sizing: border-box;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      display: none;
      z-index: 1000;
      border-radius: 10px;
      min-width: 150px;
      overflow:hidden;
      color:#aaa;
    }
    #context-menu .menu-item {
      padding: 10px;
      cursor: pointer;
    }

    #context-menu .menu-item:hover {
      background-color: #333;
    }`;
function srvUrl(){
    if(!window.mLearnTethered) return "http://localhost:7753/";
    return window.mLearnTetheredIP;
}
const HTMLInjectable = `
    <div class="subtitles">
    </div>
    <div class="aside">
        <div class="header">
            <div class="btn close"><img src="${srvUrl()}pages/assets/icons/cross.svg"></div>
        </div>
        <div class="c">
        </div>
    </div>
    <div id="context-menu"></div>
    <div class="sync-subs not-shown">
        <div class="header">
            <div class="btn close"><img src="${srvUrl()}pages/assets/icons/cross.svg"></div>
        </div>
        <div class="controls">
            <button class="backward"><img src="${srvUrl()}pages/assets/icons/fast-forward.svg"></button>
            <input type="text" class="">
            <button class="forward"><img src="${srvUrl()}pages/assets/icons/fast-forward.svg"></button>
        </div>
    </div>`;
const SUBTITLE_THEMES = ["marker","background","shadow"];
let subs = null;
let alreadyDisplayingCards = {};
let asideTimeout = null;
let TRANSLATABLE;
let already_added = {};
let last_lastIndex = 0;
let lastIndex = 0;
let lastSub = null;
let isLoaded = false;
let restarting = false;
let hoveredWordsCount = 0;
let hoveredWords = {};
let hoveredIds = {};
let wordList = [];
let wordFreq = {};
let foundFreq = {};
let knownAdjustment = {};
let wordUUIDs = {};
let alreadyUpdatedInAnki = {};

let videoTimeUpdateCallback = null; //set later

lS.setItem = function (key, value) {
    lS[key] = value;
}
lS.getItem = function (key) {
    return lS[key];
}
function sendPill(key, value) {
    const script = document.createElement('script');
    script.src = srvUrl()+`api/pills?key=${encodeURIComponent(key)}&value=${encodeURIComponent(value)}`;
    script.onload = () => script.remove();
    document.body.appendChild(script);
}

const applySettings = () => {
    //set subtitle font size
    document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
    document.documentElement.style.setProperty('--word-blur-amount', `${settings.blur_amount}px`);

    SUBTITLE_THEMES.forEach((theme)=>{
        $(".subtitles").removeClass("theme-"+theme);
    });
    //set subtitle theme
    $(".subtitles").addClass("theme-"+settings.subtitleTheme);
};

const show_notification = (m, autoclose=true) => {
    let notification = $(`<div class="custom-notification">
        <div class="header">
            <div class="btn close"><img src="${srvUrl()}pages/assets/icons/cross.svg"></div>
        </div>
        <div class="content">
            <span>${m}</span>
        </div>
    </div>`);
    notification.css("right","-100%");
    $("body").append(notification);
    //animate
    notification.animate({right: 10});
    notification.find(".close").click(()=>{
        notification.animate({right: "-100%"},()=>{notification.remove()});
    });
    if(autoclose){
        setTimeout(() => {
            notification.animate({right: "-100%"}, () => {notification.remove()});
        }, 3000);
    }
};

function initCTXMenu() {
    const contextMenu = document.getElementById('context-menu');

// Dynamic store for global menu items
    const globalMenuItems = [];

// Allow adding items dynamically
    window.addContextMenuItem = function (name, callback) {
        globalMenuItems.push({name, callback});
    }

    window.clearContextMenuItems = function () {
        globalMenuItems.length = 0;
    }

    function getContextMenuItems(targetElement) {
        // Could filter by targetElement here if needed
        return [...globalMenuItems];
    }

    function showContextMenu(items, x, y) {
        contextMenu.innerHTML = '';

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'menu-item';
            div.textContent = item.name;
            div.onclick = (e) => {
                e.stopPropagation();
                item.callback();
                hideContextMenu();
            };
            contextMenu.appendChild(div);
        });

        contextMenu.style.left = `${x}px`;
        contextMenu.style.top = `${y}px`;
        contextMenu.style.display = 'block';
    }

    function hideContextMenu() {
        contextMenu.style.display = 'none';
    }


    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const items = getContextMenuItems(e.target);
        if (items.length > 0) {
            showContextMenu(items, e.pageX, e.pageY);
        }
    });
    // Mobile long-press support
    let touchTimer = null;
    document.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchTimer = setTimeout(() => {
                const touch = e.touches[0];
                const items = getContextMenuItems(e.target);
                if (items.length > 0) {
                    showContextMenu(items, touch.pageX, touch.pageY);
                }
            }, 500); // 600ms for long press
        }
    });
    document.addEventListener('touchend', () => {
        clearTimeout(touchTimer);
    });
    document.addEventListener('touchmove', () => {
        clearTimeout(touchTimer);
    });

    document.addEventListener('click', hideContextMenu);
    window.addEventListener('blur', hideContextMenu);
}

function injectCSS(cssText) {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = cssText;
    document.head.appendChild(style);
}
const load_lang_data = () => {
    TRANSLATABLE = lang_data[settings.language].translatable;
    settings.colour_codes = lang_data[settings.language].colour_codes;
};

const parseWordFrequency = () => {
    //using data from https://github.com/FerchusGames/JLPT-Migaku-Frequency-List/tree/main
    if(!lang_data[settings.language].freq) return;
    const freq = lang_data[settings.language].freq;
    for(let wordi in freq){
        if(!freq[wordi]) continue;
        if(freq[wordi].length < 2) continue;
        let level = 1;
        if(wordi<=1500 && wordi>=0){
            level = 5;
        }else if(wordi>1500 && wordi<=5000){
            level = 4;
        }else if(wordi>5000 && wordi<=15000){
            level = 3;
        }else if(wordi>15000 && wordi<=30000){
            level = 2;
        }
        let lvlName = "";
        if(lang_data[settings.language].freq_level_names){
            lvlName = lang_data[settings.language].freq_level_names[String(level)];
        }
        if(!lvlName){
            lvlName = "Level "+level;
        }
        wordFreq[freq[wordi][0]] = {reading:freq[wordi][1], level:lvlName, raw_level:level};
    }

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
function replaceLocalhostEndpointURL(str) {
    if(!window.mLearnTethered) return str;
    let newBaseURL = window.mLearnTetheredIP;
    // Ensure trailing slash on base URL
    if (!newBaseURL.endsWith('/')) {
        newBaseURL += '/';
    }
    newBaseURL += "forward/";

    return str.replace(
        /http:\/\/127\.0\.0\.1:8000\/([a-zA-Z0-9-_]+)/g,
        (_, endpoint) => newBaseURL + endpoint
    );
}
function tokenise(text){
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                resolve(response.tokens);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', replaceLocalhostEndpointURL(settings.tokeniserUrl));
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({"text":text}));
    });
}
function getCards(text){
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', replaceLocalhostEndpointURL(settings.getCardUrl));
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({"word":text}));
    });
}

function getTranslation(text){
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
            } catch (e) {
                reject(e);
                console.log(xhr.responseText);
            }
        });

        xhr.open('POST', replaceLocalhostEndpointURL(settings.getTranslationUrl));
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({"word":text}));
    });
}
async function toUniqueIdentifier(nonLatinString) {
    // Encode the string into Base64
    const base64String = btoa(unescape(encodeURIComponent(nonLatinString)));

    // Convert the Base64 string to a Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(base64String);

    // Hash the data using SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert the hash to a hexadecimal string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');

    return hashHex;
}


const addTranslationCard = async (translation, reading) => {
    console.log(translation,reading);
    let readingHash = await toUniqueIdentifier(reading);
    if(alreadyDisplayingCards[readingHash]) return ()=>{};
    let uuid = "card_"+readingHash;
    if($(".aside .c .mLearn-card").length==0){
        $(".aside .c").append(`
            <div class="mLearn-card" id="${uuid}">
                <h1>${translation}</h1>
                <p>${reading}</p>
            </div>
        `);
    }else{
        $(".aside .c .mLearn-card").first().before(`
            <div class="mLearn-card" id="${uuid}">
                <h1>${translation}</h1>
                <p>${reading}</p>
            </div>
        `);
    }
    alreadyDisplayingCards[readingHash] = true;
    //if more than 10 cards, remove the last one
    if($(".aside .c .mLearn-card").length>6){
        //remove from alreadyDisplayingCards
        let lastCard = $(".aside .c .mLearn-card").last();
        let lastCardId = lastCard.attr("id");
        delete alreadyDisplayingCards[lastCardId];
        //remove the card
        $(".aside .c .mLearn-card").last().remove();
    }
    if (asideTimeout) {
        clearTimeout(asideTimeout);
    }
    $(".aside").removeClass("opacity0");
    asideTimeout = setTimeout(() => {
        $(".aside").addClass("opacity0");
        alreadyDisplayingCards = {};
    },5000);
    return ()=>{$(`#${uuid}`).remove();};
}
function isNotAllKana(word) {
    // Regular expression to match any character that is not Hiragana or Katakana
    const nonKanaRegex = /[^\u3040-\u30FF]/;
    return nonKanaRegex.test(word);
}

const randomUUID = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const saveKnownAdjustment = () => {
    lS.setItem("knownAdjustment", JSON.stringify(knownAdjustment));
};
const loadKnownAdjustment = () => {
    let data = lS.getItem("knownAdjustment");
    if(data){
        knownAdjustment = JSON.parse(data);
    }else{
        knownAdjustment = {};
    }
};
const loadAlreadyUpdatedInAnki = () => {
    let data = lS.getItem("alreadyUpdatedInAnki");
    if(data){
        alreadyUpdatedInAnki = JSON.parse(data);
    }else{
        alreadyUpdatedInAnki = {};
    }
};
const changeKnownStatus = (word, status) => {
    knownAdjustment[word] = status;
    saveKnownAdjustment();
    sendPill(word, status);
};
const getKnownStatus = (word) => {
    /*
    * 0: unknown
    * 1: learning
    * 2: known
    * */
    if(word in knownAdjustment){
        return knownAdjustment[word];
    }
    return 0;
};
const unknownStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn red" onclick='changeKnownBtnStatus("${uuid}", 1);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="${srvUrl()}pages/assets/icons/cross2.svg" alt="">
    </span>
    <span>Unknown</span>
</div>`;
};
const learningStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn orange" onclick='changeKnownBtnStatus("${uuid}", 2);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="${srvUrl()}pages/assets/icons/check.svg" alt="">
    </span>
    <span>Learning</span>
</div>`;
};
const knownStatusPillHTML = (uuid) => {
    return `<div class="pill pill-btn green" onclick='changeKnownBtnStatus("${uuid}", 0);' id="status-pill-${uuid}">
    <span class="icon">
        <img src="${srvUrl()}pages/assets/icons/check.svg" alt="">
    </span>
    <span>Known</span>
</div>`;
};
const generateStatusPillHTML = async (word, status) => {
    const uuid = await toUniqueIdentifier(word);
    wordUUIDs[uuid] = word;
    if(status == 0){
        return unknownStatusPillHTML(uuid);
    }else if(status == 1){
        return learningStatusPillHTML(uuid);
    }else if(status == 2){
        return knownStatusPillHTML(uuid);
    }
    return "";
};
const changeKnownBtnStatus = async (uuid, status) => {
    const id = `status-pill-${uuid}`;
    const el = document.getElementById(id);
    const word = wordUUIDs[uuid];
    el.outerHTML = await generateStatusPillHTML(word, status);
    console.log("Changed status of word: "+word+" to "+status);
    changeKnownStatus(word, status);
};

const changeKnownStatusButtonHTML = async (word, status = 0) => {
    if(!status)
        status = getKnownStatus(word);
    return await generateStatusPillHTML(word, status);
};

const screenshotVideo = () => {
    try{
        let picture_data_url = "";
        let video = $("video").get(0);
        if(!video) throw "No video found";
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        let width = 480;
        let height = video.videoHeight * (width / video.videoWidth);
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        picture_data_url = canvas.toDataURL("image/jpeg",0.5);
        return picture_data_url;
    }catch(e){console.log(e);}
};

const blurWord = (newEl)=>{
    if(settings.blur_words){
        newEl.addClass("blur");
    }
};
const countFreq = (freq) => {
    if(freq in foundFreq) {
        foundFreq[freq]++;
    }else{
        foundFreq[freq] = 1;
    }
};
const addPills = async (word,pos, addAnkiBtn = false)=>{
    //check if word is in wordFreq
    let s = `<div class="footer"><div class="pills">`;
    if(word in wordFreq){
        countFreq(wordFreq[word].raw_level);
        s += `<div class="pill" level="${wordFreq[word].raw_level}">${wordFreq[word].level}</div>`;
    }
    if(settings.show_pos){
        s += `<div class="pill">${pos}</div>`;
    }
    s += await changeKnownStatusButtonHTML(word);

    s += `</div></div>`;
    return s;
};



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
    wordUUIDs = {};
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
    const processToken = async (token) => {
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
            let translation_data = await getTranslation(word);
            if(translation_data.data.length == 0) return;
            if(settings.openAside){
                //force fetch the word from the dictionary
                doAppend = true;
                const first_meaning = translation_data.data[0];
                addTranslationCard(first_meaning.definitions, first_meaning.reading);
            }
            if(settings.immediateFetch || settings.openAside){
                //translate the word + put in cache
                if (settings.furigana && isNotAllKana(real_word)){
                    let $word = $(".word_"+uuid);
                    $word.contents().filter(function() {
                        return this.nodeType === 3;
                    }).remove();
                    if($word.is(".has-hover"))
                        $word.append($(`<ruby>${real_word}<rt>${translation_data.data[0].reading}</rt></ruby>`));
                    else
                        $word.html(`<ruby>${real_word}<rt>${translation_data.data[0].reading}</rt></ruby>`);
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
            newEl.html(`<ruby>${real_word}<rt>${reading_text}</rt></ruby>`);
            hasFurigana = true;
        };
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
            if(settings.furigana && isNotAllKana(real_word)){
                addFurigana(reading_html);
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

        if(TRANSLATABLE.includes(pos)){
            console.log("REQUESTING: "+word);
            //check if word is already known by the user
            let card_data = {};
            // let card_data = await getCards(word);
            if(settings.use_anki)
                try{card_data = await getCards(word);}catch(e){card_data.poor = true;}
            else
                card_data.poor = true;

            if(card_data.poor && getKnownStatus(word) < 2){ //card not found
                show_subtitle = true;
                doAppendHoverLazy = true;
                newEl.attr("known","false");
                cardNotFound(); //intentionally not awaited, parallelized
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
    };


    for(let token of tokens){
        // console.log("POS: "+pos, TRANSLATABLE.includes(pos),word,word.length, word.length==1,  TRANSLATABLE.includes(pos) && (!word.length==1));
        await processToken(token);
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

};


(async function() {
    parseWordFrequency();
    load_lang_data();

    if(settings.use_anki){
        // $(".add-all-to-anki, .update-flashcards-due-date").show();
        $(".add-all-to-anki").hide();
        $(".update-flashcards-due-date").show();
    }else{
        $(".add-all-to-anki, .update-flashcards-due-date").hide();
    }
    show_notification("mLearn loaded");
})();


const findCurrentSub = (currentTime) => {
    if (subs.length === 0) return null;

    // Check if the current time is within the range of the last found subtitle
    if (currentTime >= subs[lastIndex].start && currentTime <= subs[lastIndex].end) {
        return subs[lastIndex];
    }

    // Iterate from the last found index to find the current subtitle
    for (let i = lastIndex; i < subs.length; i++) {
        if (currentTime >= subs[i].start && currentTime <= subs[i].end) {
            lastIndex = i;
            return subs[i];
        }
    }

    // If not found, iterate from the beginning to the last found index
    for (let i = 0; i < lastIndex; i++) {
        if (currentTime >= subs[i].start && currentTime <= subs[i].end) {
            lastIndex = i;
            return subs[i];
        }
    }

    return null;
};

const findSub = time => {
    if (subs.length === 0) return null;

    // Iterate from the last found index to find the current subtitle
    for (let i = lastIndex; i < subs.length; i++) {
        if (time >= subs[i].start && time <= subs[i].end) {
            return i;
        }
    }

    // If not found, iterate from the beginning to the last found index
    for (let i = 0; i < lastIndex; i++) {
        if (time >= subs[i].start && time <= subs[i].end) {
            return i;
        }
    }
    let closestIndex = 0;
    let closestTimeDiff = Math.min(Math.abs(time - subs[0].start),Math.abs(time - subs[0].end));

    // Iterate through the subtitles to find the closest one
    for (let i = 1; i < subs.length; i++) {
        let timeDiff = Math.min(Math.abs(time - subs[i].start),Math.abs(time - subs[i].end));
        if (timeDiff < closestTimeDiff) {
            closestTimeDiff = timeDiff;
            closestIndex = i;
        }
    }

    return closestIndex;
};
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


const parseTime = (timeString,type) => {
    let timeRegex = null;
    if(type=="."){
        timeRegex = /(\d+):(\d{2}):(\d{2}\.\d{2})/;
    }else{
        timeRegex = /(\d+):(\d{2}):(\d{2},\d{3})/;
    }
    const match = timeRegex.exec(timeString);
    if (!match) {
        throw new Error('Invalid time format');
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseFloat(match[3].replaceAll(",","."));
    return (hours * 3600) + (minutes * 60) + seconds;
};

const readSubtitleRaw = (o) => {
    return new Promise((resolve, reject) => {
        lastIndex = 0;
        const content = o.content;
        if (o.name.endsWith('.srt')) {
            let parsed = parseSRT(content);
            parsed.forEach((sub) => {
                sub.start = parseTime(sub.start,",");
                sub.end = parseTime(sub.end,",");
            });
            resolve(parsed);
        } else if (o.name.endsWith('.ass')) {
            let parsed = parseASS(content);
            parsed.forEach((sub) => {
                sub.start = parseTime(sub.start,".");
                sub.end = parseTime(sub.end,".");
            });
            resolve(parsed);
        } else {
            reject('Unsupported file type');
        }
    });
};



const parseSRT = (content) => {
    const subtitles = [];
    // Updated regex to handle both \n and \r\n
    const srtRegex = /(\d+)(?:\r?\n)(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})(?:\r?\n)([\s\S]*?)(?=\r?\n\d|\r?\n*$)/g;
    let match;

    while ((match = srtRegex.exec(content)) !== null) {
        subtitles.push({
            start: match[2],
            end: match[3],
            text: match[4].replace(/(?:\r?\n)/g, ' ') // Replace line breaks with space in the subtitle text
        });
    }

    return subtitles;
};


const parseASS = (content) => {
    const subtitles = [];
    const assRegex = /Dialogue:\s*(\d+),(\d+:\d+:\d+\.\d+),(\d+:\d+:\d+\.\d+),([^,]*),([^,]*),(\d+),(\d+),(\d+),([^,]*),(.+)/g;
    let match;
    while ((match = assRegex.exec(content)) !== null) {
        const text = match[10].replace(/\\N/g, ' ').replace(/{.*?}/g, ''); // Remove formatting tags
        subtitles.push({
            start: match[2],
            end: match[3],
            text: text
        });
    }
    return subtitles;
};
function getElementTopOffset(el) {
    if (!(el instanceof Element)) {
        console.error('getElementTopOffset: invalid element');
        return null;
    }

    const rect = el.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    return rect.top + scrollTop;
}

(function (){
    if(isLoaded) return;
    isLoaded = true;

    loadKnownAdjustment();
    loadAlreadyUpdatedInAnki();

    document.body.insertAdjacentHTML('beforeend',HTMLInjectable);

    const video = document.querySelector("video");
    let loadSubWindow = null;
    injectCSS(CSSInjectable);

    {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = srvUrl()+'pages/assets/light_style.css';
        document.head.appendChild(style);
    }

    initCTXMenu();
    document.body.classList.add("dark");

    applySettings();
    setTimeout(()=>{
        const offset = getElementTopOffset(video);
        let offset1 = offset + video.getBoundingClientRect().height;
        offset1 -= 10;
        $(".subtitles").css("bottom",`${window.innerHeight-offset1}px`);
        $(".aside, .sync-subs").css("top",`${offset+38}px`);
    },500);

    $(".aside").on("mouseover",()=>{
        if (asideTimeout) {
            clearTimeout(asideTimeout);
        }
        $(".aside").removeClass("opacity0");
        asideTimeout = setTimeout(() => {
            $(".aside").addClass("opacity0");
            alreadyDisplayingCards = {};
        },5000);
    });


    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && document.activeElement.tagName === 'BUTTON') {
            event.preventDefault();
        }
    });
    videoTimeUpdateCallback = () => {
        updateVideo(video.currentTime+settings.subsOffsetTime);
    };

    video.addEventListener('timeupdate',videoTimeUpdateCallback);

    addContextMenuItem("Load Subtitles", () => {
        loadSubWindow = window.open("", "Load Subtitles", "width=400,height=300");
        if (loadSubWindow) {
            loadSubWindow.document.write(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        margin: 0;
                        padding: 0;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100%;
                        background-color: #f0f0f0;
                    }
                    .drop-zone {
                        width: 100vw;
                        height: 100vh;
                        margin: 0;
                        border: 2px dashed #aaa;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        text-align: center;
                        color: #555;
                        background-color: #fff;
                    }
                    .drop-zone.dragging {
                        border-color: #333;
                        background-color: #e0e0e0;
                    }
                </style>
            </head>
            <body>
                <div class="drop-zone">
                    <span>Drop your .srt or .ass files here</span>
                    <input type="file" accept=".srt,.ass" style="display:none" id="fileInput">
                </div>
                <script>
                    const readFile = (file) => {
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                                const content = event.target.result;
                                resolve(content);
                            };
                            reader.onerror = () => reject('Error reading file');
                            reader.readAsText(file);
                        });
                    };
                    const dropZone = document.querySelector('.drop-zone');
                    const fileInput = document.getElementById('fileInput');
                    dropZone.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        dropZone.classList.add('dragging');
                    });
                    dropZone.addEventListener('dragleave', () => {
                        dropZone.classList.remove('dragging');
                    });
                    dropZone.addEventListener('drop', async (e) => {
                        e.preventDefault();
                        dropZone.classList.remove('dragging');
                        const files = e.dataTransfer.files;
                        if (files.length > 0) {
                            const file = files[0];
                            if (file.name.endsWith('.srt') || file.name.endsWith('.ass')) {
                                let f = {name:file.name};
                                f.content = await readFile(file);
                                window.opener.postMessage({ file: f }, '*');
                            } else {
                                alert('Error: Please drop a .srt or .ass file');
                            }
                        }
                    });
                    dropZone.addEventListener('click', () => {
                        fileInput.value = '';
                        fileInput.click();
                    });
                    fileInput.addEventListener('change', async (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            if (file.name.endsWith('.srt') || file.name.endsWith('.ass')) {
                                let f = {name:file.name};
                                f.content = await readFile(file);
                                window.opener.postMessage({ file: f }, '*');
                            } else {
                                alert('Error: Please select a .srt or .ass file');
                            }
                        }
                    });
                </script>
            </body>
            </html>
        `);
        } else {
            alert("Failed to open the window.");
        }
    });
    addContextMenuItem("Sync Subtitles With Video", ()=>{
        $(".sync-subs").removeClass("not-shown");
        $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
    });
    addContextMenuItem("Open Live Word Translator", ()=>{
        $(".aside").show();
        settings.openAside = true;
    });
    addContextMenuItem("Show Last Subtitle Raw Text",()=>{alert(lastSub.text)});

    if(settings.openAside){
        $(".aside").show();
    }else{
        $(".aside").hide();
    }

    $(".aside .close").click(()=>{
        $(".aside").hide();
        settings.openAside = false;
    });

    $(".add-all-to-anki").click(()=>{
        addAllFlashcardsToAnki();
    });

    $(".update-flashcards-due-date").click(()=>{
        updateFlashcardsAnkiDate();
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
    });
    $(".sync-subs input").change(()=>{
        let val = parseFloat($(".sync-subs input").val());
        if(isNaN(val)) return;
        settings.subsOffsetTime = val;
        $(".sync-subs input").val(val.toFixed(2));
        videoTimeUpdateCallback();
    });
    const manageRawSub = async (o) => {
        const fileName = o.name;
        console.log('Subtitle file dropped:', fileName);
        let temp = await readSubtitleRaw(o);
        currentSubtitleFile = fileName;
        // sort subtitles by starting time
        subs = temp.sort((a, b) => a.start - b.start);
        console.log(subs);
    };
    window.addEventListener('message', async (event) => {
        if (event.data && event.data.file) {
            const droppedFile = event.data.file;
            console.log('Received dropped file from new window:', droppedFile);
            await manageRawSub(droppedFile);
            loadSubWindow.close();
            loadSubWindow = null;
            show_notification("Subtitles loaded successfully");
        }
    });
})();