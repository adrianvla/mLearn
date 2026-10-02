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
export function flashcardReviewPolicyEntry(card: Flashcard, language: string, languageData?: LanguageData | null): FlashcardLike {
  const requested = [...getTestedAccesses({ languageData, surface: card.content.front,
    hasReadingData: !!card.content.reading && card.content.reading !== card.content.front,
    hasProsodyData: !!card.content.prosody && (card.content.prosody.position !== undefined || !!card.content.prosody.display),
    taskType: 'srs-review' })];
  const entityId = surfaceEntityId(language, hashWordSync(card.content.front));
  return {
    id: card.id, word: card.content.front, language,
    presentation: { cardId: card.id, language, surface: card.content.front, contentVersion: hashWordSync(JSON.stringify(card.content)) },
    targets: requested.map(capability => ({ entityId, capability })),
    task: { ...PRESETS.RETENTION.task, supplied: [...PRESETS.RETENTION.task.supplied], requested },
    dueDate: card.dueDate, interval: card.interval, suspended: card.suspended, buried: card.buried, state: card.state,
    scheduledForToday: true, lastReviewed: card.lastReviewed, ease: card.ease, reviews: card.reviews,
  };
}

/** Actual whole scheduler workload, with paired entropy and opaque package tasks. */
export function selectFlashcardReviewDecision(input: { id: string; at: number;
  entries: readonly FlashcardLike[]; context?: PolicyContext; rng?: () => number }) {
  const { selected, baseline } = selectCounterfactualEncounter({ preset: 'RETENTION', nowMs: input.at,
    reviewQueueEntries: input.entries, context: input.context, rng: input.rng });
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
      limits: ['Selection preferences are not measured learning gain.',
        'Bounded traces may omit competitors; both choices were computed from the full workload.'] } };
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
