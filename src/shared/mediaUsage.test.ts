import { expect, it } from 'vitest';
import { mediaUsageIdentity, mergeMediaUsage } from './mediaUsage';
import type { MediaStats } from './types';
const snapshot = (id: string, sequence: number, seen: number, finalized = false): MediaStats => ({
  mediaHash: mediaUsageIdentity('book', '/books/a.epub', 'qx'), sourceId: '/books/a.epub', mediaName: 'Identical Title', mediaType: 'book', language: 'qx',
  wordsEncountered: {}, grammarEncountered: {}, sessions: [], assessedLevel: null, totalTimeSpent: 0, lastAccessed: 100,
  usageSessions: { [id]: { id, sequence, finalized, date: '2026-10-09', duration: seen * 100, wordsLearned: 0, startTime: 10,
    wordsEncountered: { term: { word: 'term', ease: 2, timesSeen: seen, timesHovered: 0 } }, grammarEncountered: {} } },
});
it('separates same titles across resources, types and source languages', () => {
  expect(new Set([mediaUsageIdentity('book', '/a', 'qx'), mediaUsageIdentity('book', '/b', 'qx'), mediaUsageIdentity('video', '/a', 'qx'), mediaUsageIdentity('book', '/a', 'qy')]).size).toBe(4);
});
it('merges concurrent sessions, ignores stale snapshots and cannot reopen a finalized session', () => {
  let merged = mergeMediaUsage(null, snapshot('one', 2, 3));
  merged = mergeMediaUsage(merged, snapshot('two', 1, 2));
  merged = mergeMediaUsage(merged, snapshot('one', 1, 1));
  expect(merged.wordsEncountered.term.timesSeen).toBe(5);
  merged = mergeMediaUsage(merged, snapshot('one', 3, 4, true));
  merged = mergeMediaUsage(merged, snapshot('one', 4, 8));
  expect(merged.wordsEncountered.term.timesSeen).toBe(6);
  expect(merged.sessions).toHaveLength(1);
  expect(merged.sessions[0].wordsLearned).toBe(0);
  expect(merged.sessions[0].wordsEncounteredCount).toBe(1);
});

it('preserves annotations on stale and newly opened snapshots', () => {
  const existing = snapshot('old', 2, 2); existing.assessedLevel = 4; existing.ocrCache = { 1: [] };
  const reopened = snapshot('new', 0, 0);
  const merged = mergeMediaUsage(existing, reopened);
  expect(merged.assessedLevel).toBe(4); expect(merged.ocrCache).toEqual({ 1: [] });
});
it('rejects negative and regressing grammar contribution counters', () => {
  const first = snapshot('one', 1, 1);
  first.usageSessions!.one.grammarEncountered.rule = { pattern: 'rule', ease: 2, timesFailed: 2 };
  const next = snapshot('one', 2, 2);
  expect(() => mergeMediaUsage(first, next)).toThrow('cumulative');
  next.usageSessions!.one.grammarEncountered.rule = { pattern: 'rule', ease: 2, timesFailed: -1 };
  expect(() => mergeMediaUsage(first, next)).toThrow('Invalid');
});
it('unions simultaneous physical engagement across durable sessions', () => {
  const first = snapshot('one', 1, 1); first.usageSessions!.one.engagedIntervals = [{ startTime: 100, endTime: 200 }];
  const next = snapshot('two', 1, 1); next.usageSessions!.two.engagedIntervals = [{ startTime: 150, endTime: 250 }];
  expect(mergeMediaUsage(first, next).totalTimeSpent).toBe(150);
});
