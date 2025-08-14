import {$, Peer} from "./openConnection.js";
import {Flashcards, overwriteFlashcards} from "../storage.js";
import {closeWindow} from "./window.js";
import {toUniqueIdentifier} from "../../utils.js";
import {wordFreq} from "../../settings/settings.js";


export const onFlashcards = async (peer,fs)=>{
    console.log(fs);
    console.log(typeof fs);
    if(typeof fs !== "object") fs = JSON.parse(fs);
    let myFlashcards = Flashcards();
    if(fs.length === 0) {
        sendByChunks(peer, JSON.stringify(myFlashcards), "sync-chunk");
        $("span").text("Sync Complete.");
        setTimeout(()=>{
            closeWindow();
        },2000);
        return;
    }

    for (const [key, value] of Object.entries(fs.alreadyCreated)) {
        myFlashcards.alreadyCreated[key] = value;
    }
    for (const [key, value] of Object.entries(fs.wordCandidates)) {
        let myValue = myFlashcards.wordCandidates[key];
        myFlashcards.wordCandidates[key] = Math.max(myValue, value);
    }
    //we'll skip the meta
    let otherHashMap = {};
    let myHashMap = {};
    for (let i = 0; i<fs.flashcards.length;i++) {
        let word = fs.flashcards[i].content.word;
        const uuid = await toUniqueIdentifier(word);
        otherHashMap[uuid] = i;
    }
    for (let i = 0; i<myFlashcards.flashcards.length;i++) {
        let word = myFlashcards.flashcards[i].content.word;
        const uuid = await toUniqueIdentifier(word);
        myHashMap[uuid] = i;
    }

    for (const [key, value] of Object.entries(otherHashMap)) {
        if(!(key in myHashMap)){
            myFlashcards.flashcards.push(fs.flashcards[value]);
        }
    }
    for (let i = 0; i<myFlashcards.flashcards.length;i++) {
        let word = myFlashcards.flashcards[i].content.word;
        const uuid = await toUniqueIdentifier(word);
        myHashMap[uuid] = i;
    }

    for (const [key, value] of Object.entries(myHashMap)) {
        if(!(key in otherHashMap)) continue;
        let otherCard = fs.flashcards[otherHashMap[key]];
        let myCard = myFlashcards.flashcards[value];
        if(otherCard.content.word !== myCard.content.word) {
            console.error("Wait what? How did we get here? Word mismatch", myHashMap, otherHashMap, myFlashcards.flashcards, fs.flashcards, myCard, otherCard);
            continue;
        }
        if(myCard.lastReviewed < otherCard.lastReviewed) {
            myFlashcards.flashcards[value] = otherCard;
        }
    }
    overwriteFlashcards(myFlashcards);
    console.log(myFlashcards);
    sendByChunks(peer, JSON.stringify(myFlashcards), "sync-chunk");
    $("span").text("Sync Complete.");
    setTimeout(()=>{
        closeWindow();
    },2000);
};

function splitTextIntoChunks(text, n) {
    if (typeof text !== "string") {
        throw new TypeError("First argument must be a string");
    }
    if (typeof n !== "number" || n <= 0) {
        throw new RangeError("Chunk size must be a positive number");
    }

    let chunks = [];
    for (let i = 0; i < text.length; i += n) {
        chunks.push(text.slice(i, i + n));
    }
    return chunks;
}

function sendByChunks(peer, data, name) {
    let chunks = splitTextIntoChunks(data, 1000);
    chunks.forEach((chunk,i) => {
        peer.send(JSON.stringify({
            type: name,
            data: [i,chunk,chunks.length]
        }));
    });
}
export const sync = (peer)=>{
    $("span").text("Syncing...");
    sendByChunks(peer, JSON.stringify(wordFreq), "wordFreq-chunk");

};