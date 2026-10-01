import { describe, expect, it } from 'vitest';
import { projectCapabilities, projectClaimMarkers } from './capabilityProjection';
import type { KnowledgeEvent } from '../knowledgeEvents';

const rows = (events: KnowledgeEvent[]) => events.map((event, seq) => ({ event, seq }));

describe('claim marker provenance', () => {
  it('retains authorship without a status when every claim was retracted', () => {
    const events = rows([
      { t: 1, kind: 'claim', source: 'manual', toStatus: 'known', attemptId: 'retired', targetRef: { kind: 'surface', id: 'x:surface:a', capability: 'x::arbitrary' } },
      { t: 2, kind: 'retraction', source: 'manual', retracts: 'retired' },
    ]);
    expect(projectClaimMarkers(events)).toEqual({ 'x::arbitrary': { t: 1, seq: 0 } });
    expect(projectCapabilities(events)).toEqual({});
  });

  it('retains a withdrawal at the same timestamp and excludes retracted claims', () => {
    const events = rows([
      { t: 1, kind: 'claim', source: 'manual', toStatus: 'known', attemptId: 'withdrawn', targetRef: { kind: 'surface', id: 'x:surface:a', capability: 'x::arbitrary' } },
      { t: 1, kind: 'claim', source: 'manual', targetRef: { kind: 'surface', id: 'x:surface:a', capability: 'x::arbitrary' } },
      { t: 2, kind: 'claim', source: 'manual', toStatus: 'learning', attemptId: 'retracted', targetRef: { kind: 'surface', id: 'x:surface:a', capability: 'x::arbitrary' } },
      { t: 3, kind: 'retraction', source: 'manual', retracts: 'retracted' },
    ]);
    expect(projectClaimMarkers(events)).toEqual({ 'x::arbitrary': { t: 1, seq: 1 } });
    expect(projectCapabilities(events)).toEqual({});
  });

  it('keeps exact package entity claims available without promoting the word cache', () => {
    const events = rows([{ t: 1, kind: 'claim', source: 'manual', toStatus: 'known',
      targetRef: { kind: 'x::discourse-relation', id: 'x:unknown', capability: 'x::arbitrary' } }]);
    expect(projectCapabilities(events)['x::arbitrary'].claim).toBe('known');
    expect(projectClaimMarkers(events)['x::arbitrary'].status).toBe('known');
    expect(projectCapabilities(events, undefined, true)).toEqual({});
    expect(projectClaimMarkers(events, true)).toEqual({});
  });
});
