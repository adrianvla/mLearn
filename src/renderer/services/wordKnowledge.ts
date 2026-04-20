import type { Flashcard } from '../../shared/types';
import type { KnowledgeResolutionMode, KnowledgeSource, WordStatus } from '../../shared/constants';
import { getWordFormCandidates } from '../utils/wordForms';
import { getWordStatus } from './statsService';
import { findAnkiWordMatchInCache, type AnkiWordCacheMatch } from './ankiWordsCache';
import {
  getAnkiWordKnowledgeStatus,
  getEffectiveWordStatus,
  numericToWordStatus,
} from '../components/subtitle/wordHoverHelpers';

interface ResolveWordKnowledgeArgs {
  word: string;
  getCanonicalForm: (word: string) => string;
  getWordVariants?: (word: string) => string[];
  getCardByWordSync: (word: string) => Flashcard | null;
  useAnki: boolean;
  ankiLearningThreshold: number;
  ankiKnownThreshold: number;
  knowledgeSourceOrder: readonly KnowledgeSource[];
  knowledgeResolutionMode: KnowledgeResolutionMode;
}

export interface ResolvedWordKnowledge {
  wordForms: string[];
  primaryWord: string;
  aliasWords: string[];
  card: Flashcard | null;
  manualStatus: WordStatus;
  ankiMatch: AnkiWordCacheMatch | null;
  ankiStatus: WordStatus | null;
  status: WordStatus;
}

export function resolveRendererWordKnowledge({
  word,
  getCanonicalForm,
  getWordVariants,
  getCardByWordSync,
  useAnki,
  ankiLearningThreshold,
  ankiKnownThreshold,
  knowledgeSourceOrder,
  knowledgeResolutionMode,
}: ResolveWordKnowledgeArgs): ResolvedWordKnowledge {
  const wordForms = getWordFormCandidates(word, getCanonicalForm, getWordVariants);
  const primaryWord = wordForms[0] ?? word;
  const aliasWords = wordForms.slice(1);
  const card = getCardByWordSync(word);
  const manualStatus = numericToWordStatus(getWordStatus(primaryWord, aliasWords));
  const ankiMatch = useAnki ? findAnkiWordMatchInCache(wordForms) : null;
  const ankiStatus = getAnkiWordKnowledgeStatus(
    ankiMatch?.cards,
    ankiLearningThreshold,
    ankiKnownThreshold,
  );

  return {
    wordForms,
    primaryWord,
    aliasWords,
    card,
    manualStatus,
    ankiMatch,
    ankiStatus,
    status: getEffectiveWordStatus(
      card,
      manualStatus,
      ankiStatus,
      knowledgeSourceOrder,
      knowledgeResolutionMode,
    ),
  };
}
