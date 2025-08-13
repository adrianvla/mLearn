import {video} from "../playback/elements.js";
import {getCards, sendRawToAnki} from "../networking.js";
import {currentPlayingVideo, isCurrentlyPlayingVideo, onVideoEnded} from "../playback/streaming.js";

let knownAdjustment = {};
let alreadyUpdatedInAnki = {};
const saveKnownAdjustment = () => {
    //save knownAdjustment to localStorage
    localStorage.setItem("knownAdjustment", JSON.stringify(knownAdjustment));
};
const saveAlreadyUpdatedInAnki = () => {
    //save alreadyUpdatedInAnki to localStorage
    localStorage.setItem("alreadyUpdatedInAnki", JSON.stringify(alreadyUpdatedInAnki));
};

const loadKnownAdjustment = () => {
    //load knownAdjustment from localStorage
    let data = localStorage.getItem("knownAdjustment");
    if(data){
        knownAdjustment = JSON.parse(data);
        window.knownAdjustment = knownAdjustment;
    }else{
        knownAdjustment = {};
    }
};
const loadAlreadyUpdatedInAnki = () => {
    //load alreadyUpdatedInAnki from localStorage
    let data = localStorage.getItem("alreadyUpdatedInAnki");
    if(data){
        alreadyUpdatedInAnki = JSON.parse(data);
    }else{
        alreadyUpdatedInAnki = {};
    }
};
const changeKnownStatus = (word, status) => {
    knownAdjustment[word] = status;
    saveKnownAdjustment();
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

function setKnownAdjustment(word, status) {
    knownAdjustment[word] = status;
}


const updateFlashcardsAnkiDate = () => {
    console.log("Updating flashcards due date");
    /*
    wordList.forEach(async (word)=>{
        if(!word.new){
            //update due date
            let response = await sendRawToAnki({"action":"setSpecificValueOfCard","version":6,"params":{"card":word.id,"keys":["due"],"newValues":[0]},"warning_check":true});
            if(response.error){
                console.log("Failed to update due date of flashcard for word: "+word.word);
            }
        }
    });*/
    Object.keys(knownAdjustment).forEach(async (word)=>{
        console.log("Updating flashcard for word: "+word);
        const status = getKnownStatus(word);
        let hasBeenUpdated = false;
        if(word in alreadyUpdatedInAnki){
            hasBeenUpdated=alreadyUpdatedInAnki[word];
        }
        if(status>0 && !hasBeenUpdated){ //TODO: the script is maybe not doing anything to the card, even tho they appeared in the "to review" list
            let card = await getCards(word);
            if(card.poor) return;
            //todo: do the call for all cards that match the word
            const cardsToDo = 1;
            let cardIndex = 0;
            for (const card of cards.cards) { // Iterate through all matching cards
                cardIndex++;
                if (card.word === word) { // Ensure the card's word matches the current word
                    try {
                        const response = await sendRawToAnki({
                            action: "setSpecificValueOfCard",
                            version: 6,
                            params: {
                                card: card.cardId,
                                keys: ["due"],
                                newValues: [0]
                            },
                            warning_check: true
                        });

                        if (response.error) {
                            console.log("Failed to update due date of flashcard for word: " + word);
                        } else {
                            alreadyUpdatedInAnki[word] = true;
                        }
                    } catch (error) {
                        console.error("Error updating card:", error);
                    }
                }

                if(cardIndex>=cardsToDo) break;
            }
        }
    });
    saveAlreadyUpdatedInAnki();
}
const loadWatchTime = ()=>{
    //FIXME: strange drag'n'drop bug where the file name is the previous file name. Occurred only once.
    const currentVideo = localStorage.getItem('currentVideo');
    console.log("currentVideo", currentVideo);
    if (currentVideo) {
        const savedTime = localStorage.getItem(`videoCurrentTime_${btoa(currentVideo)}`);
        console.log("savedTime", savedTime);
        if (savedTime) {
            video.currentTime = parseFloat(savedTime);
            console.log("videoCurrentTime_" + btoa(currentVideo), parseFloat(savedTime));
        }
    }
};
// Save current time when window is closed
window.addEventListener('beforeunload', () => {
    const currentVideo = localStorage.getItem('currentVideo');
    if (currentVideo && isCurrentlyPlayingVideo) {
        localStorage.setItem(`videoCurrentTime_${btoa(currentVideo)}`, video.currentTime);
    }
    onVideoEnded(currentPlayingVideo, false);
});

export {saveKnownAdjustment, saveAlreadyUpdatedInAnki, loadKnownAdjustment, loadAlreadyUpdatedInAnki, changeKnownStatus, getKnownStatus, setKnownAdjustment,updateFlashcardsAnkiDate, loadWatchTime, knownAdjustment}