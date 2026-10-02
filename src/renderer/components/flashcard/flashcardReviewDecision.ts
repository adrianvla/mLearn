import type { Flashcard, LanguageData } from '../../../shared/types';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { surfaceEntityId } from '../../../shared/graph/load';
import { hashWordSync } from '../../services/srsAlgorithm';
import type { FlashcardLike } from '../../learning/candidateSources';
import { PRESETS } from '../../learning/engine';

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
