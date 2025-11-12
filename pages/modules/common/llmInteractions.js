import {getLLMResponse} from "../networking.js";

export async function getWordExplanation(word, phrase) {
    const language = "English";
    const prompt = `
You are a language assistant.

Task:
1. Translate the following sentence into ${language}.
2. Add a blank line.
3. Explain what the word 「${word}」 means in this sentence, focusing on its nuance in context. Keep it 1-2 sentences.
4. Add a blank line.
5. List the main grammar points as bullet points, each explaining its function or nuance in context. Keep bullets short (1-2 sentences each).
6. STOP after providing translation, word explanation, and grammar points. Do NOT add extra commentary. Do NOT add romaji, nor any reading information.

Sentence:
${phrase}
`;


    // 256 tokens should be sufficient for the short structured output
    return await getLLMResponse(prompt.trim()+"\n", phrase, 256, 0.3);
}

window.getWordExplanation = getWordExplanation;