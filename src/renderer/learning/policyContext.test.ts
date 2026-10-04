import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { policyContextFromSettings } from './policyContext';
import { fitLearningModel } from '../../shared/learningModel';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

describe('policyContextFromSettings', () => {
  it('keeps the required date distinct from a consolidation horizon that responds to observed missed opportunities', () => {
    const day = 86_400_000;
    const now = Date.parse('2026-10-04');
    const events: KnowledgeEvent[] = [now - 30 * day, now - 20 * day].map((t, i) => ({ t, kind: 'rating', source: 'srs', attemptId: `episode-${i}`, activeLatencyMs: 10_000 }));
    const settings = { ...DEFAULT_SETTINGS, learningGoals: [{ id: 'future-outcome', language: 'future', outcome: 'Package assessment', status: 'active' as const,
      priority: 1, createdAt: now, deadline: '2026-10-14' }] };
    const sparse = policyContextFromSettings(settings, 'future', { model: fitLearningModel([], now), events: [] }).learning!;
    const missed = policyContextFromSettings(settings, 'future', { model: fitLearningModel(events, now), events }).learning!;
    expect(sparse.assessmentAt).toBe(Date.parse('2026-10-14'));
    expect(missed.assessmentAt).toBe(sparse.assessmentAt);
    expect(missed.horizonDays).toBe(30);
    expect(missed.horizonDays).toBeGreaterThan(sparse.horizonDays);
    expect(missed.deferDays).toBe(20);
    expect(policyContextFromSettings(settings, 'future', { model: fitLearningModel(events, now + 11 * day), events }).learning!.assessmentAt).toBeUndefined();
  });
  it('uses boundary time for deadlines and missed opportunities without resetting the fitted model', () => {
    const day = 86400000;
    const fitAt = Date.parse('2026-10-04');
    const model = fitLearningModel([], fitAt);
    const settings = { ...DEFAULT_SETTINGS, learningGoals: [{ id: 'scope', language: 'future', outcome: 'Scope',
      status: 'active' as const, priority: 1, createdAt: fitAt, deadline: '2026-10-14' }] };
    const before = policyContextFromSettings(settings, 'future', { model, events: [], nowMs: fitAt }).learning!;
    const later = policyContextFromSettings(settings, 'future', { model, events: [], nowMs: fitAt + 11 * day }).learning!;
    expect(before.assessmentAt).toBe(Date.parse('2026-10-14'));
    expect(later.assessmentAt).toBeUndefined();
    expect(later.horizonDays).toBe(30);
    expect(later.model).toBe(model);
    expect(model.at).toBe(fitAt);
  });
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
