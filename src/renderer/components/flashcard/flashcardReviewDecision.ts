import type { Flashcard, LanguageData } from '../../../shared/types';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { surfaceEntityId } from '../../../shared/graph/load';
import { hashWordSync } from '../../services/srsAlgorithm';
import type { FlashcardLike } from '../../learning/candidateSources';
import { PRESETS, selectCounterfactualEncounter } from '../../learning/engine';
import type { PolicyContext, PolicyDecision } from '../../learning/types';
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
    presentation: { cardId: choice.candidate.key, language: choice.candidate.language, surface: choice.candidate.word },
    targets: choice.encounter.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability })),
    task: choice.encounter.task });
  const provenance: LearningDecision = { id: input.id, at: input.at, policyVersion: selected.trace!.version,
    selected: snapshot(selected), baseline: baseline && baseline.action !== 'DEFER' ? snapshot(baseline) : null,
    detail: { scope: 'scheduler-admitted-workload', candidateCount: input.entries.length,
      trace: selected.trace, baselineTrace: baseline?.trace,
      limits: ['Selection preferences are not measured learning gain.',
        'Bounded traces may omit competitors; both choices were computed from the full workload.'] } };
  return JSON.parse(JSON.stringify({ decision: selected, provenance })) as { decision: PolicyDecision; provenance: LearningDecision };
}
