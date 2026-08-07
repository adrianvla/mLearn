import { describe, expect, it } from 'vitest';
import { parseExampleBlocksFromLLM } from './llmExampleBatch';

describe('parseExampleBlocksFromLLM', () => {
  it('preserves numbered block order', () => {
    expect(parseExampleBlocksFromLLM('1. Sentence: Hola.\n1. Translation: Hello.\n2. Sentence: Adiós.\n2. Translation: Goodbye.', 2))
      .toEqual([{ sentence: 'Hola.', meaning: 'Hello.' }, { sentence: 'Adiós.', meaning: 'Goodbye.' }]);
  });

  it('parses one block and rejects mismatched counts', () => {
    expect(parseExampleBlocksFromLLM('1. Sentence: Hola.\n1. Translation: Hello.', 1))
      .toEqual([{ sentence: 'Hola.', meaning: 'Hello.' }]);
    expect(parseExampleBlocksFromLLM('1. Sentence: Hola.\n1. Translation: Hello.', 2)).toBeNull();
  });
});
