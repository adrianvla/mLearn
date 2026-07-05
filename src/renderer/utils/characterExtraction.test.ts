import { describe, it, expect } from 'vitest';
import type { LanguageData } from '../../shared/types';
import {
  extractCharacters as extractCharactersRaw,
  buildCharacterContext as buildCharacterContextRaw,
  type CharacterExtractionOptions,
} from './characterExtraction';

const defaultCharacterLanguageData: LanguageData = {
  name: 'Subtitle Character Language',
  colour_codes: {},
  settings: { fixed: {} },
  textProcessing: {
    scriptProfile: { acceptedScripts: ['Latn', 'Hira', 'Kana', 'Han', 'Hang'] },
    subtitle: {
      characterNamePrefix: {
        enabled: true,
        scripts: ['Latn', 'Hira', 'Kana', 'Han', 'Hang'],
        allowLatinFallback: true,
      },
    },
  },
};

function extractCharacters(lines: string[], options: CharacterExtractionOptions = {}) {
  return extractCharactersRaw(lines, {
    ...options,
    languageData: options.languageData ?? defaultCharacterLanguageData,
  });
}

function buildCharacterContext(lines: string[], options: CharacterExtractionOptions = {}) {
  return buildCharacterContextRaw(lines, {
    ...options,
    languageData: options.languageData ?? defaultCharacterLanguageData,
  });
}

describe('extractCharacters', () => {
  it('does not extract without language metadata declaring subtitle character prefixes', () => {
    const result = extractCharactersRaw([
      'Alice: Hello there',
      'Alice: Goodbye',
    ]);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    const result = extractCharacters([]);
    expect(result).toEqual([]);
  });

  it('returns empty array for lines without character patterns', () => {
    const result = extractCharacters([
      'Just some dialogue without a name',
      'Another line of dialogue',
    ]);
    expect(result).toEqual([]);
  });

  it('extracts character name from (Name) pattern', () => {
    const result = extractCharacters([
      '(太郎) こんにちは',
      '(太郎) また明日',
    ]);
    expect(result).toEqual([{ name: '太郎', lineCount: 2 }]);
  });

  it('extracts character name from (Name) pattern with leading/trailing spaces', () => {
    const result = extractCharacters([
      '  (Alice) Hello world',
      '  (Alice) Goodbye',
    ]);
    expect(result).toEqual([{ name: 'Alice', lineCount: 2 }]);
  });

  it('extracts character name from （Name）full-width parentheses', () => {
    const result = extractCharacters([
      '（太郎）こんにちは',
      '（太郎）また明日',
    ]);
    expect(result).toEqual([{ name: '太郎', lineCount: 2 }]);
  });

  it('extracts character name from 【Name】lenticular brackets', () => {
    const result = extractCharacters([
      '【太郎】こんにちは',
      '【太郎】また明日',
    ]);
    expect(result).toEqual([{ name: '太郎', lineCount: 2 }]);
  });

  it('extracts character name from Name: ASCII colon pattern', () => {
    const result = extractCharacters([
      'Alice: Hello there',
      'Alice: How are you?',
    ]);
    expect(result).toEqual([{ name: 'Alice', lineCount: 2 }]);
  });

  it('extracts character name from Name: pattern with Japanese', () => {
    const result = extractCharacters([
      '太郎: こんにちは',
      '太郎: また明日',
    ]);
    expect(result).toEqual([{ name: '太郎', lineCount: 2 }]);
  });

  it('extracts character name from Name: pattern with Korean', () => {
    const result = extractCharacters([
      '태희: 안녕하세요',
      '태희: 반갑습니다',
    ]);
    expect(result).toEqual([{ name: '태희', lineCount: 2 }]);
  });

  it('extracts character name from Name： full-width colon pattern', () => {
    const result = extractCharacters([
      'Alice： Hello there',
      'Alice： How are you?',
    ]);
    expect(result).toEqual([{ name: 'Alice', lineCount: 2 }]);
  });

  it('extracts character name from Name： pattern with Japanese', () => {
    const result = extractCharacters([
      '太郎： こんにちは',
      '太郎： また明日',
    ]);
    expect(result).toEqual([{ name: '太郎', lineCount: 2 }]);
  });

  it('filters out characters with only 1 line', () => {
    const result = extractCharacters([
      '(太郎) こんにちは',
      '(花子) ありがとう',
      '(花子) どうしたの',
    ]);
    expect(result).toEqual([{ name: '花子', lineCount: 2 }]);
  });

  it('sorts characters by line count descending', () => {
    const result = extractCharacters([
      '(Alice) Line 1',
      '(Alice) Line 2',
      '(Alice) Line 3',
      '(Bob) Line 1',
      '(Bob) Line 2',
      '(Charlie) Line 1',
    ]);
    expect(result).toEqual([
      { name: 'Alice', lineCount: 3 },
      { name: 'Bob', lineCount: 2 },
    ]);
  });

  it('counts characters correctly across multiple patterns', () => {
    const result = extractCharacters([
      '(Alice) Line 1',
      'Alice: Line 2',
      '【Bob】 Line 1',
      'Bob： Line 2',
    ]);
    expect(result).toEqual([
      { name: 'Alice', lineCount: 2 },
      { name: 'Bob', lineCount: 2 },
    ]);
  });

  it('handles mixed patterns in same subtitle set', () => {
    const result = extractCharacters([
      '(太郎) こんにちは',
      '（花子）こんにちは',
      '【太郎】また明日',
      'Bob: Hello',
      '太郎： さようなら',
      'Bob: Goodbye',
    ]);
    expect(result).toEqual([
      { name: '太郎', lineCount: 3 },
      { name: 'Bob', lineCount: 2 },
    ]);
  });

  it('respects name length limit of 30 chars for parentheses pattern', () => {
    const longName = 'a'.repeat(30);
    const tooLongName = 'a'.repeat(31);
    const result = extractCharacters([
      `(${longName}) Dialogue 1`,
      `(${longName}) Dialogue 2`,
      `(${tooLongName}) This should not match`,
    ]);
    expect(result).toEqual([{ name: longName, lineCount: 2 }]);
  });

  it('respects name length limit of 30 chars for full-width parentheses pattern', () => {
    const longName = 'あ'.repeat(30);
    const result = extractCharacters([
      `（${longName}）Dialogue 1`,
      `（${longName}）Dialogue 2`,
    ]);
    expect(result).toEqual([{ name: longName, lineCount: 2 }]);
  });

  it('respects name length limit of 30 chars for lenticular brackets pattern', () => {
    const longName = 'a'.repeat(30);
    const result = extractCharacters([
      `【${longName}】Dialogue 1`,
      `【${longName}】Dialogue 2`,
    ]);
    expect(result).toEqual([{ name: longName, lineCount: 2 }]);
  });

  it('respects name length limit of 20 chars for ASCII colon pattern', () => {
    const validName = 'a'.repeat(20);
    const tooLongName = 'a'.repeat(21);
    const result = extractCharacters([
      `${validName}: Dialogue 1`,
      `${validName}: Dialogue 2`,
      `${tooLongName}: This should not match`,
    ]);
    expect(result).toEqual([{ name: validName, lineCount: 2 }]);
  });

  it('respects name length limit of 20 chars for full-width colon pattern', () => {
    const validName = 'a'.repeat(20);
    const tooLongName = 'a'.repeat(21);
    const result = extractCharacters([
      `${validName}： Dialogue 1`,
      `${validName}： Dialogue 2`,
      `${tooLongName}： This should not match`,
    ]);
    expect(result).toEqual([{ name: validName, lineCount: 2 }]);
  });

  it('trims whitespace from extracted names', () => {
    const result = extractCharacters([
      '(  Alice  ) Dialogue 1',
      '(  Alice  ) Dialogue 2',
    ]);
    expect(result).toEqual([{ name: 'Alice', lineCount: 2 }]);
  });

  it('ignores empty names after trimming', () => {
    const result = extractCharacters([
      '(   ) Dialogue',
      '(Alice) Line 1',
      '(Alice) Line 2',
    ]);
    expect(result).toEqual([{ name: 'Alice', lineCount: 2 }]);
  });

  it('only matches first pattern per line', () => {
    const result = extractCharacters([
      '(Alice) She said: Hello',
      '(Alice) And then: Goodbye',
    ]);
    expect(result).toEqual([{ name: 'Alice', lineCount: 2 }]);
  });

  it('handles complex scenario with many characters', () => {
    const lines = [
      '(Alice) Good morning',
      '(Bob) Hello there',
      '(Alice) How are you?',
      '(Charlie) I am fine',
      '(Bob) That is great',
      '(Alice) What is new?',
      '(Diana) Not much',
    ];
    const result = extractCharacters(lines);
    expect(result).toEqual([
      { name: 'Alice', lineCount: 3 },
      { name: 'Bob', lineCount: 2 },
    ]);
  });

  it('handles names with special characters in parentheses', () => {
    const result = extractCharacters([
      '(Alice-Smith) Dialogue 1',
      '(Alice-Smith) Dialogue 2',
    ]);
    expect(result).toEqual([{ name: 'Alice-Smith', lineCount: 2 }]);
  });

  it('handles numbers in character names', () => {
    const result = extractCharacters([
      '(Guard1) Stop right there',
      '(Guard1) We are here to help',
    ]);
    expect(result).toEqual([{ name: 'Guard1', lineCount: 2 }]);
  });

  it('disables extraction when installed language metadata does not support character names', () => {
    const latinLanguage: LanguageData = {
      name: 'Latin Language',
      colour_codes: {},
      settings: { fixed: {} },
          };

    const result = extractCharacters([
      'Alice: Hello there',
      'Alice: Goodbye',
    ], { languageData: latinLanguage });

    expect(result).toEqual([]);
  });

  it('requires subtitle parser metadata before extracting character labels', () => {
    const unconfiguredLanguage: LanguageData = {
      name: 'Unconfigured Language',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Latn'] },
      },
    };

    const result = extractCharacters([
      'Alice: Hello there',
      'Alice: Goodbye',
    ], { languageData: unconfiguredLanguage });

    expect(result).toEqual([]);
  });

  it('uses language metadata to extract Cyrillic character labels', () => {
    const russianLanguage: LanguageData = {
      name: 'Russian',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Cyrl'] },
        subtitle: {
          characterNamePrefix: {
            enabled: true,
            scripts: ['Cyrl'],
            delimiters: [':'],
          },
        },
      },
    };

    const result = extractCharacters([
      'Анна: Привет',
      'Анна: Пока',
    ], { languageData: russianLanguage });

    expect(result).toEqual([{ name: 'Анна', lineCount: 2 }]);
  });

  it('does not extract Latin character labels for non-Latin packages unless metadata opts in', () => {
    const japaneseLanguage: LanguageData = {
      name: 'Japanese',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Hira', 'Kana', 'Han'] },
        subtitle: {
          characterNamePrefix: {
            enabled: true,
            scripts: ['Hira', 'Kana', 'Han'],
            delimiters: [':'],
          },
        },
      },
    };

    expect(extractCharacters([
      'Alice: こんにちは',
      'Alice: また明日',
    ], { languageData: japaneseLanguage })).toEqual([]);
    expect(extractCharacters([
      'Alice: こんにちは',
      'Alice: また明日',
    ], {
      languageData: {
        ...japaneseLanguage,
        textProcessing: {
          subtitle: {
            characterNamePrefix: {
              ...japaneseLanguage.textProcessing!.subtitle!.characterNamePrefix!,
              allowLatinFallback: true,
            },
          },
        },
      },
    })).toEqual([{ name: 'Alice', lineCount: 2 }]);
  });

  it('uses language metadata to extract Arabic character labels with custom brackets', () => {
    const arabicLanguage: LanguageData = {
      name: 'Arabic',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: {
        scriptProfile: { acceptedScripts: ['Arab'] },
        subtitle: {
          characterNamePrefix: {
            enabled: true,
            scripts: ['Arab'],
            bracketPairs: [['[', ']']],
            minLineCount: 1,
          },
        },
      },
    };

    const result = extractCharacters([
      '[سارة] مرحبا',
    ], { languageData: arabicLanguage });

    expect(result).toEqual([{ name: 'سارة', lineCount: 1 }]);
  });
});

describe('buildCharacterContext', () => {
  it('returns null when no characters are found', () => {
    const result = buildCharacterContext([]);
    expect(result).toBeNull();
  });

  it('returns null for lines without character patterns', () => {
    const result = buildCharacterContext([
      'Just some dialogue',
      'No names here',
    ]);
    expect(result).toBeNull();
  });

  it('returns formatted string with header when characters found', () => {
    const result = buildCharacterContext([
      '(Alice) Hello',
      '(Alice) How are you?',
    ]);
    expect(result).toBe('Characters detected in the media:\n- Alice (2 lines)');
  });

  it('includes correct line count in output', () => {
    const result = buildCharacterContext([
      '(Alice) Line 1',
      '(Alice) Line 2',
      '(Alice) Line 3',
    ]);
    expect(result).toContain('- Alice (3 lines)');
  });

  it('formats multiple characters sorted by line count', () => {
    const result = buildCharacterContext([
      '(Alice) Line 1',
      '(Alice) Line 2',
      '(Alice) Line 3',
      '(Bob) Line 1',
      '(Bob) Line 2',
    ]);
    expect(result).toBe(
      'Characters detected in the media:\n- Alice (3 lines)\n- Bob (2 lines)'
    );
  });

  it('includes header prefix in output', () => {
    const result = buildCharacterContext([
      '(Alice) Hello',
      '(Alice) Hi',
    ]);
    expect(result?.startsWith('Characters detected in the media:\n')).toBe(true);
  });

  it('caps at 15 characters', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 20; i++) {
      lines.push(`(Character${i}) Line 1`);
      lines.push(`(Character${i}) Line 2`);
    }
    const result = buildCharacterContext(lines);
    const characterLines = result?.split('\n').slice(1) ?? [];
    expect(characterLines).toHaveLength(15);
  });

  it('correctly formats output with proper line breaks', () => {
    const result = buildCharacterContext([
      '(Alice) Hello',
      '(Alice) Hi',
      '(Bob) Hey',
      '(Bob) Hello',
      '(Charlie) Howdy',
      '(Charlie) Yo',
    ]);
    const lines = result?.split('\n') ?? [];
    expect(lines[0]).toBe('Characters detected in the media:');
    expect(lines.length).toBe(4);
  });

  it('does not include characters with only one line', () => {
    const result = buildCharacterContext([
      '(Alice) Line 1',
      '(Alice) Line 2',
      '(Bob) Single line',
    ]);
    expect(result).toBe('Characters detected in the media:\n- Alice (2 lines)');
  });

  it('handles special characters in names', () => {
    const result = buildCharacterContext([
      '(Alice-Smith) Hello',
      '(Alice-Smith) Hi',
    ]);
    expect(result?.includes('Alice-Smith')).toBe(true);
  });

  it('respects sorting by frequency in output', () => {
    const result = buildCharacterContext([
      '(Charlie) 1',
      '(Charlie) 2',
      '(Alice) 1',
      '(Alice) 2',
      '(Alice) 3',
      '(Bob) 1',
      '(Bob) 2',
    ]);
    const lines = result?.split('\n') ?? [];
    expect(lines[1]).toContain('Alice (3 lines)');
    expect(lines[2]).toMatch(/Bob \(2 lines\)|Charlie \(2 lines\)/);
    expect(lines[3]).toMatch(/Bob \(2 lines\)|Charlie \(2 lines\)/);
  });

  it('returns correct context for Japanese characters', () => {
    const result = buildCharacterContext([
      '（太郎）こんにちは',
      '（太郎）また明日',
      '【花子】はじめまして',
      '【花子】どうぞ',
    ]);
    expect(result).toContain('太郎 (2 lines)');
    expect(result?.includes('花子 (2 lines)')).toBe(true);
  });

  it('uses pluralized "lines" label', () => {
    const result = buildCharacterContext([
      '(Alice) 1',
      '(Alice) 2',
    ]);
    expect(result?.includes('(2 lines)')).toBe(true);
  });

  it('handles exactly 15 characters at cap', () => {
    const lines = Array.from({ length: 30 }, (_, i) => {
      const charNum = (i % 15) + 1;
      return `(Char${charNum}) ${i}`;
    });
    const result = buildCharacterContext(lines);
    const outputLines = result?.split('\n') ?? [];
    expect(outputLines).toHaveLength(16);
  });
});
