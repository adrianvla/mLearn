import J from '../../../lib/jquery.min.js';
import {getDocument} from "./window.js";
import {lang_data, settings, wordFreq} from "../../settings/settings.js";
import {isNotAllKana} from "../../utils.js";
import {buildPitchAccentHtml, getPitchAccentInfo} from "../../common/pitchAccent.js";
export const $ = s=>J(s,getDocument());

export const addPitchAccent = (accent_type, word_in_letters, real_word, pos) => {
    //append to newEl inside an element
    console.log("Adding pitch accent", accent_type, word_in_letters, real_word, pos);
    const accentInfo = getPitchAccentInfo(accent_type, word_in_letters);
    const buildBasicRuby = () => {
        if(isNotAllKana(real_word)){
            return $(`<ruby>${real_word}<rt>${word_in_letters}</rt></ruby>`);
        }
        return $(`<span>${real_word}</span>`);
    };

    const shouldSkipAccent = (
        accent_type === undefined || accent_type === null ||
        !accentInfo
    );

    if(shouldSkipAccent){
        return buildBasicRuby();
    }
    // if(settings.lang )
    let el = $('<div class="mLearn-pitch-accent"></div>');//we'll draw everything after
    // 0: Heiban (平板) - Flat, ↓↑↑↑↑(↑)
    // 1: Atamadaka (頭高) - ↑↓↓↓↓↓↓↓(↓)
    // 2: Nakadaka (中高) - ↓↑↓↓↓↓↓↓(↓)
    // 3: Odaka (尾高) - ↓↑↑↑↑(↓)
    // >=4: drop after accent_type mora
    const html_string = buildPitchAccentHtml(accentInfo, real_word.length, {
        includeParticleBox: !(pos === "動詞"),
    });
    el.html(html_string);



    let newEl = null;//$(`<ruby>${real_word}<rt>${word_in_letters}</rt></ruby>`) : $(`<span>${real_word}</span>`);
    if(isNotAllKana(real_word)){
        //there is furigana, so we need to add the pitch accent to the furigana
        //find furigana in newEl
        newEl = $(`<ruby>${real_word}<rt style="--pitch-accent-height: 2px">${word_in_letters}${el[0].outerHTML}</rt></ruby>`);
    }else{
        newEl = $(`<span style="--pitch-accent-height: 5px">${real_word}${el[0].outerHTML}</span>`);
    }
    return newEl;
}

export function displayFlashcard(card){
    /* Flashcards look like this:
        {
            "content":{
                "word":"感じ",
                "pitchAccent":0,
                "pronunciation":"かんじ",
                "translation":"Feeling, sense, impression",
                "definition":"HTML BEGIN CONTENT",
                "example":"こういう感じだった",
                "exampleMeaning":"MEANING",
                "screenshotUrl":"no",
                "pos": "名詞",
                "level": -1
            },
            "dueDate":1755100026393,
            "lastReviewed":1755100026393,
            "ease":0,
            "reviews":0
        }
    * */
    console.log("Displaying flashcard", card);
    $(".answer").hide().html(card.content.translation);
    $(".pill").show();
    $(".question").html(card.content.word);
    $(".sentence").html(card.content.example);
    $(".definition").html(card.content.definition);
    $(".card-item:has(.definition)").hide();
    $(".example .translation p").html("");
    $(".card-item img").attr("src", card.content.screenshotUrl);
    $(".card-c").css("padding-top", "10px").css("padding-bottom", "10px");
    if(["","-"," "].includes(card.content.example)) $(".card-item:has(.example)").hide();
    else $(".card-item:has(.example)").show();
    $(".divider").hide();
    if(card.content.level >= 0)
        $(".pill").html(wordFreq[card.content.word]?.level || lang_data[settings.language]?.freq_level_names[card.content.level] || "NOT FOUND").attr("level",card.content.level).show();
    else $(".pill").hide();
}
let scroll_interval = null;
export function revealAnswer(card){
    clearInterval(scroll_interval);
    $(".answer,.divider").show();
    $(".card-c").css("padding-top", "0px").css("padding-bottom", "20px");
    $(".question").html("").append(addPitchAccent(card.content.pitchAccent, card.content.pronunciation, card.content.word, card.content.pos));
    $(".example .translation p").html(card.content.exampleMeaning);
    $(".card-item:has(.definition)").show();
    scroll_interval = setInterval(()=>{
        $(getDocument().querySelector(".content")).css("overflow-y", "hidden");
        getDocument().querySelector(".content").scrollTo(0,0);
    },1);
    setTimeout(()=> {
        clearInterval(scroll_interval);
        $(getDocument().querySelector(".content")).css("overflow-y", "auto");
    }, 100);
}