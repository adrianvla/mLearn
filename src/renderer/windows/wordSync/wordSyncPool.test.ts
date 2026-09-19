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

describe('wordSyncProbe with an absent projection (F-N1 scan-level seam; request bounding W07)', () => {
  it('treats an absent projection WITHOUT identity as untracked and NOT admissible', async () => {
    const { wordSyncProbe } = await import('./wordSyncPool');
    const probe = wordSyncProbe(undefined, ['sense-recognition', 'surface-reading']);
    // The probe stays total (no crash) but claims NO targets and admits
    // nothing: without a surface identity there are no entity ids to claim.
    expect(probe.targets).toEqual([]);
    expect(probe.status).toBe(WORD_SYNC_STATUS_UNTRACKED);
    expect(probe.focused).toBe(false);
  });

  it('admits an absent projection when the caller supplies its surface identity', async () => {
    const { wordSyncProbe } = await import('./wordSyncPool');
    const probe = wordSyncProbe(undefined, ['sense-recognition', 'surface-reading'], 'ja:surface:abc');
    // Unmeasured by definition: every capability is an unresolved target
    // under the supplied surface entity id, status Untracked, unfocused.
    expect(probe.targets.map(t => ({ entityId: t.entityId, capability: t.capability }))).toEqual([
      { entityId: 'ja:surface:abc', capability: 'sense-recognition' },
      { entityId: 'ja:surface:abc', capability: 'surface-reading' },
    ]);
    expect(probe.status).toBe(WORD_SYNC_STATUS_UNTRACKED);
    expect(probe.focused).toBe(false);
  });
});

describe('wordSyncProbe graph-unmapped surfaces (F-N1 scan-level seam)', () => {
  const base = { status: 'ready' as const, targets: [] as never[], evidenceSourceCounts: {} };

  it('constructs identity-backed targets for a ready surfaceKnown:false empty projection', async () => {
    const { wordSyncProbe } = await import('./wordSyncPool');
    const projection = { ...base, surfaceKnown: false } as unknown as Parameters<typeof wordSyncProbe>[0];
    const probe = wordSyncProbe(projection, ['sense-recognition', 'surface-reading'], 'ja:surface:abc');
    expect(probe.targets).toEqual([
      { entityId: 'ja:surface:abc', capability: 'sense-recognition' },
      { entityId: 'ja:surface:abc', capability: 'surface-reading' },
    ]);
    expect(probe.status).toBe(WORD_SYNC_STATUS_UNTRACKED);
    expect(probe.focused).toBe(false);
  });

  it('keeps a graph-unmapped projection WITH measured lexical evidence non-admissible', async () => {
    const { wordSyncProbe } = await import('./wordSyncPool');
    const projection = {
      status: 'ready',
      targets: [],
      surfaceKnown: false,
      lexical: { overall: { classification: 'known', basis: 'evidence' }, entryIds: [], sense: { classification: 'known', basis: 'evidence' }, spoken: { classification: 'unmeasured', basis: 'unmeasured' }, surfaceRecognition: { classification: 'known', basis: 'evidence' }, synchronized: false, missingBridges: [] },
    } as unknown as Parameters<typeof wordSyncProbe>[0];
    const probe = wordSyncProbe(projection, ['sense-recognition'], 'ja:surface:abc');
    // Measured lexical evidence means the projection summary decides: no
    // identity-backed construction may admit it as fresh untracked — the
    // probe reports the measured classification so Word Sync excludes it.
    expect(probe.targets).toEqual([]);
    expect(probe.status).toBe(String(WORD_STATUS.KNOWN));
  });

  it('keeps a ready surfaceKnown:true empty-target projection non-admissible', async () => {
    const { wordSyncProbe } = await import('./wordSyncPool');
    const projection = { ...base, surfaceKnown: true } as unknown as Parameters<typeof wordSyncProbe>[0];
    const probe = wordSyncProbe(projection, ['sense-recognition'], 'ja:surface:abc');
    expect(probe.targets).toEqual([]);
    expect(probe.status).toBe(WORD_SYNC_STATUS_UNTRACKED);
    expect(probe.focused).toBe(false);
  });
});
