import { describe, expect, it } from 'vitest';
import { wordEaseTrajectoryData, type WordEaseHistoryEntry } from './wordEaseTrajectoryData';
import type { KnowledgeEvent } from '../../../../shared/knowledgeEvents';
import { compactKeyEvents } from '../../../../shared/knowledge/historyArchive';
const thresholds = { learning: 1.55, known: 1.8 };
const event = (t: number, easeAfter: number, capability = 'sense-recognition'): KnowledgeEvent => ({ t, kind: 'rating', source: 'srs', easeAfter, targetRef: { kind: 'surface', id: 'x', capability } });
const entry = (word: string, events: KnowledgeEvent[]): WordEaseHistoryEntry => ({ word, key: word, events });

describe('overall word ease trajectory', () => {
  it('uses the lexical resolver, keeping prosody and reading out of the overall value', () => {
    const data = wordEaseTrajectoryData([entry('word', [event(1, 1.4), event(2, 2.2, 'spoken-recognition'), event(3, 4.8, 'surface-reading'), event(4, 4.9, 'prosodic-pattern')])], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([1.4, 2.2]);
  });
  it('preserves each spelling before the word resolver chooses the strongest evidence', () => {
    const data = wordEaseTrajectoryData([
      entry('first', [event(1, 2.4, 'surface-recognition')]),
      entry('second', [event(2, 1.3, 'surface-recognition')]),
    ], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([2.4, 2.4]);
    expect(data.points[1].matchedWord).toBe('first');
  });
  it('does not borrow another spelling’s numeric outcome for a claim-only winning form', () => {
    const data = wordEaseTrajectoryData([
      { ...entry('first', [event(1, 2.4)]), key: 'first-key' },
      { ...entry('second', [{ t: 2, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' }]), key: 'second-key' },
    ], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([2.4, undefined]);
    expect(data.points[1].matchedWord).toBe('second');
  });
  it.each(['first', 'second'])('uses archived numeric outcomes only when their form wins (%s)', (claimedWord) => {
    const day = 86400000;
    const old = [event(day, 1.3), event(40 * day, 1.6), event(60 * day, 2.7)];
    const { archive } = compactKeyEvents(old.map((event, seq) => ({ event, seq })), 400 * day);
    expect(archive).toBeDefined();
    const claim: KnowledgeEvent = { t: 390 * day, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus: 'known' };
    const data = wordEaseTrajectoryData([
      { ...entry('first', claimedWord === 'first' ? [claim] : []), key: 'first-key', archive },
      { ...entry('second', claimedWord === 'second' ? [claim] : []), key: 'second-key' },
    ], 'test', thresholds);
    expect(data.points[0].matchedWord).toBe(claimedWord);
    expect(data.points[0].ease).toBe(claimedWord === 'first' ? 2.7 : undefined);
  });
  it('retains real ease above the old normalized chart ceiling and normalizes imported Anki factors', () => {
    const data = wordEaseTrajectoryData([entry('word', [event(1, 2.4), { ...event(2, 3100), source: 'anki' }])], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([2.4, 3.1]);
  });
  it('does not turn claims into made-up ease or erase underlying evidence when a claim clears', () => {
    const claim = (t: number, toStatus?: 'known' | 'unknown'): KnowledgeEvent => ({ t, kind: 'claim', source: 'manual', aspect: 'meaning', toStatus });
    expect(wordEaseTrajectoryData([entry('word', [claim(1, 'known'), claim(2)])], 'test', thresholds).points.map((point) => point.ease)).toEqual([undefined, undefined]);
    const data = wordEaseTrajectoryData([entry('word', [event(1, 1.4), claim(2, 'known'), claim(3)])], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([1.4, 1.4, 1.4]);
  });
  it('removes undone and supplied observations from numeric history', () => {
    const data = wordEaseTrajectoryData([entry('word', [
      { ...event(1, 3), attemptId: 'undone' }, { t: 2, kind: 'retraction', source: 'manual', retracts: 'undone' },
      { ...event(3, 3), scaffolds: { translation: true } }, event(4, 1.5),
    ])], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([1.5]);
  });
  it('honors tombstones across form keys before overall replay', () => {
    const data = wordEaseTrajectoryData([
      entry('first', [{ ...event(1, 3), attemptId: 'cross-form' }]),
      entry('second', [{ t: 2, kind: 'retraction', source: 'manual', retracts: 'cross-form' }, event(3, 1.4)]),
    ], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([1.4]);
  });
  it('does not reconstruct intermediate compressed values and resumes from stored folds', () => {
    const day = 86400000;
    const old = [event(day, 1.3), event(40 * day, 1.6), event(60 * day, 2.7)];
    const { archive } = compactKeyEvents(old.map((event, seq) => ({ event, seq })), 400 * day);
    const data = wordEaseTrajectoryData([{ ...entry('word', [old[0], { ...event(50 * day, 0), kind: 'claim', easeAfter: undefined, toStatus: 'known' }, { ...event(390 * day, 0), kind: 'claim', easeAfter: undefined }]), archive }], 'test', thresholds);
    expect(data.points.map((point) => point.ease)).toEqual([1.3, undefined, 2.7]);
    expect(data.compressed[0].count).toBe(2);
  });
});
