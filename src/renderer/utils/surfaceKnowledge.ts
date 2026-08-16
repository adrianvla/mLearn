/**
 * Surface-weighted knowledge reads for word surfaces.
 *
 * Builds the ComprehensiveKnowledgeDeps the aspect utilities need from the
 * FlashcardContext store + language/settings contexts (mirroring the dep
 * assembly inside FlashcardContext) and exposes:
 * - effectiveStatus: surface-weighted blend via getEffectiveKnowledge
 *   ('video' for subtitles, 'reader' for the reader).
 * - readingStatus / prosodyStatus: per-aspect status via getAspectStatusSync.
 * - meaningEase: the resolved meaning ease (for colored-prosody ease mixing).
 *
 * All reads are read-time only — nothing is persisted, and the 'other'
 * profile is the identity mapping (meaning only).
 */

import {
  DEFAULT_SETTINGS,
  type Flashcard,
  type IgnoredWordEntry,
  type LanguageData,
  type PassiveWordKnowledge,
  type Settings,
} from '../../shared/types';
import { getAvailableAspects } from '../../shared/types';
import type { KnowledgeSurface, WordStatus } from '../../shared/constants';
import { hashWordSync } from '../services/srsAlgorithm';
import { ankiCacheVersion, findAnkiWordMatchInCache } from '../services/ankiWordsCache';
import { getAnkiWordKnowledgeStatus } from '../components/subtitle/wordHoverHelpers';
import { getWordFormCandidates } from './wordForms';
import { getAspectStatusSync, getEffectiveKnowledge } from './aspectKnowledge';
import type { ComprehensiveKnowledgeDeps } from './comprehensiveKnowledge';

export interface SurfaceKnowledgeInput {
  getCanonicalForm: (word: string) => string;
  getWordVariants: (word: string) => string[];
  languageData: () => LanguageData | null | undefined;
  settings: () => Settings;
  wordKnowledge: Record<string, PassiveWordKnowledge>;
  knownUntracked: Record<string, boolean>;
  ignoredWords: Record<string, IgnoredWordEntry>;
  getCardByWordSync: (word: string, language?: string) => Flashcard | null;
}

export interface SurfaceKnowledgeApi {
  effectiveStatus: (word: string, language: string, surface: KnowledgeSurface) => WordStatus;
  readingStatus: (word: string, language: string) => WordStatus;
  prosodyStatus: (word: string, language: string) => WordStatus;
  meaningEase: (word: string, language: string) => number | undefined;
}

function passiveLearningEaseThreshold(settings: Settings): number {
  return settings.easeThresholdLearning ?? ((settings.srsLearningThreshold ?? DEFAULT_SETTINGS.srsLearningThreshold) / 1000);
}

function passiveKnownEaseThreshold(settings: Settings): number {
  return settings.easeThresholdKnown ?? ((settings.known_ease_threshold ?? DEFAULT_SETTINGS.known_ease_threshold) / 1000);
}

/** Mirrors FlashcardContext's getAnkiStatusForWord (same cache + thresholds). */
function resolveAnkiStatus(
  word: string,
  language: string,
  settings: Settings,
  languageData: LanguageData | null | undefined,
  getForms: (word: string) => string[],
): WordStatus | null {
  ankiCacheVersion();
  if (!settings.use_anki) return null;
  const match = findAnkiWordMatchInCache(getForms(word), {
    language,
    languageData,
    ankiLearningThreshold: settings.ankiLearningThreshold,
    ankiKnownThreshold: settings.ankiKnownThreshold,
  });
  if (!match?.cards?.length) return null;
  return getAnkiWordKnowledgeStatus(match.cards, settings.ankiLearningThreshold, settings.ankiKnownThreshold);
}

export function createSurfaceKnowledge(input: SurfaceKnowledgeInput): SurfaceKnowledgeApi {
  const getForms = (word: string, languageData: LanguageData | null | undefined): string[] =>
    getWordFormCandidates(word, input.getCanonicalForm, input.getWordVariants, { languageData });

  const buildDeps = (word: string, language: string): ComprehensiveKnowledgeDeps => {
    const settings = input.settings();
    const languageData = input.languageData();
    const langKey = (lang: string, hash: string): string => `${lang}:${hash}`;
    return {
      getCanonicalForm: (value: string) => getForms(value, languageData)[0] ?? value,
      getWordForms: (value: string) => getForms(value, languageData),
      hashWordSync,
      langKey,
      language,
      knownUntracked: input.knownUntracked,
      ignoredWords: input.ignoredWords,
      wordKnowledge: input.wordKnowledge,
      knownEaseThreshold: passiveKnownEaseThreshold(settings),
      learningThreshold: passiveLearningEaseThreshold(settings),
      getCardByWordSync: (value: string) => input.getCardByWordSync(value, language),
      ankiStatus: resolveAnkiStatus(word, language, settings, languageData, (value) => getForms(value, languageData)),
      sourceOrder: settings.knowledgeSourceOrder ?? DEFAULT_SETTINGS.knowledgeSourceOrder,
      resolutionMode: settings.knowledgeResolutionMode ?? DEFAULT_SETTINGS.knowledgeResolutionMode,
    };
  };

  return {
    effectiveStatus: (word, language, surface) => {
      const available = getAvailableAspects(input.languageData() ?? undefined);
      return getEffectiveKnowledge(word, surface, buildDeps(word, language), available).status;
    },
    readingStatus: (word, language) => getAspectStatusSync(word, 'reading', buildDeps(word, language)).status,
    prosodyStatus: (word, language) => getAspectStatusSync(word, 'prosody', buildDeps(word, language)).status,
    meaningEase: (word, language) => getAspectStatusSync(word, 'meaning', buildDeps(word, language)).ease,
  };
}
