import J from '../../../lib/jquery.min.js';
import {getDocument} from "./window.js";
import {settings, wordFreq} from "../../settings/settings.js";
import {isNotAllKana} from "../../utils.js";
export const $ = s=>J(s,getDocument());


const addPitchAccent = (accent_type, word_in_letters, real_word, pos) => {
    //append to newEl inside an element
    if(accent_type === undefined || accent_type === null) return; //no pitch accent
    if(real_word.length <= 1 || word_in_letters.length <= 1) return; //no pitch accent for single letters
    // if(settings.lang )
    let el = $('<div class="mLearn-pitch-accent"></div>');//we'll draw everything after
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

    if(!(pos === "動詞")){
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
    $(".answer").hide().html(card.content.translation);
    $(".question").html(card.content.word);
    $(".sentence").html(card.content.example);
    $(".definition").html(card.content.definition);
    $(".card-item:has(.definition)").hide();
    $(".example .translation p").html("");
    $(".card-item img").attr("src", card.content.screenshotUrl);
    if(card.content.word in wordFreq)
        $(".pill").html(wordFreq[card.content.word].level).attr("level",card.content.level).show();
    else $(".pill").hide();
}

export function revealAnswer(card){
    $(".answer").show();
    $(".question").html("").append(addPitchAccent(card.content.pitchAccent, card.content.pronunciation, card.content.word, card.content.pos));
    $(".example .translation p").html(card.content.exampleMeaning);
    $(".card-item:has(.definition)").show();
}