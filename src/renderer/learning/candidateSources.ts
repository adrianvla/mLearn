import { SRS_EASE } from '../../shared/constants';
import { grammarEntityId } from '../../shared/graph/load';
import type { LearnableTarget } from '../../shared/graph/types';
import type { Candidate } from './types';
import { GRAMMAR_RECOGNIZE_TASK } from './types';

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

/**
 * A missing written bridge on an ALREADY-SYNCHRONIZED lexical object (sense
 * or spoken access known, graph-resolved across variant surfaces). Completing
 * one directed access is cheap graph completion, not teaching a novel word.
 */
export interface BridgeCandidateInput {
  key: string;
  word: string;
  language: string;
  /** The missing written accesses (surface-recognition / surface-reading targets). */
  missingBridges: readonly LearnableTarget[];
  /** Graph-relative predicted accessibility of the bridge (entry + character support). */
  pSuccess?: number;
  /** The lexical object is synchronized (sense/spoken known through any authoritative variant). */
  synchronized: boolean;
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

/**
 * Bridge source: synchronized lexical objects with missing written accesses.
 * Value ≈ useful graph completion ÷ teaching cost — information-gain is full
 * (the graph genuinely completes), novelty is zero (nothing linguistically
 * new), and attention-cost falls as the graph-relative prediction rises, so
 * cheap bridges outrank novel objects under a cost-aware policy.
 */
export function bridgeCandidates(items: readonly BridgeCandidateInput[]): Candidate[] {
  return items.filter((item) => item.synchronized).map((item) => ({
    key: item.key,
    word: item.word,
    language: item.language,
    targets: [...item.missingBridges],
    origin: 'bridge' as const,
    scores: {
      'information-gain': 1,
      novelty: 0,
      uncertainty: 1,
      'attention-cost': item.pSuccess !== undefined ? clamp(1 - item.pSuccess) : 0.5,
    },
    meta: { bridge: true, ...(item.pSuccess !== undefined ? { pSuccess: item.pSuccess } : {}) },
  }));
}

export function curriculumCandidates(items: readonly LearnableWordSourceItem[]): Candidate[] {
  return wordCandidates(items, 'curriculum', 'curriculum-relevance');
}

/** Package-declared curriculum membership for one grammar construction. */
export interface CurriculumGrammarItem {
  language: string;
  pattern: string;
  /** Bucket on the language's OWN grammar scale (GrammarPoint.level). */
  level: number;
  /** Optional package-defined weight; default 1. */
  weight?: number;
}

/**
 * Curriculum grammar source: constructions the package's curriculum data
 * places on its grammar scale, emitted as first-class curriculum candidates
 * whose task template declares that it measures grammar-recognition. Lexical
 * curriculum flow (level-study bulk add) does NOT consume these — they have
 * no word form.
 */
export function curriculumGrammarCandidates(items: readonly CurriculumGrammarItem[]): Candidate[] {
  return items.map((item) => ({
    key: `${item.language}:grammar:${item.pattern}`,
    language: item.language,
    targets: [{ entityId: grammarEntityId(item.language, item.pattern), capability: 'grammar-recognition' as const }],
    origin: 'curriculum' as const,
    task: GRAMMAR_RECOGNIZE_TASK,
    scores: { 'curriculum-relevance': clamp(item.weight ?? 1) },
    meta: { pattern: item.pattern, level: item.level },
  }));
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
