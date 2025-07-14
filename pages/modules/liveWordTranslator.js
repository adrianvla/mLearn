import $ from '../jquery.min.js'
import {toUniqueIdentifier} from "./utils.js";
let asideTimeout = null;
let alreadyDisplayingCards = {};

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

export {addTranslationCard};