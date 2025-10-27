import {displayFlashcard} from "./display.js";
import {review} from "../SRS/review.js";
import {openConnection} from "../connect/openConnection.js";

let myWindow = null;
let hasLoaded = false;
$(".review-flashcards").on("click", () => {
    if(myWindow) return;
    myWindow = window.open("flashcards.html", "FlashcardWindow", "width=800,height=600");
    const winRef = myWindow;
    winRef.addEventListener('unload', () => {
        if(!hasLoaded) return;
        if (myWindow === winRef) myWindow = null;
        hasLoaded = false;
    });
    winRef.onload = () => {
        hasLoaded = true;
        review();
    };
});
export function closeWindow(){
    myWindow.close();
}

window.mLearnIPC.onReviewFlashcardRequest(()=>{
    $(".review-flashcards").trigger("click");
});

if (window.mLearnIPC && typeof window.mLearnIPC.onFlashcardConnectOpen === "function") {
    window.mLearnIPC.onFlashcardConnectOpen(() => {
        openConnection();
    });
}

export function getDocument(){return myWindow.document;}