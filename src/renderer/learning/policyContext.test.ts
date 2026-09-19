import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { policyContextFromSettings } from './policyContext';

describe('policyContextFromSettings', () => {
  it('defaults to steady intensity with no goal', () => {
    expect(policyContextFromSettings(DEFAULT_SETTINGS)).toEqual({ intensity: 'steady' });
  });

  it('maps an exam goal with a deadline to epoch ms', () => {
    const context = policyContextFromSettings({
      sessionIntensity: 'intensive',
      examGoal: { kind: 'exam', deadline: '2026-10-11', target: 'JLPT N1', language: 'ja' },
    }, 'ja');
    // The learner-owned free-text target rides along verbatim (R19/R20):
    // traces can name WHAT the goal aims at; the policy never interprets it.
    expect(context).toEqual({
      intensity: 'intensive',
      goal: { kind: 'exam', deadlineMs: Date.parse('2026-10-11'), target: 'JLPT N1', language: 'ja' },
    });
  });

  it('omits the target when the learner did not record one', () => {
    const context = policyContextFromSettings({
      sessionIntensity: 'steady',
      examGoal: { kind: 'exam', deadline: '2026-10-11', language: 'ja' },
    }, 'ja');
    expect(context.goal).toEqual({ kind: 'exam', deadlineMs: Date.parse('2026-10-11'), language: 'ja' });
    expect('target' in (context.goal ?? {})).toBe(false);
  });

  it('keeps the exam kind when the deadline is missing or unparseable', () => {
    for (const deadline of [undefined, 'not-a-date', '']) {
      const context = policyContextFromSettings({
        sessionIntensity: 'steady',
        examGoal: { kind: 'exam', ...(deadline !== undefined ? { deadline } : {}), language: 'ja' },
      }, 'ja');
      expect(context.goal).toEqual({ kind: 'exam', language: 'ja' });
    }
  });

  it('falls back to the default intensity on unknown or legacy values', () => {
    for (const value of [undefined, 'furious'] as const) {
      expect(
        policyContextFromSettings({ sessionIntensity: value as never, examGoal: { kind: 'none' } }).intensity,
      ).toBe('steady');
    }
  });

  it('applies a scoped goal only to its own learning language', () => {
    const settings = {
      sessionIntensity: 'steady' as const,
      examGoal: { kind: 'exam' as const, deadline: '2026-10-11', target: 'JLPT N1', language: 'ja' },
    };
    expect(policyContextFromSettings(settings, 'ja').goal).toEqual({
      kind: 'exam',
      deadlineMs: Date.parse('2026-10-11'),
      target: 'JLPT N1',
      language: 'ja',
    });

    // The reviewer-4 leak: an unrelated language receives NO deadline rule.
    expect(policyContextFromSettings(settings, 'de').goal).toBeUndefined();
    expect(policyContextFromSettings(settings, 'ru').goal).toBeUndefined();
  });

  it('never applies a goal without a recorded language, whatever the queue language', () => {
    const settings = {
      sessionIntensity: 'steady' as const,
      examGoal: { kind: 'exam' as const, deadline: '2026-10-11', target: 'JLPT N1' },
    };
    // Unscoped goals are inactive here — SettingsProvider stamps them once
    // at load; no dynamic re-scoping to the current app language.
    expect(policyContextFromSettings(settings, 'ja').goal).toBeUndefined();
    expect(policyContextFromSettings(settings, 'de').goal).toBeUndefined();
    expect(policyContextFromSettings(settings).goal).toBeUndefined();
  });

  it('ignores a scoped goal when the card language is not supplied', () => {
    const settings = {
      sessionIntensity: 'steady' as const,
      examGoal: { kind: 'exam' as const, deadline: '2026-10-11', language: 'ja' },
    };
    expect(policyContextFromSettings(settings).goal).toBeUndefined();
  });
});
