import {screenshotVideo, toUniqueIdentifier} from "../utils.js";
import {settings, wordFreq} from "../settings/settings.js";
import {getCards, getTranslation} from "../networking.js";
import {
    WORD_STATUS_KNOWN,
    WORD_STATUS_LEARNING,
    WORD_STATUS_UNKNOWN,
    getKnownStatus
} from "../stats/saving.js";

let flashcards = {};
let flashcardSearchHashMap = {};

export const saveFlashcards = async () => {
    window.mLearnIPC.saveFlashcards(flashcards);
    await updateFlashcardSearchHashMap();
};
const getFlashcards = async () => new Promise((resolve) => {
    window.mLearnIPC.getFlashcards();
    window.mLearnIPC.onFlashcards((fc) => {
        flashcards = fc;
        resolve(fc);
    });
});
window.getFlashcards = getFlashcards;
export const resetFlashcards = () =>{
    flashcards = {
        "flashcards": [/*{
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
            "lastUpdated":1755100026393,
            "ease":0,
            "reviews":0
        }*/],
        "wordCandidates":{

        },
        "alreadyCreated":{},
        "knownUnTracked":{},
        "meta":{
            "flashcardsCreatedToday": 0,
            "lastFlashcardCreatedDate" : Date.now()
        }
    };
    saveFlashcards();
};
window.resetFlashcards = resetFlashcards;
const newSetup = () => {
    if(Object.keys(flashcards).length > 0) return;
    resetFlashcards();
};

export const trackWordAppearance = (word) => {
    const uuid = toUniqueIdentifier(word);
    if(flashcards.wordCandidates[uuid] === undefined) flashcards.wordCandidates[uuid] = { "count": 0, "lastSeen": Date.now(), word };
    flashcards.wordCandidates[uuid].count++;
    saveFlashcards();
}

function isSameDay(date) {
    const now = new Date();
    const d = new Date(date);
    return now.getFullYear() === d.getFullYear() &&
           now.getMonth() === d.getMonth() &&
           now.getDate() === d.getDate();
}

export const doMakeFlashcard = async (word, content) => {
    const uuid = await toUniqueIdentifier(word);
    if(flashcards.wordCandidates[uuid] === undefined) return [false,0];
    const wordCandidate = flashcards.wordCandidates[uuid];
    const hour = 60 * 60 * 1000;
    const isCandidate = wordCandidate.count >= 3 && (Date.now() - wordCandidate.lastSeen < hour * 24);
    // settings.maxNewCardsPerDay
    // if(!isSameDay(Date.now())){
    //
    // }
    let maxFlashcardMultiplier = 1 - settings.proportionOfExamCards;
    if(content.level !== -1 && content.level >= settings.preparedExam) // considered as an exam card, higher value
        maxFlashcardMultiplier = 1;

    if(flashcards.meta.flashcardsCreatedToday  < settings.maxNewCardsPerDay * maxFlashcardMultiplier){
        return [isCandidate,wordCandidate.count];
    }
    return [false,0];
};

const updateFlashcardSearchHashMap = async () => {
    flashcardSearchHashMap = {};
    for (const flashcard of flashcards.flashcards) {
        const i = flashcards.flashcards.indexOf(flashcard);
        const uuid = await toUniqueIdentifier(flashcard.content.word);
        flashcardSearchHashMap[uuid] = i;
    }
};

export const findFlashcard = async (word) => {
    const uuid = await toUniqueIdentifier(word);
    if(uuid in flashcardSearchHashMap) return flashcards.flashcards[flashcardSearchHashMap[uuid]];
    return null;
};

export const getSRSWordKnownStatus = async (word) => {
    const uuid = await toUniqueIdentifier(word);
    if(uuid in flashcards.knownUnTracked) return WORD_STATUS_KNOWN;
    else if(uuid in flashcardSearchHashMap){
        const flashcard = flashcards.flashcards[flashcardSearchHashMap[uuid]];
        if(settings.known_ease_threshold/1000 > flashcard.ease) return WORD_STATUS_KNOWN;
        else return WORD_STATUS_LEARNING;
    }
    return WORD_STATUS_UNKNOWN;
};

export const addFlashcard = async (word, content, ease=0) => {
    const uuid = await toUniqueIdentifier(word);
    if(uuid in flashcards.alreadyCreated) return console.log(`%cFlashcard for word "${word}" already created.`, "color: orange; font-weight: bold;");
    flashcards.alreadyCreated[uuid] = true;
    flashcards.flashcards.push({
        "content":content,
        "dueDate":Date.now(),
        "lastReviewed":Date.now(),
        "ease":ease,
        "reviews":0,
        "lastUpdated":Date.now()
    });
    flashcards.meta.flashcardsCreatedToday++;
}

function countToEase(x){
    return Math.atan(x/10)+1.01;
}

async function createFlashcardForWord(word, translation_data = null){
    if(translation_data == null) return console.error("translation_data is null for word", word);
    console.log(`%cCreating flashcard for word: ${word}`, "color: crimson; font-weight: bold;");
    let flashcardContent = {
        word:word,
        pitchAccent:translation_data.data[2][2]?.pitches[0]?.position,
        pronunciation:translation_data.data[0].reading,
        translation:translation_data.data[0]?.definitions,
        definition:translation_data.data[1]?.definitions,
        example:"-",
        exampleMeaning:"",
        screenshotUrl: "",
        pos: "",
        level: word in wordFreq ? wordFreq[word].raw_level : -1,
    };
    await addFlashcard(word, flashcardContent, Math.max((getKnownStatus(word)-1)*0.25,0) + 1.3);
}

async function newDay(){
    flashcards.meta.lastFlashcardCreatedDate = Date.now();
    flashcards.meta.flashcardsCreatedToday = 0;


    if(settings.createUnseenCards){
        const examFlashcardNumberToCreate = settings.maxNewCardsPerDay * settings.proportionOfExamCards;
        for(let i = 0; i < examFlashcardNumberToCreate; i++){
            //get random word from wordFreq
            //wordFreq[word].raw_level
            let word = "";
            let inexistent = true;
            let translation_data = null;
            let bad_data = false;
            do{
                word = Object.keys(wordFreq)[Math.floor(Math.random() * Object.keys(wordFreq).length)];
                if(settings.use_anki)
                    try{let o = await getCards(word); inexistent = o?.poor === true;}catch(e){inexistent = true;}
                else
                    inexistent = true;
                translation_data = await getTranslation(word);
                if(translation_data.data === undefined) bad_data = true;
                else bad_data = translation_data.data.length === 0;
                const uuid = await toUniqueIdentifier(word);
                if(uuid in flashcards.alreadyCreated || uuid in flashcards.knownUnTracked) inexistent = false;
            }while(wordFreq[word]?.raw_level === undefined || wordFreq[word].raw_level < settings.preparedExam || !inexistent || !(await getKnownStatus(word) < WORD_STATUS_KNOWN) || bad_data);
            await createFlashcardForWord(word, translation_data);

        }
    }

    saveFlashcards();
}
window.newDay = newDay;

export const attemptFlashcardCreation = async (word, content) =>{
    console.log(`%cAttempting flashcard creation for word: ${word}`, "color: blue; font-weight: bold;", content);
    if(!isSameDay(flashcards.meta.lastFlashcardCreatedDate)) await newDay();

    const uuid = await toUniqueIdentifier(word);
    if(uuid in flashcards.alreadyCreated) return;
    if(uuid in flashcards.knownUnTracked) return;

    let [isCandidate, count] = await doMakeFlashcard(word, content);
    if(!isCandidate) return;
    await addFlashcard(word, content, countToEase(count));
    saveFlashcards();
    console.log(`%cCreated new flashcard for word: ${word}`, "color: aqua; font-weight: bold;");
};

(async function() {
    await getFlashcards();
    await updateFlashcardSearchHashMap();
    console.log("flashcards:",flashcards);
    newSetup();
    if(!isSameDay(flashcards.meta.lastFlashcardCreatedDate)) await newDay();
})();

export const Flashcards = () => flashcards;

export function overwriteFlashcards(newFlashcards){
    flashcards = newFlashcards;
    saveFlashcards();
}


window.mLearnIPC.onUpdateWordAppearance((message)=>{
    JSON.parse(message).forEach(async word => {
        trackWordAppearance(word);
    });
});
window.mLearnIPC.onUpdateAttemptFlashcardCreation((message)=>{
    JSON.parse(message).forEach(async cardPair => {
        console.log(cardPair);
        await attemptFlashcardCreation(cardPair.word, cardPair.content);
    });
});