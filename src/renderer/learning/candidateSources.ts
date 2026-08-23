import { SRS_EASE } from '../../shared/constants';
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

function binaryEntropy(probability: number): number {
  if (probability === 0 || probability === 1) return 0;
  return -probability * Math.log2(probability)
    - (1 - probability) * Math.log2(1 - probability);
}
