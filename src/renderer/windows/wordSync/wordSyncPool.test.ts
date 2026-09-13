import { describe, it, expect } from 'vitest';
import { WORD_STATUS } from '../../../shared/constants';
import { WORD_SYNC_STATUS_UNTRACKED } from '../../components/common/FilterBuilder/presets';
import { wordSyncPoolStatus } from './wordSyncPool';

describe('wordSyncPoolStatus', () => {
  it('maps resolver learning to the Learning status string', () => {
    expect(wordSyncPoolStatus('learning', 'evidence')).toBe(String(WORD_STATUS.LEARNING));
    expect(wordSyncPoolStatus('learning', 'evidence')).toBe('1');
  });

  it('maps resolver unknown with a knowledge record to the Unknown status string', () => {
    expect(wordSyncPoolStatus('unknown', 'evidence')).toBe(String(WORD_STATUS.UNKNOWN));
    expect(wordSyncPoolStatus('unknown', 'evidence')).toBe('0');
  });

  it('maps resolver unknown without a knowledge record to untracked', () => {
    expect(wordSyncPoolStatus('unknown', 'unmeasured')).toBe(WORD_SYNC_STATUS_UNTRACKED);
    expect(wordSyncPoolStatus('unknown', 'unmeasured')).toBe('untracked');
  });

  it('never collapses Learning into Unknown (guards an "anything not known is unknown" regression)', () => {
    expect(wordSyncPoolStatus('learning', 'evidence')).not.toBe(wordSyncPoolStatus('unknown', 'evidence'));
    expect(wordSyncPoolStatus('learning', 'claim')).not.toBe(wordSyncPoolStatus('unknown', 'evidence'));
  });
});


describe('projected residual probes', () => {
  it('keeps a measured weak aspect eligible regardless of the word summary and rating recency', async () => {
    const { wordSyncProbe } = await import('./wordSyncPool');
    const { projectionFixture } = await import('../../../../test/projectionFixture');
    const projection = projectionFixture('known', 'evidence');
    projection.targets = [{ targetRef: { kind: 'surface', id: 'x' }, applicableCapabilities: ['sense-recognition', 'surface-reading', 'prosodic-pattern'], states: [
      { capability: 'sense-recognition', classification: 'known', basis: 'evidence', evidence: [], evidenceSourceCounts: { anki: 12 } },
      { capability: 'surface-reading', classification: 'unknown', basis: 'evidence', evidence: [{ timestamp: Date.now(), source: 'manual', quality: 'missed' }], evidenceSourceCounts: { manual: 1 } },
      { capability: 'prosodic-pattern', classification: 'unmeasured', basis: 'unmeasured', evidence: [], evidenceSourceCounts: {} },
    ] }];
    const probe = wordSyncProbe(projection, ['sense-recognition', 'surface-reading', 'prosodic-pattern']);
    expect(probe.targets.map(target => target.capability)).toEqual(['surface-reading', 'prosodic-pattern']);
    expect(probe.focused).toBe(true);
    expect(probe.status).toBe(String(WORD_STATUS.KNOWN));
    projection.targets[0].states[1] = { capability: 'surface-reading', classification: 'unmeasured', basis: 'unmeasured', evidence: [], evidenceSourceCounts: {} };
    expect(wordSyncProbe(projection, ['surface-reading']).status).toBe(String(WORD_STATUS.KNOWN));
  });
});
