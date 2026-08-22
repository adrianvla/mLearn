import {
  calibrationUnmeasuredCandidates,
  retentionDueCandidates,
  type CalibrationPoolItem,
  type FlashcardLike,
} from './candidateSources';
import { selectNext, type Rng, type TeachingPolicyConfig } from './teachingPolicy';
import type { EncounterTask, PolicyDecision } from './types';

type Preset = Omit<TeachingPolicyConfig, 'nowMs' | 'cooldowns' | 'recentPicks'>;

const RETENTION_TASK: EncounterTask = {
  taskTemplateId: 'flashcard-review',
  inputModality: 'text',
  responseModality: 'recall',
  supplied: ['surface'],
  requested: ['meaning'],
  fluencyRequired: true,
};

const CALIBRATION_TASK: EncounterTask = {
  taskTemplateId: 'word-sync',
  inputModality: 'text',
  responseModality: 'self-assessment',
  supplied: ['surface'],
  requested: ['meaning'],
  fluencyRequired: false,
};

export const PRESETS: Record<'RETENTION' | 'CALIBRATION', Preset> = {
  RETENTION: {
    weights: { 'retention-need': 1 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 0,
    probeCooldownMs: 0,
    minRepeatDistance: 0,
    task: RETENTION_TASK,
  },
  CALIBRATION: {
    weights: { 'information-gain': 1, uncertainty: 1, novelty: 1 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 0,
    probeCooldownMs: 0,
    minRepeatDistance: 0,
    task: CALIBRATION_TASK,
  },
};

type CommonInputs = {
  nowMs: number;
  cooldowns?: ReadonlyMap<string, number>;
  recentPicks?: readonly string[];
  rng?: Rng;
  config?: Partial<Preset>;
};

export type EncounterInputs = CommonInputs & (
  | { preset: 'RETENTION'; reviewQueueEntries: readonly FlashcardLike[] }
  | { preset: 'CALIBRATION'; wordSyncPoolItems: readonly CalibrationPoolItem[] }
);

/** Pure entry point for adapting source-specific pools into teaching-policy candidates. */
export function selectNextEncounter(inputs: EncounterInputs): PolicyDecision | null {
  const candidates = inputs.preset === 'RETENTION'
    ? retentionDueCandidates(inputs.reviewQueueEntries, inputs.nowMs)
    : calibrationUnmeasuredCandidates(inputs.wordSyncPoolItems);
  const preset = PRESETS[inputs.preset];

  return selectNext(candidates, {
    ...preset,
    ...inputs.config,
    nowMs: inputs.nowMs,
    cooldowns: inputs.cooldowns ?? new Map(),
    recentPicks: inputs.recentPicks ?? [],
  }, inputs.rng);
}

export function calibrationPoolItem(
  key: string,
  word: string,
  language: string,
  novelty: number,
): CalibrationPoolItem {
  return {
    key,
    word,
    language,
    targets: [{ entityId: `${language}:surface:${word}`, capability: 'surface-recognition' }],
    scores: { novelty },
  };
}
