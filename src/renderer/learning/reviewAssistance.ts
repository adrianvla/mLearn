import { nextAttemptId, type AttemptScaffolds } from '../../shared/knowledgeEvents';
import { inProcessStudySessionLocks, type StudySessionLocks } from './studySessionController';

export interface ReviewAssistance {
  revision: string;
  scaffolds: AttemptScaffolds;
}

/** Encounter assistance outlives the drawer/window. No authored card content is stored. */
export function createReviewAssistanceStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  locks: StudySessionLocks | null,
) {
  const key = (scope: string) => `mlearn-review-assistance:${encodeURIComponent(scope)}`;
  const read = (scope: string): ReviewAssistance | null => {
    const raw = storage.getItem(key(scope));
    if (raw === null) return null;
    const record = JSON.parse(raw) as Partial<ReviewAssistance>;
    if (!record || typeof record.revision !== 'string' || !record.revision
      || !record.scaffolds || typeof record.scaffolds !== 'object' || Array.isArray(record.scaffolds)
      || Object.values(record.scaffolds).some(value => value !== true)) {
      throw new Error('Invalid review assistance record');
    }
    return { revision: record.revision, scaffolds: { ...record.scaffolds } };
  };
  const provide = async (scope: string, scaffolds: AttemptScaffolds, isCurrent?: () => boolean): Promise<ReviewAssistance | null> => {
    let result: ReviewAssistance | undefined;
    await (locks ?? inProcessStudySessionLocks).request(key(scope), () => {
      if (isCurrent && !isCurrent()) return;
      const previous = read(scope);
      result = {
        revision: nextAttemptId(),
        scaffolds: Object.fromEntries([...Object.entries(previous?.scaffolds ?? {}), ...Object.entries(scaffolds)]
          .filter(([, value]) => value === true)),
      };
      storage.setItem(key(scope), JSON.stringify(result));
    });
    return result ?? null;
  };
  const acknowledge = async (scope: string, expected: ReviewAssistance | null): Promise<void> => {
    if (!expected) return;
    await (locks ?? inProcessStudySessionLocks).request(key(scope), () => {
      if (read(scope)?.revision === expected.revision) storage.removeItem(key(scope));
    });
  };
  return { key, read, provide, acknowledge };
}
