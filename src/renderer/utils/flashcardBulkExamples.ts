import type { Flashcard, FlashcardContent, LanguageData, Settings } from '../../shared/types';

type BackendSettings = Pick<
  Settings,
  'backendMode' | 'backendUrl' | 'cloudAuthAccessToken' | 'cloudAuthToken'
>;

export type BulkExampleMode = 'onlyEmpty' | 'replaceAll' | 'olderThan';

export interface BulkExampleDeps {
  activeLanguage: string;
  settings: BackendSettings;
  colourCodes: Record<string, string>;
  getLanguageData: (language: string) => LanguageData | null;
  generateExampleSentenceWithLLM: (
    word: string,
    definition: string,
    language: string,
  ) => Promise<{ sentence: string; meaning: string }>;
  colorizeTokenizedText: (params: {
    text: string;
    language: string;
    languageData?: LanguageData | null;
    settings: BackendSettings;
    colourCodes: Record<string, string>;
    targetWord: string;
  }) => Promise<string>;
}

export interface BulkExampleUpdate {
  cardId: string;
  language: string;
  content: Partial<FlashcardContent>;
}

export function resolveFlashcardColourCodes(
  languageData: LanguageData | null | undefined,
  settingsColourCodes: Record<string, string> | null | undefined,
): Record<string, string> {
  const packageColors = languageData?.textProcessing?.partOfSpeech?.colors;
  if (packageColors && Object.keys(packageColors).length > 0) {
    return packageColors;
  }
  return settingsColourCodes ?? {};
}

export function getCardsNeedingBulkExamples(cards: readonly Flashcard[], mode: BulkExampleMode): Flashcard[] {
  if (mode === 'replaceAll') {
    return cards.filter(card => card.content.front && card.content.front !== '-');
  }

  return cards.filter(card =>
    !card.content.example || card.content.example === '-' || card.content.example.trim() === ''
  );
}

export async function buildBulkExampleUpdate(
  card: Flashcard,
  deps: BulkExampleDeps,
): Promise<BulkExampleUpdate | null> {
  const language = card.language || deps.activeLanguage;
  const result = await deps.generateExampleSentenceWithLLM(card.content.front, card.content.back, language);
  if (!result.sentence) return null;
  const languageData = deps.getLanguageData(language);

  const exampleHtml = await deps.colorizeTokenizedText({
    text: result.sentence,
    language,
    languageData,
    settings: deps.settings,
    colourCodes: resolveFlashcardColourCodes(languageData, deps.colourCodes),
    targetWord: card.content.front,
  });

  return {
    cardId: card.id,
    language,
    content: {
      example: exampleHtml,
      exampleMeaning: result.meaning || undefined,
    },
  };
}
