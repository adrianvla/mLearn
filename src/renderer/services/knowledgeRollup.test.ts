import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAppendEvents = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('./knowledgeEvents', () => ({
  appendEvents: mockAppendEvents,
}));

import {
  accumulateWordSeen,
  flushKnowledgeRollup,
  setKnowledgeRollupTodayFn,
  resetKnowledgeRollupForTests,
} from './knowledgeRollup';

beforeEach(() => {
  resetKnowledgeRollupForTests();
  setKnowledgeRollupTodayFn(() => '2026-08-15');
  mockAppendEvents.mockClear();
});

describe('knowledgeRollup', () => {
  it('buckets multiple accumulations for the same lk into one event', async () => {
    accumulateWordSeen('ja:abc', 1.4, 1);
    accumulateWordSeen('ja:abc', 1.45, 1);
    accumulateWordSeen('ja:abc', 1.5, 1);
    await flushKnowledgeRollup();

    expect(mockAppendEvents).toHaveBeenCalledTimes(1);
    const [byKey] = mockAppendEvents.mock.calls[0];
    expect(Object.keys(byKey)).toEqual(['ja:abc']);
    expect(byKey['ja:abc']).toHaveLength(1);
    expect(byKey['ja:abc'][0].timesSeenDelta).toBe(3);
    expect(byKey['ja:abc'][0].easeAfter).toBe(1.5); // last write wins
    expect(byKey['ja:abc'][0].kind).toBe('rollup');
    expect(byKey['ja:abc'][0].source).toBe('passiveTracking');
  });

  it('flush is a no-op when nothing accumulated', async () => {
    await flushKnowledgeRollup();
    expect(mockAppendEvents).not.toHaveBeenCalled();
  });

  it('flush is idempotent — second flush sends nothing', async () => {
    accumulateWordSeen('ja:abc', 1.4, 1);
    await flushKnowledgeRollup();
    await flushKnowledgeRollup();
    expect(mockAppendEvents).toHaveBeenCalledTimes(1);
  });

  it('day rollover flushes pending buckets before accepting new data', async () => {
    let day = '2026-08-15';
    setKnowledgeRollupTodayFn(() => day);
    accumulateWordSeen('ja:abc', 1.4, 1);
    day = '2026-08-16';
    accumulateWordSeen('ja:xyz', 1.3, 1);

    // The day-rolled flush was kicked off fire-and-forget; drain it.
    await flushKnowledgeRollup();
    await flushKnowledgeRollup();

    expect(mockAppendEvents).toHaveBeenCalledTimes(2);
    const [firstFlush] = mockAppendEvents.mock.calls[0];
    const [secondFlush] = mockAppendEvents.mock.calls[1];
    expect(Object.keys(firstFlush)).toEqual(['ja:abc']);
    expect(Object.keys(secondFlush)).toEqual(['ja:xyz']);
  });

  it('concurrent flush calls share one in-flight promise', async () => {
    accumulateWordSeen('ja:abc', 1.4, 1);
    const [a, b] = [flushKnowledgeRollup(), flushKnowledgeRollup()];
    await Promise.all([a, b]);
    expect(mockAppendEvents).toHaveBeenCalledTimes(1);
  });

  it('append failure is swallowed and logged, buckets stay cleared', async () => {
    mockAppendEvents.mockRejectedValueOnce(new Error('disk full'));
    accumulateWordSeen('ja:abc', 1.4, 1);
    await expect(flushKnowledgeRollup()).resolves.toBeUndefined();
    // Buckets cleared before the append attempt — no double-send on next flush.
    await flushKnowledgeRollup();
    expect(mockAppendEvents).toHaveBeenCalledTimes(1);
  });
});
