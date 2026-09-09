import {
  bridgeCandidates,
  calibrationUnmeasuredCandidates,
  curriculumCandidates,
  curriculumGrammarCandidates,
  grammarEncounterCandidates,
  mediaOpportunityCandidates,
  probeCandidates,
  retentionDueCandidates,
  suggestedLearningCandidates,
  weakTargetCandidates,
  type BridgeCandidateInput,
  type CalibrationPoolItem,
  type FlashcardLike,
  type CurriculumGrammarItem,
  type GrammarEncounterEntry,
  type LearnableWordSourceItem,
  type SupportedProbeTarget,
  type WeakTargetEntry,
} from './candidateSources';
import { selectNext, type Rng, type TeachingPolicyConfig } from './teachingPolicy';
import { surfaceEntityId } from '../../shared/graph/load';
import { hashWordSync } from '../services/srsAlgorithm';
import type { CapabilityKind } from '../../shared/graph/types';
import type { EncounterTask, PolicyDecision } from './types';

type Preset = Omit<TeachingPolicyConfig, 'nowMs' | 'cooldowns' | 'recentPicks'>;

const RETENTION_TASK: EncounterTask = {
  taskTemplateId: 'flashcard-review',
  inputModality: 'written-form',
  responseModality: 'recall',
  supplied: ['written-form'],
  requested: ['meaning'],
  fluencyRequired: true,
  ratingMode: 'profile',
};

const CALIBRATION_TASK: EncounterTask = {
  taskTemplateId: 'word-sync',
  inputModality: 'written-form',
  responseModality: 'self-assessment',
  supplied: ['written-form'],
  requested: ['lexical-identity', 'meaning', 'pronunciation'],
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
    // Probes score information-gain/uncertainty; weak targets score
    // curriculum-relevance; bridges complete the graph cheaply — their
    // predicted accessibility discounts attention-cost.
    weights: { 'information-gain': 1, uncertainty: 1, novelty: 1, 'curriculum-relevance': 1, 'attention-cost': -0.5 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 1,
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
  /** Low-evidence learning-band words merged into the RETENTION and CALIBRATION pools (REQ24). */
  weakTargets?: readonly WeakTargetEntry[];
  /** Unmeasured probe targets merged into the CALIBRATION pool (REQ24). */
  probeTargets?: readonly SupportedProbeTarget[];
  /** Grammar exposure snapshot merged into the SUGGESTED pool (REQ39). */
  grammarEncounters?: readonly GrammarEncounterEntry[];
  /** Package-declared curriculum grammar constructions merged into the CURRICULUM pool. */
  curriculumGrammarItems?: readonly CurriculumGrammarItem[];
  /** Synchronized-object written bridges merged into the CALIBRATION pool. */
  bridgeItems?: readonly BridgeCandidateInput[];
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
    case 'RETENTION':
      // Weak targets are fallback fill: the retention preset weighs only
      // retention-need, so they surface when no due card outranks them.
      return [
        ...retentionDueCandidates(inputs.reviewQueueEntries, inputs.nowMs),
        ...weakTargetCandidates(inputs.weakTargets ?? []),
      ];
    case 'CALIBRATION':
      return [
        ...calibrationUnmeasuredCandidates(inputs.wordSyncPoolItems),
        ...bridgeCandidates(inputs.bridgeItems ?? []),
        ...weakTargetCandidates(inputs.weakTargets ?? []),
        // Floor 0 probes any target with residual uncertainty; the policy layer
        // still enforces probe budget and cooldown on selection.
        ...probeCandidates(inputs.probeTargets ?? [], {
          nowMs: inputs.nowMs,
          cooldownMs: PRESETS.CALIBRATION.probeCooldownMs,
          uncertaintyFloor: 0,
          cooldowns: inputs.cooldowns ?? new Map(),
        }),
      ];
    case 'CURRICULUM': return [
      ...curriculumCandidates(inputs.levelStudyItems),
      ...curriculumGrammarCandidates(inputs.curriculumGrammarItems ?? []),
    ];
    case 'MEDIA': return mediaOpportunityCandidates(inputs.mediaItems);
    case 'SUGGESTED':
      return [
        ...suggestedLearningCandidates(inputs.suggestedItems),
        ...grammarEncounterCandidates(inputs.grammarEncounters ?? []),
      ];
  }
}

export function calibrationPoolItem(
  key: string,
  word: string,
  language: string,
  novelty: number,
  options?: { bridge?: boolean },
): CalibrationPoolItem {
  return {
    key,
    word,
    language,
    targets: [{ entityId: surfaceEntityId(language, hashWordSync(word)), capability: 'surface-recognition' }],
    scores: {
      novelty,
      // A bridge candidate (known lexical object, one missing directed
      // access) is a cheap, high-value measurement — the CALIBRATION preset
      // weights information-gain, so this lifts it in the policy pick.
      ...(options?.bridge ? { 'information-gain': 1 } : {}),
    },
    ...(options?.bridge ? { meta: { bridge: ['surface-recognition'] as const satisfies readonly CapabilityKind[] } } : {}),
  };
}
