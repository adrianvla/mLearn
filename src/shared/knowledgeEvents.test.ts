import { describe, expect, it } from 'vitest';
import {
  collectRetractedAttemptIds,
  eventIsMeasurable,
  isAccessMeasurable,
  measurableAccesses,
  nextAttemptId,
  stripRetractedLog,
  stripRetractions,
  type AttemptScaffolds,
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
      taskType: 'reader',
      scaffolds: { reading: true, translation: true },
      sourceVersions: { graphSchemaVersion: 1 },
      confidence: 0.65,
      span: { start: 3, end: 6 },
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

describe('scaffold-aware measurability', () => {
  it('a scaffold that supplies an access makes it unmeasurable (acceptance B/C/D)', () => {
    const furiganaShown: AttemptScaffolds = { reading: true };
    expect(isAccessMeasurable('surface-reading', furiganaShown)).toBe(false);
    expect(isAccessMeasurable('surface-recognition', furiganaShown)).toBe(true);

    const translationShown: AttemptScaffolds = { translation: true };
    expect(isAccessMeasurable('sense-recognition', translationShown)).toBe(false);

    const prosodyColored: AttemptScaffolds = { prosody: true };
    expect(isAccessMeasurable('prosodic-pattern', prosodyColored)).toBe(false);

    const audioPlayed: AttemptScaffolds = { audio: true };
    expect(isAccessMeasurable('surface-reading', audioPlayed)).toBe(false);
    expect(isAccessMeasurable('sense-recognition', audioPlayed)).toBe(true);
  });

  it('unreported presentation state keeps the legacy measurable default (acceptance A)', () => {
    expect(isAccessMeasurable('surface-reading', undefined)).toBe(true);
    expect(measurableAccesses(['sense-recognition', 'surface-reading'], undefined)).toEqual([
      'sense-recognition',
      'surface-reading',
    ]);
    // A furigana-free written prompt CAN measure direct surface→pronunciation.
    expect(measurableAccesses(['sense-recognition', 'surface-reading'], { reading: false })).toContain('surface-reading');
  });

  it('filters tested rows down to what the presentation measures', () => {
    const tested = ['sense-recognition', 'surface-reading', 'prosodic-pattern', 'surface-recognition'] as const;
    expect(measurableAccesses(tested, { reading: true, prosody: true })).toEqual([
      'sense-recognition',
      'surface-recognition',
    ]);
  });

  it('package-declared scaffolds round-trip without core registration (open world)', () => {
    const synthetic: AttemptScaffolds = { reading: false, 'x-acme::tone-ladder': true };
    const carried: KnowledgeEvent = event({ scaffolds: synthetic, taskType: 'x-acme::listening-drill' });
    // Unknown ids survive untouched; unknown task types are preserved strings.
    expect(carried.scaffolds).toEqual(synthetic);
    expect(carried.taskType).toBe('x-acme::listening-drill');
    // Core invalidation still applies; the unknown scaffold carries no core rule.
    expect(isAccessMeasurable('surface-reading', synthetic)).toBe(true);
  });

  it('read-side predicate excludes scaffold-invalidated events but keeps address-less rows', () => {
    const cued: KnowledgeEvent = event({ aspect: 'reading', scaffolds: { reading: true } });
    const measured: KnowledgeEvent = event({ aspect: 'reading', scaffolds: { reading: false } });
    const rollupRow: KnowledgeEvent = event({ kind: 'rollup', source: 'passiveTracking' });
    expect(eventIsMeasurable(cued)).toBe(false);
    expect(eventIsMeasurable(measured)).toBe(true);
    expect(eventIsMeasurable(rollupRow)).toBe(true);
  });
});
