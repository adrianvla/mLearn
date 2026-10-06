import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import { policyContextFromSettings } from './policyContext';
import { fitLearningModel } from '../../shared/learningModel';
import type { LanguageData } from '../../shared/types';
import type { KnowledgeEvent } from '../../shared/knowledgeEvents';

const data: LanguageData = { name: 'Future', freq: [['word', '', 1]], frequencyLevels: { rowLevelIndex: 2 }, learning: { outcomes: { scope: { label: 'Package assessment', provenance: 'package', groups: [{ id: 'words', selectors: [{ source: 'frequency' }] }] } } } };
describe('policyContextFromSettings', () => {
  it('keeps the required date distinct from a consolidation horizon that responds to observed missed opportunities', () => {
    const day = 86_400_000;
    const now = Date.parse('2026-10-04');
    const events: KnowledgeEvent[] = [now - 30 * day, now - 20 * day].map((t, i) => ({ t, kind: 'rating', source: 'srs', attemptId: `episode-${i}`, activeLatencyMs: 10_000 }));
    const settings = { ...DEFAULT_SETTINGS, learningGoals: [{ id: 'future-outcome', language: 'future', outcome: 'Package assessment', outcomeRef: { id: 'scope' }, status: 'active' as const,
      priority: 1, createdAt: now, deadline: '2026-10-14' }] };
    const sparse = policyContextFromSettings(settings, 'future', { model: fitLearningModel([], now), events: [], data }).learning!;
    const missed = policyContextFromSettings(settings, 'future', { model: fitLearningModel(events, now), events, data }).learning!;
    expect(sparse.assessmentAt).toBe(Date.parse('2026-10-14'));
    expect(missed.assessmentAt).toBe(sparse.assessmentAt);
    expect(missed.horizonDays).toBe(30);
    expect(missed.horizonDays).toBeGreaterThan(sparse.horizonDays);
    expect(missed.deferDays).toBe(20);
    expect(policyContextFromSettings(settings, 'future', { model: fitLearningModel(events, now + 11 * day), events, data }).learning!.assessmentAt).toBeUndefined();
  });
  it('uses boundary time for deadlines and missed opportunities without resetting the fitted model', () => {
    const day = 86400000;
    const fitAt = Date.parse('2026-10-04');
    const model = fitLearningModel([], fitAt);
    const settings = { ...DEFAULT_SETTINGS, learningGoals: [{ id: 'scope', language: 'future', outcome: 'Scope', outcomeRef: { id: 'scope' },
      status: 'active' as const, priority: 1, createdAt: fitAt, deadline: '2026-10-14' }] };
    const before = policyContextFromSettings(settings, 'future', { model, events: [], data, nowMs: fitAt }).learning!;
    const later = policyContextFromSettings(settings, 'future', { model, events: [], data, nowMs: fitAt + 11 * day }).learning!;
    expect(before.assessmentAt).toBe(Date.parse('2026-10-14'));
    expect(later.assessmentAt).toBeUndefined();
    expect(later.horizonDays).toBe(30);
    expect(later.model).toBe(model);
    expect(model.at).toBe(fitAt);
  });
  it('defaults to steady intensity with no goal', () => {
    expect(policyContextFromSettings(DEFAULT_SETTINGS)).toEqual({ intensity: 'steady' });
  });

  it('preserves legacy free text but never applies it to learning policy', () => {
    const settings = { ...DEFAULT_SETTINGS, examGoal: { kind: 'exam' as const, deadline: '2026-10-11', target: 'Arbitrary title', language: 'future' } };
    expect(policyContextFromSettings(settings, 'future', { model: fitLearningModel([], 1), events: [], data }).goal).toBeUndefined();
    expect(settings.examGoal.target).toBe('Arbitrary title');
  });
  it('refuses unresolved identities and scopes structured requirements to their recorded language', () => {
    const goal = { id: 'scope', language: 'future', outcome: 'Old label', outcomeRef: { id: 'scope' }, status: 'active' as const, priority: 1, createdAt: 1, deadline: '2026-10-11' };
    const settings = { ...DEFAULT_SETTINGS, learningGoals: [goal] };
    const runtime = { model: fitLearningModel([], 1), events: [], data };
    expect(policyContextFromSettings(settings, 'future', runtime).goal).toEqual({ kind: 'outcome', target: 'Package assessment', language: 'future', deadlineMs: Date.parse('2026-10-11') });
    expect(policyContextFromSettings(settings, 'other', runtime).goal).toBeUndefined();
    expect(policyContextFromSettings(settings, 'future').goal).toBeUndefined();
    expect(policyContextFromSettings(settings, 'future', { ...runtime, data: null }).goals).toEqual([]);
  });

  it('carries package requirement evaluations with their own deadlines into policy context', () => {
    const requirementData: LanguageData = { ...data, languageData: { version: 'future-v3', assets: [] }, learning: { outcomes: {
      scope: { label: 'Package assessment', provenance: 'package', groups: [
        { id: 'words', selectors: [{ source: 'frequency', words: ['word'] }] },
      ], requirements: { conditions: [{ id: 'recall-floor', kind: 'canonical-capability-threshold', groupIds: ['words'],
        capability: 'future::recall', minimum: 0.8 }] } },
    } } };
    const deadline = '2026-10-14';
    const settings = { ...DEFAULT_SETTINGS, learningGoals: [{ id: 'scope', language: 'future', outcome: 'Package assessment',
      outcomeRef: { id: 'scope', packageVersion: 'future-v3' }, status: 'active' as const, priority: 1,
      createdAt: Date.parse('2026-10-04'), deadline }] };
    const context = policyContextFromSettings(settings, 'future', { model: fitLearningModel([], Date.parse('2026-10-04')),
      events: [], data: requirementData, nowMs: Date.parse('2026-10-04') });

    expect(context.requirementEvaluations?.[0]).toMatchObject({ goalId: 'scope', deadline,
      requirements: [{ requirementId: 'recall-floor', status: 'unknown', deadline, selection: {
        assessmentAt: Date.parse(deadline), horizonDays: 10,
      } }] });
    expect(context.learning?.targetWeights).toBeUndefined();
  });

  it('falls back to the default intensity on unknown or legacy values', () => {
    for (const value of [undefined, 'furious'] as const) {
      expect(
        policyContextFromSettings({ sessionIntensity: value as never, examGoal: { kind: 'none' } }).intensity,
      ).toBe('steady');
    }
  });

});
