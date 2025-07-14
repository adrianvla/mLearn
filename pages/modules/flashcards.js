import {settings} from "./settings.js";
import $ from '../jquery.min.js'
import {already_added, wordList} from "./subtitler.js";
import {getTranslation, sendRawToAnki} from "./networking.js";
import {parseSubtitleName} from "./subtitleParsers.js";
import {currentSubtitleFile} from "./manageFiles.js";

const FLASHCARD_CSS = `.card-c{background:#181818;display:flex;flex-direction:column;border-radius:20px;margin:10px;width:max-content;height:max-content;box-sizing:border-box;border:1px solid #444;color:#ccc;font-family:"Helvetica Neue","Arial", sans-serif;padding-bottom:20px;min-width:500px;max-width:700px}.card-c.light{background:#ccc;border:1px solid #aaa;color:#777}.divider{width:100%;background:#444;height:1px;margin-top:5px;margin-bottom:5px}.card-c.light .divider{background:#aaa}.card-item{display:flex;justify-content:center;align-items:center;padding-inline:20px;gap:20px}.img-btn{width:40px;height:40px;display:flex;justify-content:center;align-items:center;border-radius:10px;transition:background 0.1s;background:transparent;user-select:none;cursor:pointer}.img-btn:hover{background:#333}.card-c.light .img-btn:hover{background:#aaa}.img-btn svg{width:30px;height:30px;pointer-events:none;user-select:none;transition:opacity 0.2s, background 0.2s, fill 0.2s;box-sizing:border-box}.card-c.light .img-btn svg path{fill:#888}.img-btn:hover svg{opacity:0.8}.card-c.light .img-btn:hover svg path{fill:#777}.card-c.light .img-btn:hover svg{opacity:1}.pitch-accent-low{display:flex;background-image:linear-gradient(to top,#5e84ff,transparent);padding-bottom:2px;margin-top:2px;margin-right:-2px;padding-right:2px}a{color:#5e84ff}.pitch-accent-low div{background-color:#181818;padding-right:2px}.pitch-accent-high{display:flex;background-image:linear-gradient(to bottom, #ff5ec7,transparent);padding-top:2px;margin-bottom:2px;padding-left:2px}.card-c.light .pitch-accent-high{background-image:linear-gradient(to bottom, #e835a8,transparent)}.card-c.light .pitch-accent-low{background-image:linear-gradient(to top, #356ee8,transparent)}.pitch-accent-high.drop{padding-top:2px;margin-bottom:2px;margin-right:-2px;padding-left:2px;padding-right:2px}.pitch-accent-high div{background-color:#181818;padding-left:1px}.card-c.light .pitch-accent-high div,.card-c.light .pitch-accent-low div{background-color:#ccc}.pitch-accent-high.drop div{padding-right:2px}.word{display:flex}.definition{margin:10px;border-radius:10px;background:#222;padding:20px;font-size:20px;display:flex;flex-direction:column;gap:10px;border:1px solid #444;box-sizing:border-box;transition:border 0.2s;min-width:400px}.card-c.light .definition{background:#bbb;border:1px solid #aaa;color:#5a5a5a}.definition:focus{outline:none;border:3px solid #444}.card-c.light .definition:focus{border:3px solid #aaa}.definition p{margin:0}.example .sentence{font-size:30px;text-align:center}.example{display:flex;flex-direction:column}.example .translation{font-size:16px;color:#aaa;text-align:center}.card-c.light .example .translation{color:#888}.example .translation:hover{}.example .translation p{margin:5px}.defined{color:#ff5ec7;font-weight:bold}.card-c.light .defined{color:#356ee8}.card-item > img{border-radius:10px;min-width:100%;}`;

const addAllFlashcardsToAnki = () => {
    wordList.forEach(async (word)=>{
        if(word.new){
            if(already_added[word.word]) return;
            //{word:word, new:true, fetch:true, screenshot: screenshotVideo()};
            let translation_data = await getTranslation(word.word);
            let raw_flashcard_data = {"example":"","front":word.word,"pitch":"","definitions":"","image":""};
            translation_data.data.forEach((meaning)=>{
                let reading_html = meaning.reading;
                let translation_html = meaning.definitions;
                raw_flashcard_data.definitions += `<p>${translation_html}</p>`;
                raw_flashcard_data.definitions += `<p>${reading_html}</p>`;
            });
            if(translation_data.data.length==0) return;
            //calculate actual example sentence by putting it into iframe
            $("iframe")[0].contentWindow.document.body.innerHTML = word.currentSubtitle;
            //remove each .subtitle_hover element
            $("iframe").contents().find(".subtitle_hover").remove();
            //remove each .subtitle_word element
            $("iframe").contents().find(".subtitle_word").addClass("defined");
            raw_flashcard_data.example = $("iframe")[0].contentWindow.document.body.innerHTML;
            $("iframe")[0].contentWindow.document.body.innerHTML = "";
            raw_flashcard_data.image = word.screenshot;
            let card_creation_data = makeFlashcard(raw_flashcard_data, word.word, "", raw_flashcard_data.definitions, true);
            let response = await sendRawToAnki({"action":"addNote","version":6,"params":card_creation_data});
            console.log(card_creation_data);
            if(!response.error){
                already_added[word.word] = true;
            }else{
                console.log("Failed to create flashcard for word: "+word.word);
            }
        }
    });
};


const makeFlashcard = (raw_flashcard_data, word, _translation, _definition, _show_img) => {
    let data = {
        "note": {
            "deckName": settings.flashcard_deck,
            "modelName": "Basic",
            "fields": {
                "Back":"",
                "Front": word+"<intelligent_definition style='display:none'>"+raw_flashcard_data.definitions+"</intelligent_definition>"
            },
            "options": {
                "allowDuplicate": false,
                "duplicateScope": "deck",
                "duplicateScopeOptions": {
                    "deckName": settings.deckName,
                    "checkChildren": false,
                    "checkAllModels": false
                }
            },
            "tags": [
                "intelligent-subtitles",
                settings.language,
                "video-"+parseSubtitleName(currentSubtitleFile)
            ]
        }
    };
    // _translation = $('input',createFlashcardWindow.document).val()
    // _definition = $(".definition",createFlashcardWindow.document).html()
    // _show_img = $("#show-img",createFlashcardWindow.document).is(":checked")
    data.note.fields.Back = `
    <style>${FLASHCARD_CSS}</style>
    <div class="card-c ${settings.dark_mode ? '':'light'}">
        <div class="card-item">
            <h1>${raw_flashcard_data.front}</h1>
        </div>
        <div class="card-item">
            <div class="example">
                <div class="sentence">${raw_flashcard_data.example}</div>
                <div class="translation">
                    <p>${_translation}</p>
                </div>
            </div>
        </div>
        <div class="divider"></div>
        <div class="card-item">
            <div class="definition">
                ${_definition}
            </div>
        </div>
        <div class="card-item" ${_show_img ? "":"style='display:none'"}>
            <img src="${_show_img?raw_flashcard_data.image:''}" alt="">
        </div>
    </div>
    `;
    return data;
};

export {addAllFlashcardsToAnki, makeFlashcard}