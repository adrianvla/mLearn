export interface LLMExampleJob {
  word: string;
  definition: string;
  language: string;
}

export interface LLMExampleResult {
  sentence: string;
  meaning: string;
}

export function parseExampleBlocksFromLLM(content: string, expectedCount: number): LLMExampleResult[] | null {
  const blocks = Array.from(content.matchAll(
    /^\s*\d+\s*\.?\s*Sentence:\s*(.+?)\s*\n\s*\d+\s*\.?\s*Translation:\s*(.+?)(?=\s*\n\s*\d+\s*\.?\s*Sentence:|\s*$)/gims,
  )).map((match) => ({ sentence: match[1].trim(), meaning: match[2].trim() }));

  return blocks.length === expectedCount && blocks.every((block) => block.sentence && block.meaning)
    ? blocks
    : null;
}
