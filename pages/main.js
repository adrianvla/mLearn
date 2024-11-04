let supported_languages = [];
let lang_data = {};
const DEFAULT_SETTINGS = {"known_ease_threshold":1500,"blur_words":false,"blur_known_subtitles":false,"blur_amount":5,"colour_known":"#cceec9","do_colour_known":true,"do_colour_codes":true,"colour_codes":{},"dark_mode":true,"hover_known_get_from_dictionary":false,"show_pos":true,"language":"ja","use_anki":true,"furigana":true,"enable_flashcard_creation":true,"flashcard_deck":null,"flashcards_add_picture":true,"getCardUrl":"http://127.0.0.1:8000/getCard","tokeniserUrl":"http://127.0.0.1:8000/tokenize","getTranslationUrl":"http://127.0.0.1:8000/translate","ankiUrl":"http://127.0.0.1:8000/fwd-to-anki","ankiConnectUrl":"http://127.0.0.1:8765","openAside":false,"subsOffsetTime":0,"immediateFetch":false,"subtitleTheme":"shadow","subtitle_font_size":40};
const SUBTITLE_THEMES = ["marker","background","shadow"];
const FLASHCARD_CSS = `.card-c{background:#181818;display:flex;flex-direction:column;border-radius:20px;margin:10px;width:max-content;height:max-content;box-sizing:border-box;border:1px solid #444;color:#ccc;font-family:"Helvetica Neue","Arial", sans-serif;padding-bottom:20px;min-width:500px;max-width:700px}.card-c.light{background:#ccc;border:1px solid #aaa;color:#777}.divider{width:100%;background:#444;height:1px;margin-top:5px;margin-bottom:5px}.card-c.light .divider{background:#aaa}.card-item{display:flex;justify-content:center;align-items:center;padding-inline:20px;gap:20px}.img-btn{width:40px;height:40px;display:flex;justify-content:center;align-items:center;border-radius:10px;transition:background 0.1s;background:transparent;user-select:none;cursor:pointer}.img-btn:hover{background:#333}.card-c.light .img-btn:hover{background:#aaa}.img-btn svg{width:30px;height:30px;pointer-events:none;user-select:none;transition:opacity 0.2s, background 0.2s, fill 0.2s;box-sizing:border-box}.card-c.light .img-btn svg path{fill:#888}.img-btn:hover svg{opacity:0.8}.card-c.light .img-btn:hover svg path{fill:#777}.card-c.light .img-btn:hover svg{opacity:1}.pitch-accent-low{display:flex;background-image:linear-gradient(to top,#5e84ff,transparent);padding-bottom:2px;margin-top:2px;margin-right:-2px;padding-right:2px}a{color:#5e84ff}.pitch-accent-low div{background-color:#181818;padding-right:2px}.pitch-accent-high{display:flex;background-image:linear-gradient(to bottom, #ff5ec7,transparent);padding-top:2px;margin-bottom:2px;padding-left:2px}.card-c.light .pitch-accent-high{background-image:linear-gradient(to bottom, #e835a8,transparent)}.card-c.light .pitch-accent-low{background-image:linear-gradient(to top, #356ee8,transparent)}.pitch-accent-high.drop{padding-top:2px;margin-bottom:2px;margin-right:-2px;padding-left:2px;padding-right:2px}.pitch-accent-high div{background-color:#181818;padding-left:1px}.card-c.light .pitch-accent-high div,.card-c.light .pitch-accent-low div{background-color:#ccc}.pitch-accent-high.drop div{padding-right:2px}.word{display:flex}.definition{margin:10px;border-radius:10px;background:#222;padding:20px;font-size:20px;display:flex;flex-direction:column;gap:10px;border:1px solid #444;box-sizing:border-box;transition:border 0.2s;min-width:400px}.card-c.light .definition{background:#bbb;border:1px solid #aaa;color:#5a5a5a}.definition:focus{outline:none;border:3px solid #444}.card-c.light .definition:focus{border:3px solid #aaa}.definition p{margin:0}.example .sentence{font-size:30px;text-align:center}.example{display:flex;flex-direction:column}.example .translation{font-size:16px;color:#aaa;text-align:center}.card-c.light .example .translation{color:#888}.example .translation:hover{}.example .translation p{margin:5px}.defined{color:#ff5ec7;font-weight:bold}.card-c.light .defined{color:#356ee8}.card-item > img{border-radius:10px;min-width:100%;}`;
const IN_SETTINGS_CATEGORY = {"General":["dark_mode","language","install_languages","save","restoreDefaults"],"Behaviour":["known_ease_threshold","blur_words","blur_known_subtitles","blur_amount","immediateFetch","do_colour_known","colour_known","do_colour_codes","show_pos","hover_known_get_from_dictionary","furigana","aside-auto","save","restoreDefaults"],"Customization":["subtitle_theme","subtitle_font_size","save","restoreDefaults"],"Anki":["use_anki","anki_connect_url","enable_flashcard_creation","flashcards_add_picture","flashcard_deck","save","restoreDefaults"],"About":[]};
const WINDOW_HTML_SETTINGS = `<!doctypehtml><html lang="en"><meta charset="UTF-8"><title>Settings</title><link href="style.css"rel="stylesheet"><style>body{background:#000}</style><body class="settings-body"><div class="nav"><div class="nav-item selected"id="General"><img src="assets/icons/cog.svg"><span>General</span></div><div class="nav-item"id="Behaviour"><img src="assets/icons/subtitles.svg"><span>Behaviour</span></div><div class="nav-item"id="Customization"><img src="assets/icons/palette.svg"><span>Appearance</span></div><div class="nav-item"id="Anki"><img src="assets/icons/cards.svg"><span>Anki</span></div><div class="nav-item"id="About"><img src="assets/icons/document.svg"><span>About</span></div></div><div class="settingsMenuContent"><div class="preview"data-show="Customization"><div class="subtitles"><span class="subtitle_word SUB_W_COL_1">A</span><span class="subtitle_word SUB_W_COL_2">a</span><span class="subtitle_word SUB_W_COL_1">あア</span><span class="subtitle_word SUB_W_COL_2">億</span><span class="subtitle_word SUB_W_COL_1">ыЦ</span><span class="subtitle_word SUB_W_COL_2">è</span></div></div><div class="_1"></div><div class="_2"></div><div class="about"style="display:none">mLearn v1.0.0<br>Developed by <a id="contact">Adrian Vlasov</a><br>Contact: admin@morisinc.net<br><a id="licenses">Licenses</a></div></div>`;

let subs = null;
let settings = {};
let alreadyDisplayingCards = {};
let asideTimeout = null;
let TRANSLATABLE;
// let lastSubTranslationElements = [];
let already_added = {};
let last_lastIndex = 0;
let lastIndex = 0;
let lastSub = null;
let isLoaded = false;
let isSettingsWindowOpen = false;
let playbackType = null;
let mustRestart = false;
let currentSubtitleFile = null;
let HLSObject = null;
let currentPlayingVideo = null;
let createFlashcardWindow = null;
let languageInstallationWindow = null;
let languageInstalledCallbacks = [];
let languageInstallErrorCallbacks = [];
let restarting = false;
let hoveredWordsCount = 0;
let hoveredWords = {};
let hoveredIds = {};

let loadStream = null; //set later
let videoTimeUpdateCallback = null; //set later



const show_notification = (m) => {
    let notification = $(`<div class="custom-notification">
        <div class="header">
            <div class="btn close"><img src="assets/icons/cross.svg"></div>
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
};

const load_lang_data = () => {
    TRANSLATABLE = lang_data[settings.language].translatable;
    settings.colour_codes = lang_data[settings.language].colour_codes;
};

const checkSettings = () => {
    //check if every setting is present
    for(let key in DEFAULT_SETTINGS){
        if(!(key in settings)){
            settings[key] = DEFAULT_SETTINGS[key];
        }
    }
    //fix settings
    for(let key in lang_data[settings.language].fixed_settings){
        settings[key] = lang_data[settings.language].fixed_settings[key];
    }
    //set subtitle font size
    document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
    document.documentElement.style.setProperty('--word-blur-amount', `${settings.blur_amount}px`);

    SUBTITLE_THEMES.forEach((theme)=>{
        $(".subtitles").removeClass("theme-"+theme);
    });
    //set subtitle theme
    $(".subtitles").addClass("theme-"+settings.subtitleTheme);
    //set dark mode
    if(settings.dark_mode) $("body").addClass("dark");
    else $("body").removeClass("dark");

    saveSettings();
};
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
const onVideoEnded = (videoUrl) => {
    let videoStats = JSON.parse(localStorage.getItem("videoStats"));
    if(!videoStats) videoStats = [];
    //if url already exists, merge
    let exists = false;
    for(let videoStat of videoStats){
        if(videoStat.url === videoUrl){
            videoStat.words += hoveredWordsCount;
            localStorage.setItem("videoStats",JSON.stringify(videoStats));
            exists = true;
            continue;
        }
    }
    if(!exists)
        videoStats.push({url:videoUrl,words:hoveredWordsCount, name:parseSubtitleName(currentSubtitleFile)});
    hoveredWordsCount = videoStats[videoStats.length-1].words; //fixed bug where hoveredWordsCount was not up-to-date
    //if more than 10
    if(videoStats.length>10){
        videoStats.shift();
    }
    $(".stats-c .word-count").text(hoveredWordsCount);
    let word_lookup_html = "";
    //sort by count
    let sortable = [];
    for (let word in hoveredWords) {
        sortable.push([word, hoveredWords[word]]);
    }
    sortable.sort((a, b)=>b[1] - a[1]);
    let sortedHoveredWords = {};
    sortable.forEach((item)=>{
        sortedHoveredWords[item[0]] = item[1];
    });
    for(let word in sortedHoveredWords){
        word_lookup_html += `<div class="word-lookup-item"><span class="word">${word}</span>: <span class="count">${sortedHoveredWords[word]}</span></div>`;
    }
    $(".stats-c .word-lookup").html(word_lookup_html);
    localStorage.setItem("videoStats",JSON.stringify(videoStats));
    resetHoveredWordsCount();
    $(".stats-c").removeClass("hide");

    const canvas = document.getElementById('stats-chart');
    const ctx = canvas.getContext('2d');

    let data = videoStats.map((videoStat)=>videoStat.words);
    let labels = [];

    const chartWidth = canvas.width;
    const chartHeight = canvas.height;
    const barWidth = chartWidth / data.length;
    let maxLength = Math.floor(barWidth/20);
    for(let videoStat of videoStats){
        //truncate the name
        labels.push(videoStat.name.length>maxLength?videoStat.name.substring(0,maxLength)+"...":videoStat.name);
    }
    labels[labels.length-1] = "Now";
    ctx.clearRect(0, 0, chartWidth, chartHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '16px Helvetica';

    data.forEach((value, index) => {
        const barHeight = (value / Math.max(...data)) * chartHeight;
        const x = index * barWidth;
        const y = chartHeight - barHeight;

        if(index==data.length-1)
            ctx.fillStyle = '#4374BD';
        else
            ctx.fillStyle = '#777';
        ctx.fillRect(x, y, barWidth - 10, barHeight);
        console.log(labels[index],x + (barWidth - 10) / 2, chartHeight - 5);
        ctx.fillStyle = '#FFFFFF'; // Change this to your desired text color
        ctx.fillText(labels[index], x + (barWidth - 10) / 2, chartHeight - 5);
        //put just under the bar end
        if(value>0)
            ctx.fillText(value, x + (barWidth - 10) / 2, y + 20);
    });
};

const saveSettings = async () => {
    //send settings
    window.electron_settings.saveSettings(settings);
};
const getSettings = async () => new Promise((resolve) => {
    window.electron_settings.getSettings();
    window.electron_settings.onSettings((settings) => {
        resolve(settings);
    });
});
const getLangData = async () => new Promise((resolve) => {
    window.electron_settings.getLangData();
    window.electron_settings.onLangData((lang_data) => {
        //set supported languages
        supported_languages = Object.keys(lang_data);
        resolve(lang_data);
    });
});

const loadSettings = async () => {
    lang_data = await getLangData();
    settings = await getSettings();
};

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

        xhr.open('POST', settings.tokeniserUrl);
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

        xhr.open('POST', settings.getCardUrl);
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

        xhr.open('POST', settings.getTranslationUrl);
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({"word":text}));
    });
}

function sendRawToAnki(data){
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

        xhr.open('POST', settings.ankiUrl);
        //send json
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(data));
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
    if($(".aside .c .card").length==0){
        $(".aside .c").append(`
            <div class="card" id="${uuid}">
                <h1>${translation}</h1>
                <p>${reading}</p>
            </div>
        `);
    }else{
        $(".aside .c .card").first().before(`
            <div class="card" id="${uuid}">
                <h1>${translation}</h1>
                <p>${reading}</p>
            </div>
        `);
    }
    alreadyDisplayingCards[readingHash] = true;
    //if more than 10 cards, remove the last one
    if($(".aside .c .card").length>6){
        //remove from alreadyDisplayingCards
        let lastCard = $(".aside .c .card").last();
        let lastCardId = lastCard.attr("id");
        delete alreadyDisplayingCards[lastCardId];
        //remove the card
        $(".aside .c .card").last().remove();
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


    let tokens = await tokenise(subtitle);
    console.log(tokens);

    hoveredIds = {};
    //create spans
    let show_subtitle = false;
    for(let token of tokens){
        let word = token.actual_word;
        let pos = token.type;
        let real_word = token.word;
        let uuid = randomUUID();
        let newEl = $(`<span class="subtitle_word word_${uuid}" style="color: #ffffff !important;font-size: 36px !important;font-weight: 700 !important;text-shadow: 0 0 3px #000000, 0 0 3px #000000, 0 0 3px #000000, 0 0 3px #000000 !important">${real_word}</span>`);
        let hoverEl = $(`<div class="subtitle_hover hover_${uuid} ${settings.dark_mode ? 'dark' : ''}" style="display:none"></div>`);
        let hoverEl_html = "";
        let doAppend = false;
        let doAppendHoverLazy = false;
        let hasFurigana = false;
        // console.log("POS: "+pos, TRANSLATABLE.includes(pos),word,word.length, word.length==1,  TRANSLATABLE.includes(pos) && (!word.length==1));

        const blurWord = ()=>{
            if(settings.blur_words){
                newEl.addClass("blur");
            }
        };

        if(TRANSLATABLE.includes(pos)/* && (!(word.length==1))*/){
            console.log("REQUESTING: "+word);
            //check if word is already known by the user
            let card_data = {};
            // let card_data = await getCards(word);
            if(settings.use_anki)
                try{card_data = await getCards(word);}catch(e){card_data.poor = true;}
            else
                card_data.poor = true;

            if(card_data.poor){ //card not found
                show_subtitle = true;
                doAppendHoverLazy = true;
                newEl.attr("known","false");
                if(settings.openAside){
                    //force fetch the word from the dictionary
                    doAppend = true;
                    //queue another function
                    (async () => {
                        let translation_data = await getTranslation(word);
                        if (translation_data.data.length != 0) {
                            let first_meaning = translation_data.data[0];
                            addTranslationCard(first_meaning.definitions, first_meaning.reading);
                        }
                    })();
                }
                if(settings.immediateFetch || settings.openAside){
                    //translate the word + put in cache
                    (async () => {
                        let translation_data = await getTranslation(word);
                        if (translation_data.data.length != 0 && settings.furigana && isNotAllKana(real_word)){
                            $(".word_"+uuid).contents().filter(function() {
                                return this.nodeType === 3;
                            }).remove();
                            if($(".word_"+uuid).is(".has-hover"))
                                $(".word_"+uuid).append($(`<ruby>${real_word}<rt>${translation_data.data[0].reading}</rt></ruby>`));
                            else
                                $(".word_"+uuid).html(`<ruby>${real_word}<rt>${translation_data.data[0].reading}</rt></ruby>`);
                        }
                    })();
                }
            }else{
                //compare ease
                let current_card = card_data.cards[0];
                if(current_card.factor < settings.known_ease_threshold){
                    show_subtitle = true;
                    doAppend = true;
                    //translate the word
                    let translation_html = current_card.fields.Meaning.value;
                    let reading_html = current_card.fields.Reading.value;
                    hoverEl_html += `<div class="hover_translation">${translation_html}</div>`;
                    hoverEl_html += `<div class="hover_reading">${reading_html}</div>`;
                    newEl.attr("known","false");
                    if(settings.openAside) addTranslationCard(translation_html,reading_html);
                    //furigana
                    if(settings.furigana && isNotAllKana(real_word)){
                        let reading_text = reading_html;
                        // remove when see <!-- accent_start -->
                        let accent_start = reading_text.indexOf("<!-- accent_start -->");
                        if(accent_start != -1){
                            reading_text = reading_text.substring(0,accent_start);
                        }
                        newEl.html(`<ruby>${real_word}<rt>${reading_text}</rt></ruby>`);
                        hasFurigana = true;
                    }
                }else{
                    newEl.attr("known","true");
                    blurWord();
                    if(settings.hover_known_get_from_dictionary){
                        doAppendHoverLazy=true;
                    }else{
                        doAppend = true;
                        //translate the word
                        let translation_html = current_card.fields.Meaning.value;
                        let reading_html = current_card.fields.Reading.value;
                        hoverEl_html += `<div class="hover_translation">${translation_html}</div>`;
                        hoverEl_html += `<div class="hover_reading">${reading_html}</div>`;
                        hoverEl_html += `<div class="hover_ease">You know this, ease: ${current_card.factor}</div>`;
                        hoverEl.addClass("known");
                    }
                }
            }
        }
        hoverEl.html(hoverEl_html);
        if(doAppendHoverLazy){
            newEl.append(hoverEl);
            newEl.addClass("has-hover");
            hoverEl.text("Loading...");
            let hasBeenLoaded = false;
            let processing = false;
            const delayHideHoverEl = (hoverEl, newEl) => {
                setTimeout(() => {
                    if (!hoverEl[0].matches(':hover') && !newEl[0].matches(':hover')) {
                        hoverEl.removeClass('show-hover');
                    }
                }, 300);
            };
            async function showHoverEl(){
                hoveredWordTracker(word,uuid);
                $(`.hover_${uuid}`).addClass("show-hover");
                if(processing) return;
                if(hasBeenLoaded) return;
                processing = true;
                let translation_data = await getTranslation(word);
                let raw_flashcard_data = {"example":"","front":word,"pitch":"","definitions":"","image":""};
                translation_data.data.forEach((meaning)=>{
                    let reading_html = meaning.reading;
                    let translation_html = meaning.definitions;
                    hoverEl_html += `<div class="hover_translation">${translation_html}</div>`;
                    hoverEl_html += `<div class="hover_reading">${reading_html}</div>`;
                    raw_flashcard_data.definitions += `<p>${translation_html}</p>`;
                    raw_flashcard_data.definitions += `<p>${reading_html}</p>`;
                });
                if(translation_data.data.length==0) hoverEl_html = "No translation found";
                hoverEl.html(hoverEl_html);
                hasBeenLoaded = true;

                $(`.hover_${uuid}`).ready(()=>{
                    let hover_left = -($(`.hover_${uuid}`).width()-$(`.word_${uuid}`).width())/2;
                    $(`.hover_${uuid}`).css("left",`${hover_left}px`);
                });

                if(settings.enable_flashcard_creation && (translation_data.data.length!=0) && (!already_added[word])){
                    hoverEl_html += `<button class="create_flashcard">+ Anki</button>`;
                    hoverEl.html(hoverEl_html);
                    let card_creation_data = {
                        "note": {
                            "deckName": settings.flashcard_deck,
                            "modelName": "Basic",
                            "fields": {
                                "Back":"",
                                "Front": word+"<intelligent_definition style='display:none'>"+raw_flashcard_data.definitions+"</intelligent_definition>"
                            },
                            "options": {
                                "allowDuplicate": false,
                                "duplicateScope": "deck",
                                "duplicateScopeOptions": {
                                    "deckName": settings.deckName,
                                    "checkChildren": false,
                                    "checkAllModels": false
                                }
                            },
                            "tags": [
                                "intelligent-subtitles",
                                settings.language,
                                "video-"+parseSubtitleName(currentSubtitleFile)
                            ]
                        }
                    };
                    hoverEl.find(".create_flashcard").click(async function(){
                        if(already_added[word]) return;
                        //calculate actual example sentence by putting it into iframe
                        $("iframe")[0].contentWindow.document.body.innerHTML = $(".subtitles").html();
                        //remove each .subtitle_hover element
                        $("iframe").contents().find(".subtitle_hover").remove();
                        //remove each .subtitle_word element
                        $("iframe").contents().find(".subtitle_word.word_"+uuid).addClass("defined");
                        raw_flashcard_data.example = $("iframe")[0].contentWindow.document.body.innerHTML;
                        $("iframe")[0].contentWindow.document.body.innerHTML = "";

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
                            raw_flashcard_data.image = picture_data_url;
                        }catch(e){console.log(e);}
                        
                        if(createFlashcardWindow) createFlashcardWindow.close();
                        //preview
                        createFlashcardWindow = window.open("", "CreateFlashcardWindow", "width=800,height=600");
                        createFlashcardWindow.document.write(`
                        <!doctype html>
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
                        </html>
                        `);
                        $(createFlashcardWindow.document).ready(()=>{
                            //add event listener to the input checkbox
                            $("#show-img",createFlashcardWindow.document).change(()=>{
                                $(".card-item img",createFlashcardWindow.document).toggle();
                            });
                            $('.createflashcardbtn',createFlashcardWindow.document).click(async function(){
                                card_creation_data.note.fields.Back = `
                                <style>${FLASHCARD_CSS}</style>
                                <div class="card-c ${settings.dark_mode ? '':'light'}">
                                    <div class="card-item">
                                        <h1>${raw_flashcard_data.front}</h1>
                                    </div>
                                    <div class="card-item">
                                        <div class="example">
                                            <div class="sentence">${raw_flashcard_data.example}</div>
                                            <div class="translation">
                                                <p>${$('input',createFlashcardWindow.document).val()}</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="divider"></div>
                                    <div class="card-item">
                                        <div class="definition">
                                            ${$(".definition",createFlashcardWindow.document).html()}
                                        </div>
                                    </div>
                                    <div class="card-item" ${$("#show-img",createFlashcardWindow.document).is(":checked") ? "":"style='display:none'"}>
                                        <img src="${$("#show-img",createFlashcardWindow.document).is(":checked")?raw_flashcard_data.image:''}" alt="">
                                    </div>
                                </div>
                                `;
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

                    });
                }
            }
            newEl.hover(showHoverEl,async function(){
                delayHideHoverEl(hoverEl, newEl);
            });
        }
        if(doAppend){
            if(settings.colour_codes[pos])
                // hoverEl.css("box-shadow",`rgba(100, 66, 66, 0.16) 0px 1px 4px, ${settings.colour_codes[pos]} 0px 0px 0px 3px`);
                hoverEl.css("border",`${settings.colour_codes[pos]} 3px solid`);
            if(settings.show_pos){
                hoverEl.attr("data-pos",pos);
                hoverEl.css("padding-bottom","35px");
            }else{
                hoverEl.css("padding-bottom","10px");
            }

            newEl.append(hoverEl);
            newEl.addClass("has-hover");
            //calculate height
            newEl.hover(function(){
                $(`.hover_${uuid}`).addClass("show-hover");
                hoveredWordTracker(word,uuid);
                $(`.hover_${uuid}`).ready(()=>{
                    let hover_left = -($(`.hover_${uuid}`).width()-$(`.word_${uuid}`).width())/2;
                    $(`.hover_${uuid}`).css("left",`${hover_left}px`);

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
        $(".subtitles").append(newEl);
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
    await loadSettings();
    checkSettings();
    load_lang_data();


    window.electron_settings.onServerLoad((message) => {
        $(".critical-error-c").remove();
        $(".loading").addClass("not-shown");
    });
    window.electron_settings.onServerStatusUpdate((message) => {
        if(message.includes("Waiting for application startup.")){
            $("#status-update").html("Waiting for Anki");
            $(".loading .progress-bar .progress").animate({width:"50%"},300);
        }else if(message.includes("Arguments")){
            $("#status-update").html("Anki is ready");
            $(".loading .progress-bar .progress").animate({width:"100%"},300);
        }
    });
    // modify_sub();
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





window.electron_settings.onServerCriticalError((message) => {
    $(".critical-error-c").remove();
    $("body").append(`<div class="critical-error-c"><div class="critical-error"><span>${message}</span></div></div>`);
    $(".critical-error-c .restart-app").click(()=>{
        restartAppAndServer();
    });
});
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


const readSubtitleFile = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            if (file.name.endsWith('.srt')) {
                let parsed = parseSRT(content);
                parsed.forEach((sub) => {
                    sub.start = parseTime(sub.start,",");
                    sub.end = parseTime(sub.end,",");
                });
                resolve(parsed);
            } else if (file.name.endsWith('.ass')) {
                let parsed = parseASS(content);
                parsed.forEach((sub) => {
                    sub.start = parseTime(sub.start,".");
                    sub.end = parseTime(sub.end,".");
                });
                resolve(parsed);
            } else {
                reject('Unsupported file type');
            }
        };
        reader.onerror = () => reject('Error reading file');
        reader.readAsText(file);
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
const loadRecentlyWatched = () => {
    const recentlyWatched = localStorage.getItem('recentlyWatched');
    if (recentlyWatched) {
        JSON.parse(recentlyWatched).forEach(item => {
            let appendable = $(`<div class="card">
                    <img src="${item.screenshotUrl}">
                    <p>${item.name ? item.name : ""}</p>
                </div>`);
            appendable.click(()=>{
                loadStream(item.videoUrl);
            });
            $('.recently-c .recently .cards').append(appendable);
        });
    }else{
        $(".recently-c").hide();
    }
};
document.addEventListener('DOMContentLoaded', () => {
    loadRecentlyWatched();
    window.electron_settings.isLoaded();
});
setTimeout(()=>{window.electron_settings.isLoaded();},1000);

function parseSubtitleName(filename) {
    // Remove the file extension (.srt, .ass, etc.)
    let nameWithoutExtension = filename.replace(/\.(srt|ass|txt)$/i, '');

    // Improved regex to capture the series title, numbers in parentheses, episode numbers, and ignore extra details like 1080p or Subtitles.
    let regex = /^([a-zA-Z0-9\s]+)(?:\s*\((\d+)\))?(?:\s+(\d+))?(?:\s*(S\d+))?(?:\s*(EP\d+))?(?:\s*(\d+))?/i;

    // Apply the regex to the filename
    let match = nameWithoutExtension.match(regex);

    if (match) {
        // Combine the parts that matched, removing undefined parts and unnecessary descriptors
        let parsedName = match.slice(1).filter(Boolean).join(' ').trim();

        // Remove additional descriptors like 'Subtitles' and '1080p'
        parsedName = parsedName.replace(/\b(Subtitles|1080p|720p|480p|x264|BluRay|HD)\b/gi, '').trim();

        return parsedName;
    } else {
        // Return the filename without extension if no match was found
        return nameWithoutExtension;
    }
}
window.electron_settings.onLanguageInstalled(()=>{
    languageInstalledCallbacks.forEach((callback)=>{
        callback();
    });
});
window.electron_settings.onLanguageInstallError((mes)=>{
    languageInstallErrorCallbacks.forEach((callback)=>{
        callback(mes);
    });
});
const showLanguageInstallationWindow = ()=>{
    if(languageInstallationWindow) languageInstallationWindow.close();
    languageInstallationWindow = window.open("language_installation.html", "LanguageInstallationWindow", "width=600,height=250");
    languageInstallationWindow.addEventListener('load',()=>{
        $(languageInstallationWindow.document).ready(()=>{
            if(!settings.dark_mode) $(languageInstallationWindow.document.body).addClass("light");
            $(".install-language",languageInstallationWindow.document).click(()=>{
                window.electron_settings.installLanguage($("input",languageInstallationWindow.document).val());
                $(".install-language",languageInstallationWindow.document).attr("disabled",true);
                $(".install-language",languageInstallationWindow.document).text("Installing...");
                languageInstalledCallbacks.push(()=>{
                    $(".install-language",languageInstallationWindow.document).text("Installed, restart the app for changes to take effect");
                    $(".title",languageInstallationWindow.document).text("Installed!");
                    setTimeout(()=>{
                        languageInstallationWindow.close();
                        languageInstalledCallbacks = [];
                    },5000);
                });
                languageInstallErrorCallbacks.push((mes)=>{
                    $(".install-language",languageInstallationWindow.document).text("Error");
                    $(".title",languageInstallationWindow.document).text("Error!");
                    $(".small-desc",languageInstallationWindow.document).text(mes);
                    setTimeout(()=>{
                        languageInstallationWindow.close();
                        languageInstallErrorCallbacks = [];
                    },5000);
                });
            });
        });
    });
};
const restartAppAndServer = ()=>{
    if(restarting) return;
    restarting = true;
    window.electron_settings.restartApp();
    const xhr = new XMLHttpRequest();
    xhr.addEventListener('error', () => reject('failed to issue request'));
    xhr.addEventListener('load', () => {
    });

    xhr.open('POST', settings.tokeniserUrl.replace("/tokenise","/quit"));
    //send json
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send("{}");
};


window.electron_settings.onSettingsSaved((e) => {
    if(mustRestart) restartAppAndServer();
});


window.electron_settings.onServerLoad(() => {
    //only once
    if(isLoaded) return;
    isLoaded = true;
    console.log("Server loaded");
// document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('fullscreen-video');
    const playPauseButton = document.getElementById('play-pause');
    const volumeSlider = document.getElementById('volume');
    const progressBar = document.getElementById('progress-bar');
    const forwardButton = document.getElementById('forward');
    const backwardButton = document.getElementById('backward');
    const videoControls = document.getElementById('video-controls');
    const qualitySelect = document.getElementById('video-quality');

    let isDragging = false;
    let offsetX, offsetY;
    let isInteractingWithProgressBar = false;
    let hasReachedHalfPoint = false;

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
    const loadWatchTime = ()=>{
        const currentVideo = localStorage.getItem('currentVideo');
        if (currentVideo) {
            const savedTime = localStorage.getItem(`videoCurrentTime_${btoa(currentVideo)}`);
            if (savedTime) {
                video.currentTime = parseFloat(savedTime);
            }
        }
    };
    const updateVideoControlsPosition = () => {
        const centerXPercentage = ((videoControls.offsetLeft + videoControls.offsetWidth / 2) / window.innerWidth) * 100;
        const centerYPercentage = ((videoControls.offsetTop + videoControls.offsetHeight / 2) / window.innerHeight) * 100;
        videoControls.dataset.centerXPercentage = centerXPercentage;
        videoControls.dataset.centerYPercentage = centerYPercentage;
    };

    const scaleVideoControls = () => {
        const centerXPercentage = parseFloat(videoControls.dataset.centerXPercentage);
        const centerYPercentage = parseFloat(videoControls.dataset.centerYPercentage);
        videoControls.style.left = `${(centerXPercentage / 100) * window.innerWidth - videoControls.offsetWidth / 2}px`;
        videoControls.style.top = `${(centerYPercentage / 100) * window.innerHeight - videoControls.offsetHeight / 2}px`;
    };

    window.addEventListener('resize', scaleVideoControls);

    function updateBufferBar() {
        if (video.buffered.length > 0) {
            const bufferedEnd = video.buffered.end(video.buffered.length - 1);
            const duration = video.duration;
            if (duration > 0) {
                const bufferWidth = (bufferedEnd / duration) * 100;
                //change body css variable
                document.body.style.setProperty('--buffer-width', `${bufferWidth}%`);
            }
        }
    }
    const addToRecentlyWatched = (videoUrl) => {
        console.log("Adding to recently watched");
        if(playbackType === "local") return;
        console.log("Adding to recently watched 2");
        const recentlyWatched = localStorage.getItem('recentlyWatched');
        let recentlyWatchedArray = recentlyWatched ? JSON.parse(recentlyWatched) : [];

        // Create a canvas element
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const video = document.getElementById('fullscreen-video');

        // Set canvas dimensions to match the video
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        // Draw the current video frame on the canvas
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Convert the canvas to an image URL
        const screenshotUrl = canvas.toDataURL('image/png');

        // Check if the video URL is already in the array
        const existingIndex = recentlyWatchedArray.findIndex(item => item.videoUrl === videoUrl);

        // const videoName = currentSubtitleFile ? currentSubtitleFile.replace(/\(.*?\)/g, '').replace(/\.[^/.]+$/, '').replace(/subtitles?/gi,'') : "";
        const videoName = parseSubtitleName(currentSubtitleFile);

        if (existingIndex !== -1) {
            // Update the screenshot URL if the video URL is already in the array
            recentlyWatchedArray[existingIndex].screenshotUrl = screenshotUrl;
            recentlyWatchedArray[existingIndex].name = videoName;
        } else {
            // Add the new video URL and screenshot URL to the array
            recentlyWatchedArray.unshift({ videoUrl, screenshotUrl, name:videoName });
        }

        // Limit the array to the last 5 items
        if (recentlyWatchedArray.length > 5) {
            recentlyWatchedArray.pop();
        }


        // Store the updated array in localStorage
        localStorage.setItem('recentlyWatched', JSON.stringify(recentlyWatchedArray));
        console.log('Added to recently watched:', videoUrl);
    };
    const playPause = () => {
        if (video.paused) {
            video.play();
            playPauseButton.innerHTML = '<img src="assets/icons/pause.svg">';
        } else {
            video.pause();
            playPauseButton.innerHTML = '<img src="assets/icons/play.svg">';
            if(video.currentTime < (video.duration-10)) addToRecentlyWatched(currentPlayingVideo);
        }
    };
    playPauseButton.addEventListener('click', playPause);


    window.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            playPause();
        }else if(event.code === 'ArrowRight'){
            video.currentTime += 5;
        }else if(event.code === 'ArrowLeft'){
            video.currentTime -= 5;
        }
    });

    loadStream = (text) => {
        if(HLSObject) HLSObject.destroy();
        resetHoveredWordsCount();
        playbackType = "stream";
        HLSObject = new Hls();
        HLSObject.loadSource(text);
        HLSObject.attachMedia(video);
        currentPlayingVideo = text;

        $("#video-quality").removeClass("hidden");
        HLSObject.on(Hls.Events.MANIFEST_PARSED, function () {
            video.play();
            loadWatchTime();
            playPauseButton.innerHTML = '<img src="assets/icons/pause.svg">';
            video.addEventListener('loadedmetadata', () => {
                let [width, height] = [video.videoWidth, video.videoHeight];
                //max width:1200
                if (width > 1200) {
                    height = height * (1200 / width);
                    width = 1200;
                }
                window.electron_settings.resizeWindow({width: width, height: height});
            });
            const levels = HLSObject.levels;
            qualitySelect.innerHTML = '<option value="-1">Auto</option>';
            levels.forEach((level, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.text = `${level.height}p`;
                if(level.height != 0)
                    qualitySelect.appendChild(option);
            });
        });
        HLSObject.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            console.log(`Switched to level ${data.level}`);
        });

        qualitySelect.addEventListener('change', (event) => {
            HLSObject.currentLevel = parseInt(event.target.value, 10);
        });
        HLSObject.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
            console.log(`Switched to level ${data.level}`);
        });
        HLSObject.on(Hls.Events.ERROR, function (event, data) {
            if (data.fatal) {
                switch (data.type) {
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        console.log('fatal media error encountered, try to recover');
                        HLSObject.recoverMediaError();
                        break;
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        console.error('fatal network error encountered', data);
                        show_notification("Network error encountered, are you using a VPN? Is your internet connection stable?");
                        break;
                    default:
                        // cannot recover
                        show_notification("Fatal streaming error encountered, try again.");
                        HLSObject.destroy();
                        break;
                }
            }
        });

        HLSObject.on(Hls.Events.BUFFER_APPENDING, () => {
            updateBufferBar();
        });

        HLSObject.on(Hls.Events.BUFFER_APPENDED, () => {
            updateBufferBar();
        });

        HLSObject.on(Hls.Events.BUFFER_FLUSHED, () => {
            updateBufferBar();
        });
        $(".recently-c").addClass("hide");
    };
    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' && document.activeElement.tagName === 'BUTTON') {
            event.preventDefault();
        }
    });
    document.addEventListener('paste', async (event) => {
        const items = event.clipboardData.items;
        for (let item of items) {
            if (item.kind === 'file') {
                manageFiles([item.getAsFile()]);
                break;
            } else if (item.kind === 'string') {
                item.getAsString((text) => {
                    if (text.startsWith('http')) {
                        if(text.endsWith('.m3u8')){
                            if(Hls.isSupported()) {
                                loadStream(text);
                            }else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                                $("video source")[0].src = text;
                                playbackType = "stream";
                                resetHoveredWordsCount();
                                $("#video-quality").addClass("hidden");
                                video.play();
                                loadWatchTime();
                                $(".recently-c").addClass("hide");
                            }
                        }else{
                            $("video source")[0].src = text;
                            playbackType = "stream";
                            resetHoveredWordsCount();
                            $("#video-quality").addClass("hidden");
                            video.play();
                            loadWatchTime();
                            $(".recently-c").addClass("hide");
                        }
                        localStorage.setItem('currentVideo', text);
                    }
                });
                break;
            }
        }
    });
    video.addEventListener('pause', () => {
        localStorage.setItem('videoCurrentTime', video.currentTime);
    });

    // Save current time when window is closed
    window.addEventListener('beforeunload', () => {
        const currentVideo = localStorage.getItem('currentVideo');
        if (currentVideo) {
            localStorage.setItem(`videoCurrentTime_${btoa(currentVideo)}`, video.currentTime);
        }
        onVideoEnded(currentPlayingVideo);
    });
    const manageFiles = async (files) => {
        console.log(files);
        if (files.length > 0) {
            const file = files[0];
            const fileType = file.type;
            const fileName = file.name;
            if (file.type === 'video/mp4') {
                $("video source")[0].src = URL.createObjectURL(file);
                playbackType = "local";
                resetHoveredWordsCount();
                $("#video-quality").addClass("hidden");
                video.load();
                video.play();
                loadWatchTime();
                $(".recently-c").addClass("hide");
                localStorage.setItem('currentVideo', file.name);
                playPauseButton.innerHTML = '<img src="assets/icons/pause.svg">';
                video.addEventListener('loadedmetadata', () => {
                    let [width, height] = [video.videoWidth, video.videoHeight];
                    if(width>1200){
                        height = height * (1200/width);
                        width = 1200;
                    }
                    window.electron_settings.resizeWindow({width: width, height: height});
                });
            } else if (fileName.endsWith('.srt') || fileName.endsWith('.ass')) {
                console.log('Subtitle file dropped:', fileName);
                let temp = await readSubtitleFile(file);
                currentSubtitleFile = fileName;
                // sort subtitles by starting time
                subs = temp.sort((a, b) => a.start - b.start);
                console.log(subs);
                if(video.currentTime >= 10){
                    addToRecentlyWatched(currentPlayingVideo);
                }
            } else {
                $(".critical-error-c").remove();
                $("body").append(`<div class="critical-error-c"><div class="critical-error"><span>Error: <br>Please drop a .mp4, .srt or .ass file.</span></div></div>`);
                setTimeout(()=>{
                    $(".critical-error-c").remove();
                },5000);
            }
        }
    };
    document.body.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        $(".critical-error-c").remove();
        manageFiles(e.dataTransfer.files);
    });

    volumeSlider.addEventListener('input', () => {
        video.volume = volumeSlider.value;
    });
    videoTimeUpdateCallback = () => {
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

        progressBar.addEventListener('input', () => {
        const time = (progressBar.value / 1000) * video.duration;
        video.currentTime = time;
    });
    video.addEventListener('ended', () => {
        onVideoEnded(currentPlayingVideo);
    });

    progressBar.addEventListener('mousedown', () => {
        isInteractingWithProgressBar = true;
    });
    volumeSlider.addEventListener('mousedown', () => {
        isInteractingWithProgressBar = true;
    });

    progressBar.addEventListener('mouseup', () => {
        isInteractingWithProgressBar = false;
    });
    volumeSlider.addEventListener('mouseup', () => {
        isInteractingWithProgressBar = false;
    });

    forwardButton.addEventListener('click', () => {
        video.currentTime += 10; // Skip forward 10 seconds
    });

    backwardButton.addEventListener('click', () => {
        video.currentTime -= 10; // Skip backward 10 seconds
    });

    videoControls.addEventListener('mousedown', (e) => {
        if (!isInteractingWithProgressBar) {
            isDragging = true;
            offsetX = e.clientX - videoControls.getBoundingClientRect().left;
            offsetY = e.clientY - videoControls.getBoundingClientRect().top;
            videoControls.style.cursor = 'grabbing';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;

            // Ensure the controls stay within the window bounds
            const minLeft = 0;
            const minTop = 0;
            const maxLeft = window.innerWidth - videoControls.offsetWidth;
            const maxTop = window.innerHeight - videoControls.offsetHeight;

            if (newLeft < minLeft) newLeft = minLeft;
            if (newTop < minTop) newTop = minTop;
            if (newLeft > maxLeft) newLeft = maxLeft;
            if (newTop > maxTop) newTop = maxTop;

            videoControls.style.left = `${(newLeft / window.innerWidth) * 100}%`;
            videoControls.style.top = `${(newTop / window.innerHeight) * 100}%`;
            videoControls.style.transform = 'none'; // Disable centering transform
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        videoControls.style.cursor = 'default';
        updateVideoControlsPosition();
    });

    updateVideoControlsPosition();
    scaleVideoControls(); // Ensure correct initial position


    let hideControlsTimeout;

    const showControls = () => {
        videoControls.classList.add('visible');
        document.body.classList.remove('hide-cursor');
        window.electron_settings.changeTrafficLights(true);
        clearTimeout(hideControlsTimeout);
        hideControlsTimeout = setTimeout(() => {
            videoControls.classList.remove('visible');
            document.body.classList.add('hide-cursor');
            window.electron_settings.changeTrafficLights(false);
        }, 2000); // Hide controls after 2 seconds of inactivity
    };

    document.addEventListener('mousemove', showControls);

    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });




    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        window.electron_settings.showCtxMenu();
    });
    if(settings.openAside){
        $(".aside").show();
    }else{
        $(".aside").hide();
    }

    window.electron_settings.onOpenAside(()=>{
        $(".aside").show();
        settings.openAside = true;
        saveSettings();
    });
    $(".aside .close").click(()=>{
        $(".aside").hide();
        settings.openAside = false;
        saveSettings();
    });
    window.electron_settings.onContextMenuCommand((cmd)=>{
        switch(cmd){
            case 'sync-subs':
                $(".sync-subs").removeClass("not-shown");
                $(".sync-subs input").val(settings.subsOffsetTime.toFixed(2));
                break;
            case 'copy-sub':
                //copy lastSub
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

});




window.electron_settings.onOpenSettings((msg)=>{
    if(isSettingsWindowOpen) return;
    isSettingsWindowOpen = true;
    let myWindow = window.open("", "SettingsWindow", "width=800,height=600");
    myWindow.document.write(WINDOW_HTML_SETTINGS);
    myWindow.window.addEventListener('unload', () => {
        isSettingsWindowOpen = false;
        myWindow = null;
    });

    let new_document = myWindow.document;
    let current_category = msg ? msg : "General";





    const makeMenu = async () => {
        console.log("Making menu");
        //add class to body
        if(settings.dark_mode) new_document.body.classList.remove("light");
        else new_document.body.classList.add("light");

        const flashcard_decks = async function() {
            if ($('#enable_flashcard_creation',new_document).is(':checked')) {
                $('.flashcard_deck',new_document).removeClass('hidden');
                //show flashcards_add_picture
                $('#flashcards_add_picture',new_document).parent().parent().removeClass('hidden');
                //get flashcard decks
                $('#flashcard_deck',new_document).html('<option value="Loading...">Loading...</option>');
                let flashcard_decks = await sendRawToAnki({"action":"deckNamesAndIds","version":6});
                $('#flashcard_deck',new_document).html('');
                for(let deck of Object.keys(flashcard_decks.result)){
                    $('#flashcard_deck',new_document).append(`<option value="${deck}" ${deck==settings.flashcard_deck ? 'selected' : ''}>${deck}</option>`);
                }
            } else {
                $('.flashcard_deck',new_document).addClass('hidden');
                $('#flashcards_add_picture',new_document).parent().parent().addClass('hidden');
            }
        };
        const disabled_fields = Object.keys(lang_data[settings.language].fixed_settings);
        $('._1', new_document).append($(`<label for="known_ease_threshold">Known Ease Threshold: </label>`));
        $('._1', new_document).append($(`<label for="blur_words">Blur Words </label>`));
        $('._1', new_document).append($(`<label for="blur_known_subtitles">Blur Known Subtitles </label>`));
        $('._1', new_document).append($(`<label for="blur_amount" class="${settings.blur_known_subtitles || settings.blur_words ? '' : 'disabled'}">Blur Amount: </label>`));
        $('._1', new_document).append($(`<label for="immediateFetch">(Requires Fast Internet) Translate all words online </label>`));
        $('._1', new_document).append($(`<label for="do_colour_known">Colour Known Words</label>`));
        $('._1', new_document).append($(`<label for="colour_known" class="${settings.do_colour_known ? '' : 'disabled'}">Known Word Colour: </label>`));
        $('._1', new_document).append($(`<label for="do_colour_codes">Do Colour Codes </label>`));
        $('._1', new_document).append($(`<label for="show_pos">Show word type </label>`));
        $('._1', new_document).append($(`<label for="hover_known_get_from_dictionary">Find new definitions for known words </label>`));
        $('._1', new_document).append($(`<label for="dark_mode">Dark Mode </label>`));
        $('._1', new_document).append($(`<label for="use_anki">(Requires Restart) Use Anki </label>`));
        $('._1', new_document).append($(`<label for="anki_connect_url">(Requires Restart) Anki Connect URL </label>`));
        $('._1', new_document).append($(`<label for="furigana">Furigana </label>`));
        $('._1', new_document).append($(`<label for="enable_flashcard_creation">Enable flashcard creations </label>`));
        $('._1', new_document).append($(`<label for="flashcard_deck" class="${settings.enable_flashcard_creation ? '' : 'disabled'}">Flashcard Deck: </label>`));
        $('._1', new_document).append($(`<label for="language">(Requires Restart) Subtitle Language: </label>`));
        $('._1', new_document).append($(`<label for="aside-auto">(Requires Fast Internet) Open Automatic Subtitle Translation Drawer </label>`));;
        $('._1', new_document).append($(`<label for="subtitle_theme">Subtitle Theme </label>`));
        $('._1', new_document).append($(`<label for="subtitle_font_size">Subtitle Font Size </label>`));

        $('._2', new_document).append($(`<input type="number" id="known_ease_threshold" name="known_ease_threshold" value="${settings.known_ease_threshold}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="blur_words" name="blur_words" ${settings.blur_words ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="blur_known_subtitles" name="blur_known_subtitles" ${settings.blur_known_subtitles ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="number" id="blur_amount" name="blur_amount" value="${settings.blur_amount}" class="${settings.blur_known_subtitles || settings.blur_words ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="immediateFetch" name="immediateFetch" ${settings.immediateFetch ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="do_colour_known" name="do_colour_known" ${settings.do_colour_known ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="color" id="colour_known" name="colour_known" value="${settings.colour_known}" class="${settings.do_colour_known ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="do_colour_codes" name="do_colour_codes" ${settings.do_colour_codes ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="show_pos" name="show_pos" ${settings.show_pos ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="hover_known_get_from_dictionary" name="hover_known_get_from_dictionary" ${settings.hover_known_get_from_dictionary ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="dark_mode" name="dark_mode" ${settings.dark_mode ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="use_anki" name="use_anki" ${settings.use_anki ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="text" id="anki_connect_url" name="anki_connect_url" class="${settings.use_anki ? '' : 'disabled'}" value="${settings.ankiConnectUrl}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="furigana" name="furigana" ${settings.furigana ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<input type="checkbox" id="enable_flashcard_creation" name="enable_flashcard_creation" ${settings.enable_flashcard_creation ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<select id="flashcard_deck" name="flashcard_deck" class="${settings.enable_flashcard_creation ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<select id="language" name="language">

            ${supported_languages.map((lang)=>{
            return `<option value="${lang}" ${settings.language==lang ? 'selected' : ''}>${lang_data[lang].name_translated}</option>`;
        })}
        </select>`));
        $('._2', new_document).append($(`<input type="checkbox" id="flashcards_add_picture" name="flashcards_add_picture" ${settings.flashcards_add_picture ? 'checked' : ''} class="${settings.enable_flashcard_creation ? '' : 'disabled'}">`));
        $('._2', new_document).append($(`<input type="checkbox" id="aside-auto" name="aside-auto" ${settings.openAside ? 'checked' : ''}>`));
        $('._2', new_document).append($(`<select id="subtitle_theme" name="subtitle_theme">${SUBTITLE_THEMES.map((theme)=>{return `<option value="${theme}" ${settings.subtitle_theme==theme ? 'selected' : ''}>${theme}</option>`})}</select>`));
        $('._2', new_document).append($(`<input type="number" id="subtitle_font_size" name="subtitle_font_size" value="${settings.subtitle_font_size}">`));
        $('._2',new_document).append('<input type="button" id="install_languages" value="Install Additional Languages...">');

        //disable fields
        for(let field of disabled_fields){
            $(`#${field}`,new_document).attr('disabled',true);
            $(`[for="${field}"]`,new_document).attr('disabled',true);
        }

        $("a#contact",new_document).click((e)=>{
            e.preventDefault();
            window.electron_settings.showContact();
        });
        $("a#licenses",new_document).click((e)=>{
            e.preventDefault();
            window.open("licenses.html", "LicensesWindow", "width=800,height=600");
        });
        if(settings.do_colour_codes)
        for (let code in settings.colour_codes) {
            $('._1',new_document).append(`<label for="${code}" data-show="Customization">${code}</label>`);
            $('._2',new_document).append(`
                <input type="color" id="${code}" name="${code}" value="${settings.colour_codes[code]}" data-show="Customization">
            `);
        }
        flashcard_decks();
        // Add a button to the form in the context menu
        $('._2',new_document).append('<input type="button" id="restoreDefaults" value="Restore Defaults">');
        $('#blur_known_subtitles, #blur_words',new_document).on('change', function() {
            if ($('#blur_known_subtitles',new_document).is(':checked') || $('#blur_words',new_document).is(':checked')) {
                $('#blur_amount',new_document).removeClass('hidden');
                $('[for="blur_amount"]',new_document).removeClass('hidden');
            } else {
                $('#blur_amount',new_document).addClass('hidden');
                $('[for="blur_amount"]',new_document).addClass('hidden');
            }
        });

        $('#do_colour_known',new_document).on('change', function() {
            if ($('#do_colour_known',new_document).is(':checked')) {
                $('#colour_known',new_document).removeClass('hidden');
                $('[for="colour_known"]',new_document).removeClass('hidden');
            } else {
                $('#colour_known',new_document).addClass('hidden');
                $('[for="colour_known"]',new_document).addClass('hidden');
            }
        });
        $('#do_colour_codes',new_document).on('change', function() {
            if ($('#do_colour_codes',new_document).is(':checked')) {
                $('.controls-colour-codes',new_document).removeClass('hidden');
            } else {
                $('.controls-colour-codes',new_document).addClass('hidden');
            }
        });
        $('#enable_flashcard_creation',new_document).on('change', flashcard_decks);
        // Add an event listener to the button
        $('#restoreDefaults',new_document).on('click', function() {
            settings = DEFAULT_SETTINGS;
            //add colour codes too
            settings.colour_codes = lang_data[settings.language].colour_codes;
            checkSettings();
            saveSettings();
            myWindow.close();
        });
        const updateSubtitlePreview = ()=>{
            settings.subtitleTheme = $('#subtitle_theme',new_document).val();
            settings.subtitle_font_size = Number($('#subtitle_font_size',new_document).val());
            //set subtitle font size
            new_document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
            document.documentElement.style.setProperty('--subtitle-font-size', `${settings.subtitle_font_size}px`);
            document.documentElement.style.setProperty('--word-blur-amount', `${settings.blur_amount}px`);
            SUBTITLE_THEMES.forEach((theme)=>{
                $(".subtitles",new_document).removeClass("theme-"+theme);
                $(".subtitles",document).removeClass("theme-"+theme);
            });
            //set subtitle theme
            $(".subtitles",new_document).addClass("theme-"+settings.subtitleTheme);
            $(".subtitles",document).addClass("theme-"+settings.subtitleTheme);
        };
        updateSubtitlePreview();
        $("#subtitle_theme,#subtitle_font_size",new_document).change(()=>{
            console.log("Updating subtitle preview");
            updateSubtitlePreview();
        });
        $('#install_languages',new_document).on('click', function() {
            showLanguageInstallationWindow();
        });

        $('._2',new_document).append('<input type="button" id="save" value="Save">');
        // Update settings on form submit
        $('#save',new_document).on('click', function(e) {
            e.preventDefault();
            let restart = false;
            settings.known_ease_threshold = Number($('#known_ease_threshold',new_document).val());
            settings.blur_words = $('#blur_words',new_document).is(':checked');
            settings.blur_known_subtitles = $('#blur_known_subtitles',new_document).is(':checked');
            settings.blur_amount = Number($('#blur_amount',new_document).val());
            settings.immediateFetch = $('#immediateFetch',new_document).is(':checked');
            settings.colour_known = $('#colour_known',new_document).val();
            settings.do_colour_known = $('#do_colour_known',new_document).is(':checked');
            settings.do_colour_codes = $('#do_colour_codes',new_document).is(':checked');
            settings.hover_known_get_from_dictionary = $('#hover_known_get_from_dictionary',new_document).is(':checked');
            settings.dark_mode = $('#dark_mode',new_document).is(':checked');
            settings.show_pos = $('#show_pos',new_document).is(':checked');
            if(settings.language != $('#language',new_document).val()){
                restart = true;
            }
            settings.language = $('#language',new_document).val();
            settings.use_anki = $('#use_anki',new_document).is(':checked');
            if(settings.use_anki != $('#use_anki',new_document).is(':checked')){
                restart = true;
            }
            settings.ankiConnectUrl = $('#anki_connect_url',new_document).val();
            if(settings.ankiConnectUrl != $('#anki_connect_url',new_document).val()){
                restart = true;
            }
            settings.furigana = $('#furigana',new_document).is(':checked');
            settings.enable_flashcard_creation = $('#enable_flashcard_creation',new_document).is(':checked');
            settings.flashcard_deck = $('#flashcard_deck',new_document).val();
            settings.flashcards_add_picture = $('#flashcards_add_picture',new_document).is(':checked');
            settings.openAside = $('#aside-auto',new_document).is(':checked');
            settings.subtitleTheme = $('#subtitle_theme',new_document).val();
            settings.subtitle_font_size = Number($('#subtitle_font_size',new_document).val());

            for (let code in settings.colour_codes) {
                settings.colour_codes[code] = $(`#${code}`,new_document).val();
            }
            if(settings.openAside){
                $(".aside").show();
            }else{
                $(".aside").hide();
            }
            checkSettings();
            saveSettings();
            myWindow.close();
            mustRestart = restart;
        });
    };
    $(new_document).ready(async function(){
        makeMenu();
        const updateSettings = ()=>{
            let to_show = IN_SETTINGS_CATEGORY[current_category];
            $("._1,._2",new_document).show();
            $(".preview",new_document).hide();
            $(".settingsMenuContent ._1 > *, .settingsMenuContent ._2 > *, .about",new_document).hide();
            to_show.forEach((item)=>{
                $(`#${item}`,new_document).show();
                $(`[for="${item}"]`,new_document).show();
            });
            $(`[data-show="${current_category}"]`,new_document).show();
            if(current_category=="About"){
                $(".about",new_document).show();
                $("._1,._2",new_document).hide();
            }
        };
        $(".nav-item",new_document).click(function(){
            $(".nav-item",new_document).removeClass("selected");
            $(this,new_document).addClass("selected");
            current_category = $(this,new_document).attr("id");
            updateSettings();
        });
        updateSettings();
    });
});