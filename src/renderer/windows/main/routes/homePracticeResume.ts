import { wordSyncSavedFilter } from '../../wordSync/wordSyncSavedFilter';

export interface HomePracticeContext {
  activity: 'practice' | 'reinforce';
  material?: { language: string; label: string; words: string[] };
}

/** Read continuity from the existing controller record; this owns no progress. */
export function homePracticeResume(storage: Storage, scope: { language: string; provider?: string; packageVersion?: string }): { at: number; context: HomePracticeContext } | null {
  let latest: { at: number; context: HomePracticeContext } | null = null;
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith('mlearn-study-word-sync') || !key.endsWith(`:${scope.language}`)) continue;
      const raw = storage.getItem(key);
      if (wordSyncSavedFilter(raw, scope) === null) continue;
      const record = JSON.parse(raw!);
      if (record.index >= record.queue.length && !record.pending) continue;
      const source = record.meta.source;
      // Older material sessions lack their original scope; never guess a new one.
      if (key.includes('-material-') && (!source || !Array.isArray(source.words)
        || !source.words.every((word: unknown) => typeof word === 'string') || typeof source.label !== 'string')) continue;
      const context: HomePracticeContext = { activity: key.includes('-reinforce:') ? 'reinforce' : 'practice',
        ...(source ? { material: { language: scope.language, label: source.label, words: source.words } } : {}) };
      const at = record.meta.encounter?.decision?.at ?? 0;
      if (!latest || at > latest.at) latest = { at, context };
    }
  } catch { return null; }
  return latest;
}
