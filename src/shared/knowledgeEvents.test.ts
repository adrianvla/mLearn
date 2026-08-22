import { describe, expect, it } from 'vitest';
import {
  collectRetractedAttemptIds,
  nextAttemptId,
  stripRetractedLog,
  stripRetractions,
  type KnowledgeEvent,
} from './knowledgeEvents';

function event(overrides: Partial<KnowledgeEvent>): KnowledgeEvent {
  return { t: 1000, kind: 'rating', source: 'manual', aspect: 'meaning', ...overrides };
}

describe('nextAttemptId', () => {
  it('returns unique string ids (durable across restarts, unlike the old counter)', () => {
    const a = nextAttemptId();
    const b = nextAttemptId();
    expect(typeof a).toBe('string');
    expect(a).not.toBe(b);
  });
});

describe('stripRetractions', () => {
  it('drops retraction tombstones and every event carrying a retracted attemptId', () => {
    const attempt = nextAttemptId();
    const events = [
      event({ t: 1, kind: 'status' }),
      event({ t: 2, attemptId: attempt }),
      event({ t: 3, attemptId: attempt, quality: 'fluent' }),
      event({ t: 4, kind: 'retraction', retracts: attempt }),
    ];

    const stripped = stripRetractions(events);

    expect(stripped).toEqual([events[0]]);
  });

  it('retracts across the legacy numeric attemptId union', () => {
    const events = [
      event({ t: 1, attemptId: 7 as unknown as string }),
      event({ t: 2, kind: 'retraction', retracts: '7' }),
    ];

    expect(stripRetractions(events)).toEqual([]);
  });

  it('leaves events without attemptId (passive rollups) untouched', () => {
    const rollup = event({ t: 1, kind: 'rollup', timesSeenDelta: 2 });
    expect(stripRetractions([rollup])).toEqual([rollup]);
    expect(collectRetractedAttemptIds([rollup])).toEqual(new Set());
  });

  it('repeated retraction of one attempt has no additional effect (idempotent)', () => {
    const attempt = nextAttemptId();
    const events = [
      event({ t: 1, attemptId: attempt }),
      event({ t: 2, kind: 'retraction', retracts: attempt }),
      event({ t: 3, kind: 'retraction', retracts: attempt }),
      event({ t: 4, kind: 'retraction', retracts: attempt }),
    ];

    expect(stripRetractions(events)).toEqual([]);
  });

  it('retracting a nonexistent attempt leaves all other evidence intact', () => {
    const kept = event({ t: 1, attemptId: nextAttemptId() });
    const events = [
      kept,
      event({ t: 2, kind: 'retraction', retracts: 'never-existed' }),
    ];

    expect(stripRetractions(events)).toEqual([kept]);
  });

  it('keeps presentation and target provenance fields intact through stripping', () => {
    const observation = event({
      t: 1,
      attemptId: nextAttemptId(),
      presentedSurface: '食べた',
      targetRef: { kind: 'grammar-pattern', id: 'ている' },
    });
    const otherAttempt = nextAttemptId();
    const events = [
      observation,
      event({ t: 2, attemptId: otherAttempt }),
      event({ t: 3, kind: 'retraction', retracts: otherAttempt }),
    ];

    // Only the retracted sibling attempt is dropped; the observation survives with its provenance.
    expect(stripRetractions(events)).toEqual([observation]);
  });
});

describe('stripRetractedLog', () => {
  it('strips per key and drops keys left empty', () => {
    const attempt = nextAttemptId();
    const log = {
      'ja:a': [event({ t: 1, attemptId: attempt }), event({ t: 2, kind: 'retraction', retracts: attempt })],
      'ja:b': [event({ t: 1, kind: 'status', toStatus: 'known' })],
    };

    expect(stripRetractedLog(log)).toEqual({
      'ja:b': [event({ t: 1, kind: 'status', toStatus: 'known' })],
    });
  });
});
