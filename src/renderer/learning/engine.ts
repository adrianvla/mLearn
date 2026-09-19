import {
  bridgeCandidates,
  calibrationUnmeasuredCandidates,
  curriculumCandidates,
  curriculumGrammarCandidates,
  grammarEncounterCandidates,
  mediaOpportunityCandidates,
  mediaRelevanceCandidates,
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
  type MediaOpportunityInput,
  type SupportedProbeTarget,
  type WeakTargetEntry,
} from './candidateSources';
import { selectNext, type Rng, type TeachingPolicyConfig } from './teachingPolicy';
import type { EncounterTask, PolicyContext, PolicyDecision } from './types';

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
    // Repair (retention-need) and queued-new exploration (novelty) weigh
    // equally: the score VALUES carry the discrimination, and the goal
    // context shifts the allocation (deadline boosts repair, discounts
    // exploration — the Bob R07 lever on a real review-queue pool).
    weights: { 'retention-need': 1, novelty: 1 },
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
    // Curriculum membership, media-fit recurrence, and plain novelty all
    // weight equally: the score VALUES carry the discrimination (a recurring
    // unmeasured media term outranks a known-list word that yields no
    // candidate at all). Grammar candidates score curriculum-relevance only.
    weights: { 'curriculum-relevance': 1, 'media-relevance': 1, novelty: 1 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 0,
    probeCooldownMs: 0,
    minRepeatDistance: 0,
    task: CALIBRATION_TASK,
  },
  MEDIA: {
    weights: { novelty: 1, 'media-relevance': 1 },
    deferFloor: 0,
    attentionBudgetRemaining: 1,
    probeBudgetRemaining: 0,
    probeCooldownMs: 0,
    minRepeatDistance: 0,
    task: CALIBRATION_TASK,
  },
  SUGGESTED: {
    // Curriculum membership and media-fit recurrence weigh equally; the
    // score values carry the discrimination (recurrence vs one-off capture).
    weights: { 'curriculum-relevance': 1, 'media-relevance': 1 },
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
  /** Learner goal/intensity context (R07/R08); absent = legacy behavior. */
  context?: PolicyContext;
  /** Low-evidence learning-band words merged into the RETENTION and CALIBRATION pools (REQ24). */
  weakTargets?: readonly WeakTargetEntry[];
  /** Unmeasured probe targets merged into the CALIBRATION pool (REQ24). */
  probeTargets?: readonly SupportedProbeTarget[];
  /** Grammar exposure snapshot merged into the SUGGESTED pool (REQ39). */
  grammarEncounters?: readonly GrammarEncounterEntry[];
  /** Package-declared curriculum grammar constructions merged into the CURRICULUM pool. */
  curriculumGrammarItems?: readonly CurriculumGrammarItem[];
  /** Category-bottleneck pressure applied to grammar constructions in the CURRICULUM pool (R07). */
  grammarCategoryPressure?: Readonly<Record<string, number>>;
  /** Synchronized-object written bridges merged into the CALIBRATION pool. */
  bridgeItems?: readonly BridgeCandidateInput[];
  /** Current-content recurring terms merged into the CURRICULUM pool (R21). */
  mediaOpportunities?: readonly MediaOpportunityInput[];
};

export type EncounterInputs = CommonInputs & (
  | { preset: 'RETENTION'; reviewQueueEntries: readonly FlashcardLike[] }
  | { preset: 'CALIBRATION'; wordSyncPoolItems: readonly CalibrationPoolItem[] }
  | { preset: 'CURRICULUM'; levelStudyItems: readonly LearnableWordSourceItem[] }
  | { preset: 'MEDIA'; mediaItems: readonly LearnableWordSourceItem[]; mediaOpportunities?: readonly MediaOpportunityInput[] }
  | { preset: 'SUGGESTED'; suggestedItems: readonly LearnableWordSourceItem[] }
);

/** Pure entry point for adapting source-specific pools into teaching-policy candidates. */
export function selectNextEncounter(inputs: EncounterInputs): PolicyDecision | null {
  const candidates = sourceCandidates(inputs);
  const preset = PRESETS[inputs.preset];

  return selectNext(candidates, {
    ...preset,
    ...inputs.config,
    context: inputs.context ?? inputs.config?.context,
    nowMs: inputs.nowMs,
    cooldowns: inputs.cooldowns ?? new Map(),
    recentPicks: inputs.recentPicks ?? [],
  }, inputs.rng);
}

/**
 * Policy-RANKED walk (R21): repeatedly selectNext over the same pool with
 * hysteresis excluding already-picked candidates (the GrammarCoverage pass
 * pattern), up to `count`. A DEFER or empty pool ends the walk early (G04).
 * Use when a caller must allocate a bounded budget by policy order —
 * identity surfaces keep using selectEncounterBatch.
 */
export function selectRankedEncounters(inputs: EncounterInputs, count: number): PolicyDecision[] {
  const candidates = sourceCandidates(inputs);
  const preset = PRESETS[inputs.preset];
  const decisions: PolicyDecision[] = [];
  const recentPicks: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const decision = selectNext(candidates, {
      ...preset,
      ...inputs.config,
      context: inputs.context ?? inputs.config?.context,
      nowMs: inputs.nowMs,
      cooldowns: inputs.cooldowns ?? new Map(),
      recentPicks,
      minRepeatDistance: Math.max(inputs.config?.minRepeatDistance ?? preset.minRepeatDistance, candidates.length),
    }, inputs.rng);
    if (!decision || decision.action === 'DEFER') break;
    decisions.push(decision);
    recentPicks.push(decision.candidate.key);
  }
  return decisions;
}

/** Policy-backed identity selection for surfaces that intentionally present every eligible candidate. */
export function selectEncounterBatch(inputs: EncounterInputs): PolicyDecision[] {
  const decisions: PolicyDecision[] = [];
  for (const candidate of sourceCandidates(inputs)) {
    const decision = selectNext([candidate], {
      ...PRESETS[inputs.preset],
      ...inputs.config,
      context: inputs.context ?? inputs.config?.context,
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
      ...curriculumGrammarCandidates(inputs.curriculumGrammarItems ?? [], {
        categoryPressure: inputs.grammarCategoryPressure,
      }),
      // Current-content recurring terms compete in the same weighted pick
      // (R21): the same policy ranks them, the same trace explains them.
      ...mediaRelevanceCandidates(inputs.mediaOpportunities ?? []),
    ];
    case 'MEDIA':
      // Plain novelty items keep the legacy shape; rich media-fit inputs
      // (recurrence + canonical status) ride the same preset when supplied.
      return [
        ...mediaOpportunityCandidates(inputs.mediaItems),
        ...mediaRelevanceCandidates(inputs.mediaOpportunities ?? []),
      ];
    case 'SUGGESTED':
      return [
        ...suggestedLearningCandidates(inputs.suggestedItems),
        ...grammarEncounterCandidates(inputs.grammarEncounters ?? []),
        // Current-content recurring terms ride the suggested pool too (R21):
        // auto-promotion of captured words is ranked by the SAME policy, so
        // recurrence in the learner's selected media genuinely reorders what
        // gets created first.
        ...mediaRelevanceCandidates(inputs.mediaOpportunities ?? []),
      ];
  }
}
