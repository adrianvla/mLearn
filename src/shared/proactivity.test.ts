import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, type Settings } from './types';
import {
  CALL_COOLDOWN_MS,
  CALL_SCORE_THRESHOLD,
  MESSAGE_COOLDOWN_MS,
  MESSAGE_SCORE_THRESHOLD,
  evaluateProactivity,
  isInQuietHours,
  nextCallEventType,
  type ProactiveCandidate,
} from './proactivity';

const now = new Date(2025, 0, 1, 12, 0).getTime();

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function candidate(overrides: Partial<ProactiveCandidate> = {}): ProactiveCandidate {
  return {
    id: 'candidate-1',
    participantId: 'participant-1',
    kind: 'message',
    score: 1,
    createdAt: now,
    ...overrides,
  };
}

function evaluate(candidates: ProactiveCandidate[], overrides: Partial<Settings> = {}, participantKinds: Record<string, 'persistent' | 'temporary'> = {}): ReturnType<typeof evaluateProactivity> {
  return evaluateProactivity(candidates, settings(overrides), { now, participantKinds });
}

describe('evaluateProactivity', () => {
  it('honors the master switch and empty candidates', () => {
    expect(evaluate([candidate()], { proactivityEnabled: false })).toEqual({ kind: 'nothing', suppressedBy: 'master-switch' });
    expect(evaluate([])).toEqual({ kind: 'nothing' });
  });

  it('honors participant and call-specific opt-outs', () => {
    expect(evaluate([candidate()], { proactiveOptOutParticipantIds: ['participant-1'] })).toEqual({ kind: 'nothing', suppressedBy: 'opt-out' });
    expect(evaluate([candidate({ kind: 'call' })], { proactiveCallOptOutParticipantIds: ['participant-1'] })).toEqual({ kind: 'nothing', suppressedBy: 'call-opt-out' });
    expect(evaluate([candidate()], { proactiveCallOptOutParticipantIds: ['participant-1'] })).toMatchObject({ kind: 'message' });
  });

  it('suppresses candidates below their kind threshold', () => {
    expect(evaluate([candidate({ score: MESSAGE_SCORE_THRESHOLD - 0.01 })])).toEqual({ kind: 'nothing', suppressedBy: 'threshold' });
    expect(evaluate([candidate({ kind: 'call', score: CALL_SCORE_THRESHOLD - 0.01 })])).toEqual({ kind: 'nothing', suppressedBy: 'threshold' });
  });

  it('fires a call candidate produced upstream without any LLM dependency', () => {
    const result = evaluate([candidate({ kind: 'call', score: CALL_SCORE_THRESHOLD })]);
    expect(result.kind).toBe('call');
    expect(result.candidate?.kind).toBe('call');
  });

  it('uses stricter call thresholds and cooldowns', () => {
    expect(CALL_SCORE_THRESHOLD).toBeGreaterThan(MESSAGE_SCORE_THRESHOLD);
    expect(CALL_COOLDOWN_MS).toBeGreaterThan(MESSAGE_COOLDOWN_MS);
    expect(evaluate([candidate({ score: MESSAGE_SCORE_THRESHOLD, lastFiredAt: now - MESSAGE_COOLDOWN_MS })]).kind).toBe('message');
    expect(evaluate([candidate({ kind: 'call', score: CALL_SCORE_THRESHOLD, lastFiredAt: now - CALL_COOLDOWN_MS + 1 })])).toEqual({ kind: 'nothing', suppressedBy: 'cooldown' });
  });

  it('suppresses calls during quiet hours and temporary participants of either kind', () => {
    const quietNow = new Date(2025, 0, 1, 23, 0).getTime();
    expect(evaluateProactivity([candidate({ kind: 'call' })], settings({ proactiveQuietHoursEnabled: true }), { now: quietNow, participantKinds: {} })).toEqual({ kind: 'nothing', suppressedBy: 'quiet-hours' });
    for (const kind of ['message', 'call'] as const) {
      expect(evaluate([candidate({ kind })], {}, { 'participant-1': 'temporary' })).toEqual({ kind: 'nothing', suppressedBy: 'ineligible-participant' });
    }
  });
});

describe('isInQuietHours', () => {
  it('handles overnight, disabled, and malformed windows in local time', () => {
    const overnight = settings({ proactiveQuietHoursEnabled: true, proactiveQuietHoursStart: '22:00', proactiveQuietHoursEnd: '08:00' });
    expect(isInQuietHours(overnight, new Date(2025, 0, 1, 23, 0).getTime())).toBe(true);
    expect(isInQuietHours(overnight, new Date(2025, 0, 2, 7, 59).getTime())).toBe(true);
    expect(isInQuietHours(overnight, new Date(2025, 0, 1, 12, 0).getTime())).toBe(false);
    expect(isInQuietHours(settings({ proactiveQuietHoursEnabled: false }), now)).toBe(false);
    expect(isInQuietHours(settings({ proactiveQuietHoursEnabled: true, proactiveQuietHoursStart: '25:00' }), now)).toBe(false);
  });
});

describe('nextCallEventType', () => {
  it('maps every call outcome to its journal event type', () => {
    expect(nextCallEventType('initiated')).toBe('call_initiated');
    expect(nextCallEventType('accepted')).toBe('call_accepted');
    expect(nextCallEventType('declined')).toBe('call_declined');
    expect(nextCallEventType('missed')).toBe('call_missed');
    expect(nextCallEventType('ended')).toBe('call_ended');
  });
});
