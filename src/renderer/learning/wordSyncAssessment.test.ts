import { describe, expect, it } from 'vitest';
import {
  createWordSyncAssessmentQueue,
  firstWordSyncAssessmentIndex,
  nextWordSyncAssessmentIndex,
  replayWordSyncAssessment,
  wordSyncAssessmentResult,
} from './wordSyncAssessment';

const pools = [
  { level: 1, label: 'One', words: ['a1', 'a2'] },
  { level: 2, label: 'Two', words: ['b1', 'b2'] },
];
const resultPools = [
  { level: 1, label: 'One', words: ['a1', 'a2', 'a3'] },
  { level: 2, label: 'Two', words: ['b1', 'b2', 'b3'] },
];

describe('Word Sync assessment policy', () => {
  it('keeps the balanced adaptive draw order and advances past skips without evidence', () => {
    const queue = createWordSyncAssessmentQueue(pools);
    let state = { pools, draws: [] as Array<{ key: string; level: number; outcome: 'fluent' | 'struggled' | 'missed' | 'skipped' }> };
    expect(queue[firstWordSyncAssessmentIndex(queue, state)]).toEqual({ id: 'b1', level: 2 });

    const first = nextWordSyncAssessmentIndex(queue, firstWordSyncAssessmentIndex(queue, state), state, 'rated', 'fluent')!;
    state = first.state;
    expect(queue[first.index]).toEqual({ id: 'a1', level: 1 });
    const second = nextWordSyncAssessmentIndex(queue, first.index, state, 'skipped')!;
    state = second.state;
    expect(queue[second.index]).toEqual({ id: 'b2', level: 2 });
    expect(replayWordSyncAssessment(state)?.result().sampledCount).toBe(1);
    expect(wordSyncAssessmentResult(state)).toBeNull();
  });

  it('replays accepted evidence and produces a stable explicit recommendation', () => {
    const queue = createWordSyncAssessmentQueue(resultPools);
    let state = { pools: resultPools, draws: [] as Array<{ key: string; level: number; outcome: 'fluent' | 'struggled' | 'missed' | 'skipped' }> };
    while (true) {
      const index = firstWordSyncAssessmentIndex(queue, state);
      if (index >= queue.length) break;
      const next = nextWordSyncAssessmentIndex(queue, index, state, 'rated', 'fluent')!;
      state = next.state;
    }
    const result = wordSyncAssessmentResult(state);
    expect(result?.sampledCount).toBe(5);
    expect(result?.placement).toEqual({ categoryId: '2', label: 'Two' });
    expect(replayWordSyncAssessment({ ...state, draws: [...state.draws, state.draws[0]!] })).toBeNull();
  });
});
