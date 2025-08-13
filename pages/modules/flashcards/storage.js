let flashcards = {};

const saveFlashcards = () => {
    window.electron_settings.saveFlashcards(flashcards);
};
const getFlashcards = async () => new Promise((resolve) => {
    window.electron_settings.getFlashcards();
    window.electron_settings.onFlashcards((fc) => {
        resolve(fc);
    });
});


(async function() {
    await getFlashcards();
})();