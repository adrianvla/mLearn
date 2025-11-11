import {getLLMResponse} from "../networking.js";

export async function getWordExplanation(word, phrase){
    const language = "English";
    return await getLLMResponse(`Explain in ${language} the meaning of the word ${word} in the following context: ${phrase}`,256,0.5);
}