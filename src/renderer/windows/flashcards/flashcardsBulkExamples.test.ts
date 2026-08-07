import { describe, expect, it, vi } from 'vitest';
import type { Flashcard, LanguageData, Settings } from '../../../shared/types';
import { buildBulkExampleUpdate, buildBulkExampleUpdates, getCardsNeedingBulkExamples, resolveFlashcardColourCodes } from '../../utils/flashcardBulkExamples';

function makeCard(overrides: Partial<Flashcard> = {}): Flashcard {
  const { content: contentOverride, ...cardOverrides } = overrides;
  const content = {
    type: 'word' as const,
    front: 'سلام',
    back: 'hello',
    ...contentOverride,
  };

  return {
    id: 'card-1',
    state: 'new',
    ease: 2.5,
    interval: 0,
    dueDate: 0,
    reviews: 0,
    lapses: 0,
    learningStep: 0,
    createdAt: 1,
    lastReviewed: 0,
    lastUpdated: 1,
    ...cardOverrides,
    content,
  };
}

const backendSettings: Pick<Settings, 'backendMode' | 'backendUrl' | 'cloudAuthAccessToken' | 'cloudAuthToken'> = {
  backendMode: 'local',
  backendUrl: '',
  cloudAuthAccessToken: '',
  cloudAuthToken: '',
};

describe('flashcards bulk examples', () => {
  it('uses each saved card language instead of the active app language', async () => {
    const arabicLanguageData = {
      name: 'Arabic',
      colour_codes: {},
      settings: { fixed: {} },
      textProcessing: { scriptProfile: { acceptedScripts: ['Arab'] } },
    } satisfies LanguageData;
    const generateExampleSentences = vi.fn(async () => [{
      sentence: 'السلام عليكم',
      meaning: 'Peace be upon you',
    }]);
    const colorizeTokenizedText = vi.fn(async () => '<span>السلام</span> عليكم');
    const getLanguageData = vi.fn(() => arabicLanguageData);

    const update = await buildBulkExampleUpdate(makeCard({ language: 'ar' }), {
      activeLanguage: 'ja',
      settings: backendSettings,
      colourCodes: { greeting: '#fff' },
      getLanguageData,
      generateExampleSentences,
      colorizeTokenizedText,
    });

    expect(generateExampleSentences).toHaveBeenCalledWith([{ word: 'سلام', definition: 'hello', language: 'ar' }]);
    expect(getLanguageData).toHaveBeenCalledWith('ar');
    expect(colorizeTokenizedText).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ar',
      languageData: arabicLanguageData,
      targetWord: 'سلام',
    }));
    expect(update).toEqual({
      cardId: 'card-1',
      language: 'ar',
      content: {
        example: '<span>السلام</span> عليكم',
        exampleMeaning: 'Peace be upon you',
      },
    });
  });

  it('falls back to the active language only for cards without stored language', async () => {
    const generateExampleSentences = vi.fn(async () => [{
      sentence: '雨が降っています。',
      meaning: 'It is raining.',
    }]);
    const colorizeTokenizedText = vi.fn(async () => '<span>雨</span>が降っています。');

    await buildBulkExampleUpdate(makeCard({
      content: {
        type: 'word',
        front: '雨',
        back: 'rain',
      },
    }), {
      activeLanguage: 'ja',
      settings: backendSettings,
      colourCodes: {},
      getLanguageData: () => null,
      generateExampleSentences,
      colorizeTokenizedText,
    });

    expect(generateExampleSentences).toHaveBeenCalledWith([{ word: '雨', definition: 'rain', language: 'ja' }]);
    expect(colorizeTokenizedText).toHaveBeenCalledWith(expect.objectContaining({
      language: 'ja',
      targetWord: '雨',
    }));
  });

  it('selects the same cards as the existing bulk-example modes', () => {
    const withExample = makeCard({ id: 'with-example', content: { type: 'word', front: 'A', back: 'a', example: 'already' } });
    const withoutExample = makeCard({ id: 'without-example', content: { type: 'word', front: 'B', back: 'b', example: '' } });
    const shell = makeCard({ id: 'shell', content: { type: 'word', front: '-', back: '-' } });

    expect(getCardsNeedingBulkExamples([withExample, withoutExample, shell], 'onlyEmpty').map(card => card.id))
      .toEqual(['without-example', 'shell']);
    expect(getCardsNeedingBulkExamples([withExample, withoutExample, shell], 'replaceAll').map(card => card.id))
      .toEqual(['with-example', 'without-example']);
  });

  it('falls back to language colour codes when settings do not define any', () => {
    const languageData = {
      name: 'Arabic',
      settings: { fixed: {} },
      textProcessing: {
        partOfSpeech: {
          colors: { noun: '#ar' },
        },
      },
    } satisfies LanguageData;

    expect(resolveFlashcardColourCodes(languageData, {})).toEqual({ noun: '#ar' });
    expect(resolveFlashcardColourCodes(languageData, { verb: '#custom' })).toEqual({ noun: '#ar' });
    expect(resolveFlashcardColourCodes({ ...languageData, textProcessing: undefined }, { verb: '#custom' })).toEqual({ verb: '#custom' });
  });

  it('batches jobs before colorizing each result', async () => {
    const cards = [makeCard({ id: 'one' }), makeCard({ id: 'two', content: { type: 'word', front: '猫', back: 'cat' } })];
    const generateExampleSentences = vi.fn(async () => [
      { sentence: 'سلام.', meaning: 'Hello.' },
      { sentence: '猫です。', meaning: 'It is a cat.' },
    ]);

    const updates = await buildBulkExampleUpdates(cards, {
      activeLanguage: 'ja', settings: backendSettings, colourCodes: {}, getLanguageData: () => null,
      generateExampleSentences, colorizeTokenizedText: async ({ text }) => text,
    });

    expect(generateExampleSentences).toHaveBeenCalledOnce();
    expect(updates.map((update) => update?.cardId)).toEqual(['one', 'two']);
  });
});
