import { SRS_EASE } from '../../shared/constants';
import { grammarEntityId } from '../../shared/graph/load';
import type { LearnableTarget } from '../../shared/graph/types';
import type { Candidate } from './types';

export interface FlashcardLike {
  id: string;
  word?: string;
  language: string;
  targets: LearnableTarget[];
  dueDate: number;
  interval: number;
  /** Derived retention pressure when the scheduler has already replayed evidence. */
  pressure?: number;
  suspended?: boolean;
  buried?: boolean;
}

export type CalibrationPoolItem = Omit<Candidate, 'origin'>;

export interface LearnableWordSourceItem {
  key: string;
  word: string;
  language: string;
}

export interface WeakTargetEntry {
  word: string;
  language: string;
  status: 'unknown' | 'learning' | 'known';
  ease: number;
}

export interface SupportedProbeTarget {
  target: LearnableTarget;
  pSuccess: number;
  uncertainty: number;
}

export interface ProbeCooldownState {
  nowMs: number;
  cooldownMs: number;
  uncertaintyFloor: number;
  cooldowns: ReadonlyMap<string, number>;
}

export interface GrammarEncounterEntry {
  pattern: string;
  language: string;
  /** Passive exposure count (timesEncountered from the grammar knowledge store / evidence replay). */
  timesEncountered: number;
  /** True when recorded evidence or an explicit claim already measures the pattern. */
  measured: boolean;
}

export interface GrammarEncounterOptions {
  /** Patterns below this passive exposure count are not offered yet. */
  minEncounters?: number;
  /** Exposure count mapped to a full relevance score. Defaults to twice minEncounters. */
  saturationCount?: number;
}

export function retentionDueCandidates(cards: readonly FlashcardLike[], nowMs: number): Candidate[] {
  return cards
    .filter((card) => card.dueDate <= nowMs && !card.suspended && !card.buried)
    .map((card) => ({
      key: card.id,
      word: card.word,
      language: card.language,
      targets: card.targets,
      origin: 'retention',
      scores: {
        'retention-need': card.pressure ?? clamp((nowMs - card.dueDate) / Math.max(1, card.interval)),
      },
    }));
}

export function calibrationUnmeasuredCandidates(poolItems: readonly CalibrationPoolItem[]): Candidate[] {
  return poolItems.map((item) => ({ ...item, origin: 'calibration' }));
}

export function curriculumCandidates(items: readonly LearnableWordSourceItem[]): Candidate[] {
  return wordCandidates(items, 'curriculum', 'curriculum-relevance');
}

export function mediaOpportunityCandidates(items: readonly LearnableWordSourceItem[]): Candidate[] {
  return wordCandidates(items, 'media', 'novelty');
}

export function suggestedLearningCandidates(items: readonly LearnableWordSourceItem[]): Candidate[] {
  return wordCandidates(items, 'curriculum', 'curriculum-relevance');
}

export function weakTargetCandidates(entries: readonly WeakTargetEntry[]): Candidate[] {
  const learningRange = SRS_EASE.DEFAULT_KNOWN - SRS_EASE.MIN;
  return entries
    .filter((entry) => entry.status === 'learning')
    .map((entry) => ({
      key: `${entry.language}:${entry.word}`,
      word: entry.word,
      language: entry.language,
      targets: [{
        entityId: `${entry.language}:surface:${entry.word}`,
        capability: 'surface-recognition',
      }],
      origin: 'weak-target',
      scores: {
        'curriculum-relevance': clamp((entry.ease - SRS_EASE.MIN) / learningRange),
      },
    }));
}

/**
 * REQ39 exposure source: repeatedly-seen-but-unmeasured grammar patterns gain
 * candidate priority through the teaching policy's weighted pick. Pure selector
 * over the caller-supplied exposure snapshot — never writes knowledge.
 */
export function grammarEncounterCandidates(
  entries: readonly GrammarEncounterEntry[],
  options: GrammarEncounterOptions = {},
): Candidate[] {
  const minEncounters = options.minEncounters ?? 3;
  const saturation = Math.max(1, options.saturationCount ?? minEncounters * 2);
  return entries
    .filter((entry) => !entry.measured && entry.timesEncountered >= minEncounters)
    .map((entry) => ({
      key: grammarEntityId(entry.language, entry.pattern),
      language: entry.language,
      targets: [{
        entityId: grammarEntityId(entry.language, entry.pattern),
        capability: 'grammar-recognition',
      }],
      origin: 'grammar',
      scores: { 'curriculum-relevance': clamp(entry.timesEncountered / saturation) },
      meta: { pattern: entry.pattern, timesEncountered: entry.timesEncountered },
    }));
}

export function probeCandidates(
  supportedTargets: readonly SupportedProbeTarget[],
  cooldownState: ProbeCooldownState,
): Candidate[] {
  return supportedTargets.flatMap(({ target, pSuccess, uncertainty }) => {
    const key = `${target.entityId}:${target.capability}`;
    const lastProbeAt = cooldownState.cooldowns.get(key);
    const cooldownPassed = lastProbeAt === undefined
      || cooldownState.nowMs - lastProbeAt >= cooldownState.cooldownMs;
    if (uncertainty <= cooldownState.uncertaintyFloor || !cooldownPassed) return [];

    return [{
      key,
      language: target.entityId.split(':', 1)[0],
      targets: [target],
      origin: 'probe',
      scores: {
        'information-gain': binaryEntropy(clamp(pSuccess)),
        uncertainty,
      },
      meta: { pSuccess },
    }];
  });
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function wordCandidates(
  items: readonly LearnableWordSourceItem[],
  origin: Candidate['origin'],
  score: 'curriculum-relevance' | 'novelty',
): Candidate[] {
  return items.map((item) => ({
    ...item,
    targets: [{ entityId: `${item.language}:surface:${item.word}`, capability: 'surface-recognition' }],
    origin,
    scores: { [score]: 1 },
  }));
}

function binaryEntropy(probability: number): number {
  if (probability === 0 || probability === 1) return 0;
  return -probability * Math.log2(probability)
    - (1 - probability) * Math.log2(1 - probability);
}
