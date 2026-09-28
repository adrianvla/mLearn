import { DiagnosticSession, type DiagnosticQuality, type DiagnosticResult } from './diagnosticSampling';

export interface WordSyncAssessmentPool {
  level: number;
  label: string;
  words: string[];
}

export interface WordSyncAssessmentDraw {
  key: string;
  level: number;
  outcome: DiagnosticQuality | 'skipped';
}

export interface WordSyncAssessmentState {
  pools: WordSyncAssessmentPool[];
  draws: WordSyncAssessmentDraw[];
}

export interface WordSyncAssessmentQueueItem {
  id: string;
  level: number;
}

export function createWordSyncAssessmentQueue(pools: readonly WordSyncAssessmentPool[]): WordSyncAssessmentQueueItem[] {
  return pools.flatMap((pool) => pool.words.map((id) => ({ id, level: pool.level })));
}

export function replayWordSyncAssessment(state: WordSyncAssessmentState): DiagnosticSession | null {
  const session = new DiagnosticSession(
    state.pools.map((pool) => ({ id: String(pool.level), label: pool.label, items: pool.words })),
  );
  for (const draw of state.draws) {
    const pick = session.pick();
    if (pick === null || pick.key !== draw.key || Number(pick.categoryId) !== draw.level) return null;
    if (draw.outcome === 'skipped') session.skip(draw.key);
    else session.record(draw.key, draw.outcome);
  }
  return session;
}

export function firstWordSyncAssessmentIndex(
  queue: readonly WordSyncAssessmentQueueItem[],
  state: WordSyncAssessmentState,
): number {
  const pick = replayWordSyncAssessment(state)?.pick();
  return pick === null || pick === undefined
    ? queue.length
    : queue.findIndex((item) => item.id === pick.key && item.level === Number(pick.categoryId));
}

export function nextWordSyncAssessmentIndex(
  queue: readonly WordSyncAssessmentQueueItem[],
  index: number,
  state: WordSyncAssessmentState,
  outcome: 'rated' | 'skipped',
  quality?: DiagnosticQuality,
): { index: number; state: WordSyncAssessmentState } | null {
  const current = queue[index];
  const result: DiagnosticQuality | 'skipped' | undefined = outcome === 'skipped' ? 'skipped' : quality;
  if (!current || result === undefined) return null;
  const nextState = {
    ...state,
    draws: [...state.draws, { key: current.id, level: current.level, outcome: result }],
  };
  const nextIndex = firstWordSyncAssessmentIndex(queue, nextState);
  if (nextIndex < 0) return null;
  return { index: nextIndex, state: nextState };
}

export function wordSyncAssessmentResult(state: WordSyncAssessmentState): DiagnosticResult | null {
  const session = replayWordSyncAssessment(state);
  if (!session || session.pick() !== null) return null;
  return session.result();
}
