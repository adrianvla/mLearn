import {
  calibrationUnmeasuredCandidates,
  curriculumCandidates,
  mediaOpportunityCandidates,
  retentionDueCandidates,
  suggestedLearningCandidates,
  type CalibrationPoolItem,
  type FlashcardLike,
  type LearnableWordSourceItem,
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
  ratingMode: 'profile',
};

const CALIBRATION_TASK: EncounterTask = {
  taskTemplateId: 'word-sync',
  inputModality: 'text',
  responseModality: 'self-assessment',
  supplied: ['surface'],
  requested: ['meaning'],
  fluencyRequired: false,
  ratingMode: 'profile',
};

export const PRESETS: Record<'RETENTION' | 'CALIBRATION' | 'CURRICULUM' | 'MEDIA' | 'SUGGESTED', Preset> = {
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
  CURRICULUM: {
    weights: { 'curriculum-relevance': 1 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 0,
    probeCooldownMs: 0,
    minRepeatDistance: 0,
    task: CALIBRATION_TASK,
  },
  MEDIA: {
    weights: { novelty: 1 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 0,
    probeCooldownMs: 0,
    minRepeatDistance: 0,
    task: CALIBRATION_TASK,
  },
  SUGGESTED: {
    weights: { 'curriculum-relevance': 1 },
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
  | { preset: 'CURRICULUM'; levelStudyItems: readonly LearnableWordSourceItem[] }
  | { preset: 'MEDIA'; mediaItems: readonly LearnableWordSourceItem[] }
  | { preset: 'SUGGESTED'; suggestedItems: readonly LearnableWordSourceItem[] }
);

/** Pure entry point for adapting source-specific pools into teaching-policy candidates. */
export function selectNextEncounter(inputs: EncounterInputs): PolicyDecision | null {
  const candidates = sourceCandidates(inputs);
  const preset = PRESETS[inputs.preset];

  return selectNext(candidates, {
    ...preset,
    ...inputs.config,
    nowMs: inputs.nowMs,
    cooldowns: inputs.cooldowns ?? new Map(),
    recentPicks: inputs.recentPicks ?? [],
  }, inputs.rng);
}

/** Policy-backed identity selection for surfaces that intentionally present every eligible candidate. */
export function selectEncounterBatch(inputs: EncounterInputs): PolicyDecision[] {
  const decisions: PolicyDecision[] = [];
  for (const candidate of sourceCandidates(inputs)) {
    const decision = selectNext([candidate], {
      ...PRESETS[inputs.preset],
      ...inputs.config,
      nowMs: inputs.nowMs,
      cooldowns: inputs.cooldowns ?? new Map(),
      recentPicks: inputs.recentPicks ?? [],
    }, inputs.rng);
    if (decision && decision.action !== 'DEFER') decisions.push(decision);
  }
  return decisions;
}

function sourceCandidates(inputs: EncounterInputs) {
  switch (inputs.preset) {
    case 'RETENTION': return retentionDueCandidates(inputs.reviewQueueEntries, inputs.nowMs);
    case 'CALIBRATION': return calibrationUnmeasuredCandidates(inputs.wordSyncPoolItems);
    case 'CURRICULUM': return curriculumCandidates(inputs.levelStudyItems);
    case 'MEDIA': return mediaOpportunityCandidates(inputs.mediaItems);
    case 'SUGGESTED': return suggestedLearningCandidates(inputs.suggestedItems);
  }
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
