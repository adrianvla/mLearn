import {Flashcards, saveFlashcards} from "../storage.js";
import {$, displayFlashcard, revealAnswer} from "../front-end/display.js";
import {closeWindow, getDocument} from "../front-end/window.js";
import {openConnection} from "../connect/openConnection.js";
import {toUniqueIdentifier} from "../../utils.js";

function sortByDueDate(fs) {
    fs.flashcards.sort((a, b) => a.dueDate - b.dueDate);
    saveFlashcards();
    return fs;
}

function getAnticipatedDueDate(_fc, q) {
    // SM-2
    const fc = JSON.parse(JSON.stringify(_fc));

    // Time constants
    const minute = 60 * 1000;
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Normalize ease factor (EF) — default to a sane SM-2 starting value
    const currentEF = typeof fc.ease === 'number' && fc.ease > 0 ? fc.ease : 2.5;
    // SM-2 EF update formula based on quality (q in 0..5), clamped to 1.3 minimum
    let newEF = currentEF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    newEF = Math.max(1.3, newEF);

    // Previous scheduled interval (not elapsed) — avoids minute-scale drift
    const lastReviewed = typeof fc.lastReviewed === 'number' ? fc.lastReviewed : now;
    const dueDate = typeof fc.dueDate === 'number' ? fc.dueDate : lastReviewed;
    const prevInterval = Math.max(0, dueDate - lastReviewed);

    let interval;

    if (q === 0){
        interval = 0;
    }else if (q < 3) {
        // Failed/hard: short retry step (learning)
        interval = 10 * minute;
        // Keep reviews count as-is on a fail (common behavior)
    } else {
        // Passed: handle first and second reviews with fixed steps, then scale
        const reviews = typeof fc.reviews === 'number' ? fc.reviews : 0;

        if (reviews === 0) {
            // First successful review: 1 day for good, 4 days for easy
            interval = q >= 5 ? 4 * day : 1 * day;
        } else if (reviews === 1) {
            // Second successful review: 6 days for good, 10 days for easy
            interval = q >= 5 ? 10 * day : 6 * day;
        } else {
            // Subsequent reviews: multiply previous scheduled interval by EF
            const base = prevInterval > 0 ? prevInterval : 1 * day;
            interval = Math.round(base * newEF);
        }
    }

    // Update fields for the returned copy
    fc.ease = newEF;
    fc.lastReviewed = now;
    fc.dueDate = now + interval;
    if (q >= 3) {
        fc.reviews = (typeof fc.reviews === 'number' ? fc.reviews : 0) + 1;
    }
    fc.lastUpdated = now;
    return fc;
}

function updateDueDate(fc, q) {
    fc = getAnticipatedDueDate(fc,q);
    return fc;
}

function dateToInString(date){
    const now = Date.now();
    let diff = date - now;
    if (diff < 0) diff = 0;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const year = 365.25 * day;
    if (diff < minute) return '< 1m';
    if (diff < hour) return `${Math.round(diff / minute)}m`;
    if (diff < day) return `${Math.round(diff / hour)}h`;
    if (diff < year) return `${Math.round(diff / day)} days`;
    return `${(diff / year).toFixed(1)} years`;
}


export const review = () => {
    let fs = sortByDueDate(Flashcards());

    let flashcardsToGoThrough = 0;
    function getFlashcardsLeft(){
        for(flashcardsToGoThrough = 0;flashcardsToGoThrough < fs.flashcards.length;flashcardsToGoThrough++) {
            if (fs.flashcards[flashcardsToGoThrough].dueDate > Date.now()) break;
        }
    }
    getFlashcardsLeft();

    function displayLast(){
        fs = sortByDueDate(fs);
        $(".btn.again,.btn.hard,.btn.medium,.btn.easy,.btn.already-known").hide();
        $(".btn.show-answer").show();
        if(fs.flashcards.length === 0) { //TODO: change this
            closeWindow();
            alert("No flashcards to review");
            return;
        }
        getFlashcardsLeft();
        $(".p .to-review").text(flashcardsToGoThrough);
        if(fs.flashcards[0].dueDate <= Date.now()){
            displayFlashcard(fs.flashcards[0]);
            $(".btn.again").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 0).dueDate)}`);
            $(".btn.hard").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 1).dueDate)}`);
            $(".btn.medium").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 3).dueDate)}`);
            $(".btn.easy").attr("data-content",`${dateToInString(getAnticipatedDueDate(fs.flashcards[0], 5).dueDate)}`);
            $(".btn.already-known").attr("data-content",`∞`);
        }else{
            closeWindow();
            alert("All flashcards have been reviewed");
        }
    }
    displayLast();
    function updateFlashcard(q){
        fs.flashcards[0] = updateDueDate(fs.flashcards[0], q);
        displayLast();
    }
    async function removeFlashcard(){
        if(fs.flashcards.length === 0) return;
        const uuid = await toUniqueIdentifier(fs.flashcards[0].content.word);
        fs.knownUnTracked[uuid] = true;
        fs.flashcards.shift();
        displayLast();
    }
    let isInEditMode = false;
    let isInCreateMode = false;
    $(getDocument()).on('keydown', (e) => {
        console.log(e.key);
        if(isInEditMode || isInCreateMode) return;
        switch(e.key){
            case "1":
                $(".btn.again").click();
                break;
            case "2":
                $(".btn.hard").click();
                break;
            case "3":
                $(".btn.medium").click();
                break;
            case "4":
                $(".btn.easy").click();
                break;
            case "-":
                $(".btn.already-known").click();
                break;
            case " ":
                $(".btn.show-answer").click();
                break;
        }
    });

    $(".btn.again").on('click',()=>{
        updateFlashcard(0);
    });
    $(".btn.hard").on('click',()=>{
        updateFlashcard(1);
    });
    $(".btn.medium").on('click',()=>{
        updateFlashcard(3);
    });
    $(".btn.easy").on('click',()=>{
        updateFlashcard(5);
    });
    $(".btn.already-known").on('click',()=>{
        removeFlashcard();
    });
    $(".btn.show-answer").on('click',()=>{
        $(".btn.again,.btn.hard,.btn.medium,.btn.easy,.btn.already-known").show();
        $(".btn.show-answer").hide();
        revealAnswer(fs.flashcards[0]);
    });
    $(".btn.bin").on('click',()=>$(".btn.already-known").click());
    $(".btn.close").on('click',closeWindow);

    $(".btn.connect").on('click',openConnection);

    $(".editMode").hide();
    $(".btn.edit").on('click',()=>{
        if(isInEditMode){
            $(".editMode").hide();
            $(".can-be-edited").attr("contenteditable", "false");
            fs.flashcards[0].content.translation = $(".answer").text();
            fs.flashcards[0].content.example = $(".sentence").html();
            fs.flashcards[0].content.exampleMeaning = $(".example .translation p").html();
            fs.flashcards[0].content.definition = $(".definition").html();
            fs.flashcards[0].lastUpdated = Date.now();
            $(".buttons,.btn.add-flashcard").show();
            fs = sortByDueDate(fs);
            $(".btn.edit").html(`<svg width="800px" height="800px" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><g id="Complete"><g id="edit"><g><path d="M20,16v4a2,2,0,0,1-2,2H4a2,2,0,0,1-2-2V6A2,2,0,0,1,4,4H8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/><polygon fill="none" points="12.5 15.8 22 6.2 17.8 2 8.3 11.5 8 16 12.5 15.8" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></g></g></g></svg>`);
        }else{
            revealAnswer(fs.flashcards[0]);
            $(".can-be-edited").attr("contenteditable", "true");
            $(".editMode").text("Edit Mode").show();
            $(".buttons,.btn.add-flashcard").hide();
            $(".btn.edit").html(`<svg width="800px" height="800px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage"><g id="Icon-Set" sketch:type="MSLayerGroup" transform="translate(-152.000000, -515.000000)" fill="currentColor"><path d="M171,525 C171.552,525 172,524.553 172,524 L172,520 C172,519.447 171.552,519 171,519 C170.448,519 170,519.447 170,520 L170,524 C170,524.553 170.448,525 171,525 L171,525 Z M182,543 C182,544.104 181.104,545 180,545 L156,545 C154.896,545 154,544.104 154,543 L154,519 C154,517.896 154.896,517 156,517 L158,517 L158,527 C158,528.104 158.896,529 160,529 L176,529 C177.104,529 178,528.104 178,527 L178,517 L180,517 C181.104,517 182,517.896 182,519 L182,543 L182,543 Z M160,517 L176,517 L176,526 C176,526.553 175.552,527 175,527 L161,527 C160.448,527 160,526.553 160,526 L160,517 L160,517 Z M180,515 L156,515 C153.791,515 152,516.791 152,519 L152,543 C152,545.209 153.791,547 156,547 L180,547 C182.209,547 184,545.209 184,543 L184,519 C184,516.791 182.209,515 180,515 L180,515 Z" id="save-floppy" sketch:type="MSShapeGroup"></path></g></g></svg>`);
        }
        isInEditMode = !isInEditMode;
    });
    $(".btn.save").hide();
    $(".btn.add-flashcard").on('click',()=>{
        if(isInCreateMode){
            $(".btn.edit,.buttons").show();
            $(".editMode,.pronunciation").hide();
            $(".can-be-edited").attr("contenteditable", "false");
            $(".card-item:has(.img-src),.pitch").hide();
            fs.flashcards.unshift({
                "content":{
                    "word":$(".word").text(),
                    "pitchAccent":$(".pitch span").text(),
                    "pronunciation":$(".pronunciation span").text(),
                    "translation":$(".translation").text(),
                    "definition":$(".definition").html(),
                    "example":$(".sentence").html(),
                    "exampleMeaning":$(".example .translation p").html(),
                    "screenshotUrl":$(".img-src").text(),
                    "pos": $(".pill").text(),
                    "level": parseInt($(".pill").attr("level")) || -1
                },
                "dueDate":Date.now(),
                "lastReviewed":Date.now(),
                "lastUpdated":Date.now(),
                "ease":0,
                "reviews":0
            });
            $(".btn.add-flashcard").html(`<svg width="800px" height="800px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 8C11 7.44772 11.4477 7 12 7C12.5523 7 13 7.44772 13 8V11H16C16.5523 11 17 11.4477 17 12C17 12.5523 16.5523 13 16 13H13V16C13 16.5523 12.5523 17 12 17C11.4477 17 11 16.5523 11 16V13H8C7.44771 13 7 12.5523 7 12C7 11.4477 7.44772 11 8 11H11V8Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M23 12C23 18.0751 18.0751 23 12 23C5.92487 23 1 18.0751 1 12C1 5.92487 5.92487 1 12 1C18.0751 1 23 5.92487 23 12ZM3.00683 12C3.00683 16.9668 7.03321 20.9932 12 20.9932C16.9668 20.9932 20.9932 16.9668 20.9932 12C20.9932 7.03321 16.9668 3.00683 12 3.00683C7.03321 3.00683 3.00683 7.03321 3.00683 12Z" fill="currentColor"/></svg>`);
        }else{
            $(".btn.edit,.buttons").hide();
            $(".editMode").text("Add Flashcard").show();
            $(".can-be-edited").attr("contenteditable", "true");
            let fs = {
                "content":{
                    "word":"word",
                    "pitchAccent":undefined,
                    "pronunciation":"pronunciation",
                    "translation":"translation",
                    "definition":"definition",
                    "example":"example",
                    "exampleMeaning":"example meaning",
                    "screenshotUrl":"-",
                    "pos": "",
                    "level": -1
                },
                "dueDate":1755100026393,
                "lastReviewed":1755100026393,
                "lastUpdated":1755100026393,
                "ease":0,
                "reviews":0
            };
            displayFlashcard(fs);

            $(".answer,.pronunciation").show();
            $(".pronunciation span").text("pronunciation");
            $(".example .translation p").html(fs.content.exampleMeaning);
            $(".card-item:has(.definition)").show();


            $(".pill").text("Level ID").show();
            $(".card-item:has(.img-src),.pitch").show();
            $(".img-src").text("image source");
            $(".pitch span").text("-1");
            $(".btn.add-flashcard").html(`<svg width="800px" height="800px" viewBox="0 0 32 32" version="1.1" xmlns="http://www.w3.org/2000/svg"><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage"><g id="Icon-Set" sketch:type="MSLayerGroup" transform="translate(-152.000000, -515.000000)" fill="currentColor"><path d="M171,525 C171.552,525 172,524.553 172,524 L172,520 C172,519.447 171.552,519 171,519 C170.448,519 170,519.447 170,520 L170,524 C170,524.553 170.448,525 171,525 L171,525 Z M182,543 C182,544.104 181.104,545 180,545 L156,545 C154.896,545 154,544.104 154,543 L154,519 C154,517.896 154.896,517 156,517 L158,517 L158,527 C158,528.104 158.896,529 160,529 L176,529 C177.104,529 178,528.104 178,527 L178,517 L180,517 C181.104,517 182,517.896 182,519 L182,543 L182,543 Z M160,517 L176,517 L176,526 C176,526.553 175.552,527 175,527 L161,527 C160.448,527 160,526.553 160,526 L160,517 L160,517 Z M180,515 L156,515 C153.791,515 152,516.791 152,519 L152,543 C152,545.209 153.791,547 156,547 L180,547 C182.209,547 184,545.209 184,543 L184,519 C184,516.791 182.209,515 180,515 L180,515 Z" id="save-floppy" sketch:type="MSShapeGroup"></path></g></g></svg>`);
        }
        isInCreateMode = !isInCreateMode;
    });
};