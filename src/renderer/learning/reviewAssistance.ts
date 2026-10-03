import { nextAttemptId, type AttemptScaffolds } from '../../shared/knowledgeEvents';
import { inProcessStudySessionLocks, type StudySessionLocks } from './studySessionController';

export interface ReviewAssistance {
  revision: string;
  scaffolds: AttemptScaffolds;
  /** This physical choice owns its cues and answer exposure, across windows. */
  choiceId?: string;
  revealed?: true;
  /**
   * The learner asked for this cue (a reference drawer they opened, or a
   * speaker button they pressed) rather than the surface supplying it on its
   * own (automatic front TTS). It changes the DURABILITY ROUTE of the rating
   * that consumes it, never its provenance: both kinds travel on the rating
   * command's events. See FlashcardReview's persistence selection.
   */
  requested?: true;
}
interface ChoiceAssistance { scaffolds: AttemptScaffolds; revealed?: true; requested?: true }
interface StoredAssistance {
  revision: string;
  /** Conservative compatibility with already-saved card-scoped reference cues. */
  scaffolds: AttemptScaffolds;
  requested?: true;
  choices?: Record<string, ChoiceAssistance>;
}

/** Encounter assistance outlives the drawer/window. No authored card content is stored. */
export function createReviewAssistanceStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  locks: StudySessionLocks | null,
) {
  const key = (scope: string) => `mlearn-review-assistance:${encodeURIComponent(scope)}`;
  const validScaffolds = (value: unknown): value is AttemptScaffolds => !!value && typeof value === 'object'
    && !Array.isArray(value) && Object.values(value).every(flag => flag === true);
  const readStored = (scope: string): StoredAssistance | null => {
    const raw = storage.getItem(key(scope));
    if (raw === null) return null;
    const record = JSON.parse(raw) as Partial<StoredAssistance>;
    if (!record || typeof record.revision !== 'string' || !record.revision || !validScaffolds(record.scaffolds)
      || (record.requested !== undefined && record.requested !== true)
      || (record.choices !== undefined && (!record.choices || typeof record.choices !== 'object' || Array.isArray(record.choices)
        || Object.entries(record.choices).some(([id, entry]) => !id || !entry || !validScaffolds(entry.scaffolds)
          || (entry.revealed !== undefined && entry.revealed !== true)
          || (entry.requested !== undefined && entry.requested !== true))))) {
      throw new Error('Invalid review assistance record');
    }
    return record as StoredAssistance;
  };
  const view = (record: StoredAssistance, choiceId?: string): ReviewAssistance => {
    const own = choiceId ? record.choices?.[choiceId] : undefined;
    return { revision: record.revision, scaffolds: { ...record.scaffolds, ...own?.scaffolds },
      ...(choiceId ? { choiceId } : {}), ...(own?.revealed ? { revealed: true } : {}),
      ...((own?.requested || (own === record && record.requested)) ? { requested: true } : {}) };
  };
  const read = (scope: string, choiceId?: string): ReviewAssistance | null => {
    const record = readStored(scope);
    return record ? view(record, choiceId) : null;
  };
  const provide = async (scope: string, scaffolds: AttemptScaffolds, isCurrent?: () => boolean,
    choiceId?: string, requested = false): Promise<ReviewAssistance | null> => {
    let result: ReviewAssistance | null = null;
    await (locks ?? inProcessStudySessionLocks).request(key(scope), () => {
      if (isCurrent && !isCurrent()) return;
      const record = readStored(scope) ?? { revision: nextAttemptId(), scaffolds: {} };
      const own = choiceId ? ((record.choices ??= {})[choiceId] ??= { scaffolds: {} }) : record;
      own.scaffolds = Object.fromEntries([...Object.entries(own.scaffolds), ...Object.entries(scaffolds)]
        .filter(([, value]) => value === true));
      // A learner-requested cue stays learner-requested for this choice even if
      // an automatic one follows it: the stronger provenance wins, so a rating
      // can never be downgraded by a second, unattended cue.
      if (requested) own.requested = true;
      record.revision = nextAttemptId();
      storage.setItem(key(scope), JSON.stringify(record));
      result = view(record, choiceId);
    });
    return result;
  };
  const reveal = async (scope: string, choiceId: string, isCurrent?: () => boolean): Promise<ReviewAssistance | null> => {
    let result: ReviewAssistance | null = null;
    await (locks ?? inProcessStudySessionLocks).request(key(scope), () => {
      if (isCurrent && !isCurrent()) return;
      const record = readStored(scope) ?? { revision: nextAttemptId(), scaffolds: {} };
      const own = (record.choices ??= {})[choiceId] ??= { scaffolds: {} };
      own.revealed = true;
      record.revision = nextAttemptId();
      storage.setItem(key(scope), JSON.stringify(record));
      result = view(record, choiceId);
    });
    return result;
  };
  const acknowledge = async (scope: string, expected: ReviewAssistance | null): Promise<void> => {
    if (!expected) return;
    await (locks ?? inProcessStudySessionLocks).request(key(scope), () => {
      const record = readStored(scope);
      if (!record || record.revision !== expected.revision) return;
      if (expected.choiceId) delete record.choices?.[expected.choiceId];
      record.scaffolds = {};
      if (Object.keys(record.choices ?? {}).length) {
        record.revision = nextAttemptId();
        storage.setItem(key(scope), JSON.stringify(record));
      } else storage.removeItem(key(scope));
    });
  };
  return { key, read, provide, reveal, acknowledge };
}
