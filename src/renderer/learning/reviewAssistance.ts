import { nextAttemptId, type AttemptScaffolds } from '../../shared/knowledgeEvents';
import { inProcessStudySessionLocks, type StudySessionLocks } from './studySessionController';

export interface ReviewAssistance {
  revision: string;
  scaffolds: AttemptScaffolds;
  /** This physical choice owns its cues and answer exposure, across windows. */
  choiceId?: string;
  revealed?: true;
}
interface ChoiceAssistance { scaffolds: AttemptScaffolds; revealed?: true }
interface StoredAssistance {
  revision: string;
  /** Conservative compatibility with already-saved card-scoped reference cues. */
  scaffolds: AttemptScaffolds;
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
      || (record.choices !== undefined && (!record.choices || typeof record.choices !== 'object' || Array.isArray(record.choices)
        || Object.entries(record.choices).some(([id, entry]) => !id || !entry || !validScaffolds(entry.scaffolds)
          || (entry.revealed !== undefined && entry.revealed !== true))))) {
      throw new Error('Invalid review assistance record');
    }
    return record as StoredAssistance;
  };
  const view = (record: StoredAssistance, choiceId?: string): ReviewAssistance => {
    const own = choiceId ? record.choices?.[choiceId] : undefined;
    return { revision: record.revision, scaffolds: { ...record.scaffolds, ...own?.scaffolds },
      ...(choiceId ? { choiceId } : {}), ...(own?.revealed ? { revealed: true } : {}) };
  };
  const read = (scope: string, choiceId?: string): ReviewAssistance | null => {
    const record = readStored(scope);
    return record ? view(record, choiceId) : null;
  };
  const provide = async (scope: string, scaffolds: AttemptScaffolds, isCurrent?: () => boolean,
    choiceId?: string): Promise<ReviewAssistance | null> => {
    let result: ReviewAssistance | null = null;
    await (locks ?? inProcessStudySessionLocks).request(key(scope), () => {
      if (isCurrent && !isCurrent()) return;
      const record = readStored(scope) ?? { revision: nextAttemptId(), scaffolds: {} };
      const own = choiceId ? ((record.choices ??= {})[choiceId] ??= { scaffolds: {} }) : record;
      own.scaffolds = Object.fromEntries([...Object.entries(own.scaffolds), ...Object.entries(scaffolds)]
        .filter(([, value]) => value === true));
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
