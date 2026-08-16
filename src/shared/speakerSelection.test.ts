import { describe, expect, it } from 'vitest';

import { DEFAULT_SPEAKER_SELECTION_CONFIG, selectSpeaker } from './speakerSelection';
import type { Participant } from './world';

function participant(id: string, displayName: string, facets?: Participant['facets']): Participant {
  return {
    id,
    displayName,
    kind: 'persistent',
    personaText: '',
    facets,
    setupComplete: true,
  };
}

describe('selectSpeaker', () => {
  it('is deterministic: 20 calls return the identical id', () => {
    const participants = [participant('p_b', 'Bella'), participant('p_a', 'Anna')];
    const signals = {
      lastEventText: 'Hi everyone',
      openLoopUrgency: { p_a: 0.8 },
      relationshipPull: { p_b: 0.7 },
      lastSpeakerId: 'p_a',
    };
    const first = selectSpeaker(participants, signals);
    for (let i = 0; i < 20; i++) {
      expect(selectSpeaker(participants, signals)).toBe(first);
    }
  });

  it('keeps a below-floor participant silent unless directly addressed', () => {
    const stenographer = participant('p_s', 'Sten', { speaking_propensity: 0.05 });
    const loquacious = participant('p_l', 'Lou', { speaking_propensity: 1 });
    const participants = [stenographer, loquacious];
    const signals = {
      lastEventText: 'Hello',
      openLoopUrgency: { p_s: 1 },
      relationshipPull: { p_s: 1 },
    };
    expect(selectSpeaker(participants, signals)).toBe('p_l');
    expect(
      selectSpeaker(participants, { ...signals, lastEventText: 'What do you think, Sten?' }),
    ).toBe('p_s');
  });

  it('detects direct address case-insensitively', () => {
    const quiet = participant('p_q', 'Yuki', { speaking_propensity: 0.05 });
    const loud = participant('p_l', 'Lou', { speaking_propensity: 1 });
    const participants = [quiet, loud];
    expect(selectSpeaker(participants, { lastEventText: 'yuki, your turn' })).toBe('p_q');
    expect(selectSpeaker(participants, { lastEventText: 'YUKI!' })).toBe('p_q');
  });

  it('treats a missing facet as full propensity (1-on-1 room always speaks)', () => {
    const only = participant('p_only', 'Solo');
    expect(selectSpeaker([only])).toBe('p_only');
    expect(selectSpeaker([only], { lastSpeakerId: 'p_only' })).toBe('p_only');
  });

  it('applies the last-speaker penalty only when another participant is eligible', () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    // Equal base scores (both propensity 1): the last speaker loses 1 point.
    expect(selectSpeaker([a, b], { lastSpeakerId: 'p_a' })).toBe('p_b');
    // Single eligible participant: penalty must not silence them.
    expect(selectSpeaker([a], { lastSpeakerId: 'p_a' })).toBe('p_a');
  });

  it('breaks score ties on lexicographically smallest id', () => {
    const a = participant('p_a', 'Anna');
    const b = participant('p_b', 'Bella');
    expect(selectSpeaker([a, b])).toBe('p_a');
    expect(selectSpeaker([b, a])).toBe('p_a');
  });

  it('returns null when everyone is below the floor and nobody is addressed', () => {
    const participants = [
      participant('p_s1', 'S1', { speaking_propensity: 0.05 }),
      participant('p_s2', 'S2', { speaking_propensity: 0.02 }),
    ];
    expect(selectSpeaker(participants, { lastEventText: 'Hello' })).toBeNull();
  });

  it('returns null for an empty roster', () => {
    expect(selectSpeaker([])).toBeNull();
  });

  it('honors a config override lowering the floor to zero', () => {
    const quiet = participant('p_q', 'Quiet', { speaking_propensity: 0.05 });
    const participants = [quiet];
    expect(selectSpeaker(participants, {}, DEFAULT_SPEAKER_SELECTION_CONFIG)).toBeNull();
    expect(selectSpeaker(participants, {}, { propensityFloor: 0 })).toBe('p_q');
  });
});
