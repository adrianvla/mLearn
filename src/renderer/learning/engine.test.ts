import { describe, expect, it } from 'vitest';
import { PRESETS, calibrationPoolItem, selectEncounterBatch, selectNextEncounter } from './engine';

const target = { entityId: 'de:surface:hallo', capability: 'surface-recognition' as const };

describe('selectNextEncounter', () => {
  it('composes each preset with its source adapter', () => {
    const retention = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: 'due', word: 'hallo', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      rng: () => 0.5,
    });
    const calibration = selectNextEncounter({
      preset: 'CALIBRATION',
      nowMs: 10_000,
      wordSyncPoolItems: [calibrationPoolItem('de:neu', 'neu', 'de', 1)],
      rng: () => 0.5,
    });

    expect(retention?.action).toBe('MAINTAIN');
    expect(calibration?.action).toBe('TEACH');
    expect(PRESETS.RETENTION.weights['retention-need']).toBeGreaterThan(0);
    expect(PRESETS.CALIBRATION.weights.novelty).toBeGreaterThan(0);
  });

  it('leaves callers able to retain their existing fallback on defer', () => {
    const fallback = { id: 'future' };
    const decision = selectNextEncounter({
      preset: 'RETENTION',
      nowMs: 10_000,
      reviewQueueEntries: [{ id: fallback.id, word: 'morgen', language: 'de', targets: [target], dueDate: 9_000, interval: 1_000 }],
      config: { attentionBudgetRemaining: 0 },
    });

    expect(decision?.action).toBe('DEFER');
    expect(decision?.action === 'DEFER' ? decision.candidate.key : fallback.id).toBe(fallback.id);
  });

  it('preserves Level Study, media, and suggested source order through policy selection', () => {
    const expected = ['first', 'second'];
    const common = [
      { key: 'first', word: 'hallo', language: 'de' },
      { key: 'second', word: 'morgen', language: 'de' },
    ];

    expect(selectEncounterBatch({ preset: 'CURRICULUM', nowMs: 0, levelStudyItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
    expect(selectEncounterBatch({ preset: 'MEDIA', nowMs: 0, mediaItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
    expect(selectEncounterBatch({ preset: 'SUGGESTED', nowMs: 0, suggestedItems: common }).map((decision) => decision.candidate.key)).toEqual(expected);
  });
});
