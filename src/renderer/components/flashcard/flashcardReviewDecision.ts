import { activityTask, type ReviewActivity } from './reviewActivities';
import type { Flashcard, LanguageData, ReviewPresentation } from '../../../shared/types';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { surfaceEntityId } from '../../../shared/graph/load';
import { hashWordSync } from '../../services/srsAlgorithm';
import type { FlashcardLike } from '../../learning/candidateSources';
import { PRESETS, selectCounterfactualEncounter } from '../../learning/engine';
import type { PolicyContext, PolicyDecision } from '../../learning/types';
import { isLearningDecision } from '../../../shared/learningDecision';
import type { LearningChoiceSnapshot, LearningDecision } from '../../../shared/learningDecision';

/** Scheduler admission stays separate from the actual retrieval task/address. */
export function flashcardReviewPolicyEntry(card: Flashcard, language: string, languageData?: LanguageData | null, activity?: ReviewActivity): FlashcardLike {
  const requested = activity?.targets ?? [...getTestedAccesses({ languageData, surface: card.content.front,
    hasReadingData: !!card.content.reading && card.content.reading !== card.content.front,
    hasProsodyData: !!card.content.prosody && (card.content.prosody.position !== undefined || !!card.content.prosody.display),
    taskType: 'srs-review' })];
  const entityId = surfaceEntityId(language, hashWordSync(card.content.front));
  return {
    id: card.id, word: card.content.front, language,
    presentation: { cardId: card.id, language, surface: card.content.front, contentVersion: hashWordSync(JSON.stringify(card.content)) },
    targets: requested.map(capability => ({ entityId, capability })),
    task: activity && (activity.kind !== 'holistic' || activity.stages) ? activityTask(activity) : { ...PRESETS.RETENTION.task, supplied: [...PRESETS.RETENTION.task.supplied], requested },
    dueDate: card.dueDate, interval: card.interval, suspended: card.suspended, buried: card.buried, state: card.state,
    scheduledForToday: true, lastReviewed: card.lastReviewed, ease: card.ease, reviews: card.reviews,
  };
}

/** Actual whole scheduler workload, with paired entropy and opaque package tasks. */
export function selectFlashcardReviewDecision(input: { id: string; at: number;
  entries: readonly FlashcardLike[]; context?: PolicyContext; rng?: () => number }) {
  const { selected, baseline } = selectCounterfactualEncounter({ preset: 'RETENTION', nowMs: input.at,
    reviewQueueEntries: input.entries, context: input.context, rng: input.rng,
    config: { preserveActivityChoice: true } });
  if (!selected || selected.action === 'DEFER') return null;
  const snapshot = (choice: PolicyDecision): LearningChoiceSnapshot => ({ key: choice.candidate.key, action: choice.action,
    presentation: input.entries.find(entry => entry.id === choice.candidate.key)?.presentation
      ?? { cardId: choice.candidate.key, language: choice.candidate.language, surface: choice.candidate.word },
    targets: choice.encounter.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability })),
    task: choice.encounter.task });
  const provenance: LearningDecision = { id: input.id, at: input.at, policyVersion: selected.trace!.version,
    selected: snapshot(selected), baseline: baseline && baseline.action !== 'DEFER' ? snapshot(baseline) : null,
    detail: { scope: 'scheduler-admitted-workload', candidateCount: input.entries.length,
      trace: selected.trace, baselineTrace: baseline?.trace, brief: selected.encounter.why,
      limits: ['Action values are model-conditional predictions, not demonstrated causal learning gain.',
        'Bounded traces may omit competitors; the source supplies a bounded admitted workload and records the count.'] } };
  return JSON.parse(JSON.stringify({ decision: selected, provenance })) as { decision: PolicyDecision; provenance: LearningDecision };
}

/** Restore a captured choice only while its actual cue and package task still match. */
export function restoreFlashcardReviewDecision(presentation: ReviewPresentation, card: Flashcard, entry: FlashcardLike) {
  const decision = presentation.decision;
  if (!isLearningDecision(decision) || presentation.cardId !== card.id || decision.selected.key !== card.id
    || decision.selected.presentation?.cardId !== card.id || decision.selected.presentation?.surface !== card.content.front
    || decision.selected.presentation?.language !== entry.language
    || decision.selected.presentation?.contentVersion !== hashWordSync(JSON.stringify(card.content))
    || JSON.stringify(decision.selected.task) !== JSON.stringify(entry.task)) return null;
  return { provenance: JSON.parse(JSON.stringify(decision)) as LearningDecision };
}

/** Bind the offered retrieval conditions without interpreting package-owned accesses. */
export function reviewHandoffActivity(value: unknown, requestId: unknown, card: Flashcard, language: string,
  data: LanguageData | null | undefined, activities: readonly ReviewActivity[]): ReviewActivity | null {
  if (!isLearningDecision(value) || value.id !== requestId || value.selected.action !== 'review'
    || value.selected.task.inputModality !== 'activity-handoff' || value.selected.task.responseModality !== 'none') return null;
  const cue = value.selected.presentation;
  if (!cue || cue.cardId !== card.id || cue.language !== language || cue.surface !== card.content.front
    || cue.contentVersion !== hashWordSync(JSON.stringify(card.content))) return null;
  const activity = activities.find(item => item.id === cue.reviewActivityId);
  if (!activity) return null;
  const entry = flashcardReviewPolicyEntry(card, language, data, activity);
  const targets = entry.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability }));
  return value.selected.task.taskTemplateId === entry.task!.taskTemplateId
    && JSON.stringify(cue.retrievalTask) === JSON.stringify(entry.task)
    && JSON.stringify(value.selected.targets) === JSON.stringify(targets) ? activity : null;
}
