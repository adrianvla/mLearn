let flashcards = {};

export const saveFlashcards = () => {
    window.mLearnIPC.saveFlashcards(flashcards);
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
                "definition":"Feeling, sense, impression",
                "example":"こういう感じだった",
                "exampleMeaning":"MEANING",
                "screenshotUrl":"no",
                "pos": "名詞",
                "reviews":0
            },
            "dueDate":1755100026393,
            "lastReviewed":1755100026393,
            "ease":0,
            "reviews":0
        }*/],
        "wordCandidates":{

        }
    };
    saveFlashcards();
};
window.resetFlashcards = resetFlashcards;
const newSetup = () => {
    if(Object.keys(flashcards).length > 0) return;
    resetFlashcards();
};

export const addFlashcard = (content, ease=0) => {
    flashcards.flashcards.push({
        "content":content,
        "dueDate":Date.now(),
        "lastReviewed":Date.now(),
        "ease":ease,
        "reviews":0
    });
}

(async function() {
    await getFlashcards();
    console.log("flashcards:",flashcards);
    newSetup();
})();

export const Flashcards = () => flashcards;