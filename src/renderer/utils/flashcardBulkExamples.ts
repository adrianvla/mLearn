import type { Flashcard, FlashcardContent, LanguageData, Settings } from '../../shared/types';
import type { LLMExampleJob, LLMExampleResult } from './llmExampleBatch';

type BackendSettings = Pick<
  Settings,
  'backendMode' | 'backendUrl' | 'cloudAuthAccessToken' | 'cloudAuthToken'
>;

/**
 * The modes the examples run can honour.
 *
 * There is deliberately no `olderThan`. The TTS run can compare against a
 * stored generation timestamp, but an example is plain card content with no
 * generation stamp, so a date filter had nothing to compare. It used to be
 * offered anyway by a picker shared with the TTS section, and
 * `getCardsNeedingBulkExamples` only ever branched on `replaceAll` — so
 * choosing it ran the "only empty" selection while the screen claimed a date
 * filter had been applied. A mode that cannot be honoured is not offered;
 * see `bulkGenerationPlan.ts` for the shared vocabulary.
 */
export type BulkExampleMode = 'onlyEmpty' | 'replaceAll';

export interface BulkExampleDeps {
  activeLanguage: string;
  settings: BackendSettings;
  colourCodes: Record<string, string>;
  getLanguageData: (language: string) => LanguageData | null;
  generateExampleSentences: (jobs: LLMExampleJob[]) => Promise<LLMExampleResult[]>;
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
  const [result] = await deps.generateExampleSentences([{ word: card.content.front, definition: card.content.back, language }]);
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

export async function buildBulkExampleUpdates(
  cards: Flashcard[],
  deps: BulkExampleDeps,
): Promise<Array<BulkExampleUpdate | null>> {
  const jobs = cards.map((card) => ({
    word: card.content.front,
    definition: card.content.back,
    language: card.language || deps.activeLanguage,
  }));
  const results = await deps.generateExampleSentences(jobs);

  return Promise.all(cards.map(async (card, index) => {
    const result = results[index] ?? { sentence: '', meaning: '' };
    if (!result.sentence) return null;
    const language = jobs[index].language;
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
      content: { example: exampleHtml, exampleMeaning: result.meaning || undefined },
    };
  }));
}
