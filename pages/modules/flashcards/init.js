import './storage.js';
import $ from '../../lib/jquery.min.js';

$(".review-flashcards").on("click", () => {
    console.log("Review flashcards clicked");
    let myWindow = window.open("flashcards.html", "FlashcardWindow", "width=800,height=600");
    myWindow.window.addEventListener('unload', () => {
        myWindow = null;
    });
});