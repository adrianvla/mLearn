/**
 * ONE owner of the question "what is missing or stale on these cards?".
 *
 * Both flashcard maintenance surfaces read this single plan:
 *   - Repair  (sidebar "Missing flashcard data"): fill what is ABSENT.
 *   - Generate (Generate tab): re-roll what EXISTS but is unsatisfactory
 *     (a different audio seed, a fresh example sentence).
 *
 * Regeneration is deliberately a mode here rather than a separate scanner: it
 * asks the same per-card questions with a different acceptance rule, so a second
 * implementation would only re-introduce the drift this module exists to remove.
 */

import type { Flashcard, FlashcardContent, LanguageData } from '../../shared/types';
import { enrichWord, type DictionaryTargetSettings, type EnrichedWordContent } from '../services/wordEnrichment';

export type RepairKind = 'content' | 'tts' | 'exampleMeaning';
/** Re-rolling an example sentence is a distinct intent from filling its blank. */
export type ExampleKind = 'example';
export type PlanKind = RepairKind | ExampleKind;

export type TtsField = 'word' | 'example';

export interface ContentFinding { kind: 'content'; card: Flashcard; language: string; }
export interface TtsFinding { kind: 'tts'; card: Flashcard; language: string; field: TtsField; text: string; }
export interface ExampleMeaningFinding { kind: 'exampleMeaning'; card: Flashcard; language: string; exampleText: string; }
export interface ExampleFinding { kind: 'example'; card: Flashcard; language: string; }

export type RepairFinding = ContentFinding | TtsFinding | ExampleMeaningFinding | ExampleFinding;

/** Which cards a scan considers. */
export type CardScope = 'all' | 'language';
export type ContentScope = 'language' | 'all';

/** A card counts as having content unless it carries a real meaning. */
export const hasMeaning = (card: Flashcard): boolean => {
  const back = card.content.back;
  return !!back && back.trim() !== '' && back !== '-';
};

/** Placeholder text means "deliberately nothing here", same as the Generate tab. */
const isPlaceholder = (value: string | undefined): boolean => !value || value.trim() === '' || value === '-';

export interface TtsScanDeps {
  /** Resolves whether audio already exists for a card field. */
  getExistingTts: (cardId: string, field: TtsField) => Promise<boolean>;
  /** Resolves when the audio was generated, for the `olderThan` mode. */
  getTtsGeneratedAt?: (cardId: string, field: TtsField) => Promise<number | null>;
  /** The text that would be spoken, already stripped for TTS. */
  getSpeakableText: (card: Flashcard, field: TtsField) => string;
}

export interface ScanOptions {
  scope?: CardScope;
  activeLanguage: string;
  include?: readonly PlanKind[];
  autoGenerateAudio?: boolean;
  llmReady?: boolean;
  /** Re-roll existing assets instead of only missing ones. */
  ttsMode?: 'onlyEmpty' | 'replaceAll' | 'olderThan';
  /** Re-roll existing example sentences instead of only missing ones. */
  exampleMode?: 'onlyEmpty' | 'replaceAll';
  olderThanCutoff?: number;
}

const languageOf = (card: Flashcard, activeLanguage: string): string => card.language || activeLanguage;

const defaultInclude: readonly PlanKind[] = ['content', 'tts', 'exampleMeaning'];

/**
 * Scan cards for absent (or, in a re-roll mode, stale) assets.
 * Every field is a dependency so this stays pure and testable; the bridge-backed
 * lookups are supplied by the caller.
 */
export async function planFlashcardRepair(
  cards: readonly Flashcard[],
  options: ScanOptions,
  tts: TtsScanDeps,
): Promise<RepairFinding[]> {
  const include = options.include ?? defaultInclude;
  const findings: RepairFinding[] = [];
  const scope = options.scope ?? 'all';
  const reRoll = options.ttsMode === 'replaceAll';
  const reRollExample = options.exampleMode === 'replaceAll';
  const olderThan = options.ttsMode === 'olderThan' ? (options.olderThanCutoff ?? 0) : null;

  for (const card of cards) {
    const language = languageOf(card, options.activeLanguage);
    if (scope === 'language' && language !== options.activeLanguage) continue;

    if (include.includes('content') && !hasMeaning(card)) {
      // A learner who deliberately cleared the meaning owns that blank; any
      // other edit (a typed reading, a captured image) is not a cleared meaning.
      if (!(card.content.userEditedFields ?? []).includes('back')) {
        findings.push({ kind: 'content', card, language });
      }
    }

    if (include.includes('tts')) {
      for (const field of ['word', 'example'] as const) {
        if (field === 'example' && (card.content.skipExampleTts || card.content.videoUrl)) continue;
        const text = tts.getSpeakableText(card, field);
        if (!text || text === '-') continue;
        if (options.autoGenerateAudio === false) continue;
        if (olderThan !== null) {
          const at = (await tts.getTtsGeneratedAt?.(card.id, field)) ?? null;
          if (at !== null && at >= olderThan) continue;
        } else if (!reRoll) {
          if (await tts.getExistingTts(card.id, field)) continue;
        }
        findings.push({ kind: 'tts', card, language, field, text });
      }
    }

    if (include.includes('exampleMeaning')) {
      const example = card.content.example;
      if (example && !isPlaceholder(example) && options.llmReady && isPlaceholder(card.content.exampleMeaning)) {
        findings.push({ kind: 'exampleMeaning', card, language, exampleText: example });
      }
    }

    if (include.includes('example')) {
      // An example can only be generated against a meaning; a shell card is the
      // content repair's job, and the runner runs content first anyway.
      if (hasMeaning(card) && (reRollExample || isPlaceholder(card.content.example))) {
        findings.push({ kind: 'example', card, language });
      }
    }
  }
  return findings;
}

export const countByKind = (findings: readonly RepairFinding[]): Record<RepairKind, number> => ({
  content: findings.filter((f) => f.kind === 'content').length,
  tts: findings.filter((f) => f.kind === 'tts').length,
  exampleMeaning: findings.filter((f) => f.kind === 'exampleMeaning').length,
});

export const countExamples = (findings: readonly RepairFinding[]): number =>
  findings.filter((f) => f.kind === 'example').length;

/** The content fix for one card, or null when the dictionary has no entry. */
export async function buildContentUpdate(
  finding: ContentFinding,
  deps: {
    getLanguageData: (language: string) => LanguageData | null;
    settings: DictionaryTargetSettings;
    enrich?: typeof enrichWord;
  },
): Promise<{ cardId: string; language: string; content: Partial<FlashcardContent> } | null> {
  const enriched = await (deps.enrich ?? enrichWord)({
    word: finding.card.content.front,
    language: finding.language,
    languageData: deps.getLanguageData(finding.language),
    settings: deps.settings,
    currentContent: finding.card.content,
  });
  if (!enriched) return null;
  return { cardId: finding.card.id, language: finding.language, content: { ...enriched, unpopulated: false } };
}

export type { EnrichedWordContent };
