import { describe, expect, it } from 'vitest';
import type { LearningDecision } from '../../../shared/learningDecision';
import type { LanguageData } from '../../../shared/types';
import { selectNextEncounter } from '../../learning/engine';
import { captureGrammarSelfAssessmentDecision, grammarSelfAssessmentDecisionMatches, GRAMMAR_SELF_ASSESS_TASK } from './grammarSelfAssessmentDecision';

type Point = NonNullable<LanguageData['grammar']>[number];
const point = { pattern: 'opaque-construction', meaning: 'package cue', level: 42,
  packageFeature: { 'vendor:unknown': ['unfamiliar', { value: 7 }] } } as Point;
const select = () => selectNextEncounter({ preset: 'CURRICULUM', levelStudyItems: [],
  curriculumGrammarItems: [{ language: 'future', pattern: point.pattern, level: 42, task: GRAMMAR_SELF_ASSESS_TASK }],
  nowMs: 1234, config: { deferFloor: 0 } })!;

describe('frozen grammar self-assessment admission', () => {
  it('freezes the actual policy task, target and package-owned content without registering its semantics', () => {
    const selected = select();
    selected.encounter.task = JSON.parse(JSON.stringify(selected.encounter.task));
    const decision = captureGrammarSelfAssessmentDecision(selected, 'future', point, 1234);
    expect(grammarSelfAssessmentDecisionMatches(JSON.parse(JSON.stringify(decision)), 'future', point)).toBe(true);
    selected.encounter.task.requested.push('new-request');
    expect(decision.selected.task.requested).toEqual(['grammar-recognition']);
    expect(decision.detail.limits).toEqual(expect.arrayContaining([expect.stringContaining('Self-reported')]));
  });

  it('links the saved Home handoff without copying its forecast or accepting another target', () => {
    const handoff: LearningDecision = { id: 'home-choice', at: 1000, policyVersion: 'home-test',
      selected: { key: 'grammar:opaque-construction', action: 'grammar',
        targets: [{ kind: 'grammar-pattern', id: 'future:grammar:opaque-construction', capability: 'grammar-recognition' }],
        task: { ...GRAMMAR_SELF_ASSESS_TASK, inputModality: 'activity-handoff', responseModality: 'none', supplied: [], ratingMode: 'profile' } },
      baseline: null, detail: { opaqueForecast: { packageOwned: [7, 'future'] } } };
    const decision = captureGrammarSelfAssessmentDecision(select(), 'future', point, 1234, handoff);
    expect(decision.detail.handoffRef).toEqual({ id: handoff.id });
    expect(decision.detail).not.toHaveProperty('opaqueForecast');
    const wrong = { ...handoff, selected: { ...handoff.selected, targets: [{ kind: 'grammar-pattern', id: 'other', capability: 'grammar-recognition' }] } };
    expect(() => captureGrammarSelfAssessmentDecision(select(), 'future', point, 1234, wrong)).toThrow('handoff');
  });

  it('refuses a changed language, target, task or unknown structured cue field', () => {
    const decision = captureGrammarSelfAssessmentDecision(select(), 'future', point, 1234);
    expect(grammarSelfAssessmentDecisionMatches(decision, 'other', point)).toBe(false);
    expect(grammarSelfAssessmentDecisionMatches(decision, 'future', { ...point, pattern: 'other' })).toBe(false);
    expect(grammarSelfAssessmentDecisionMatches(decision, 'future', { ...point,
      packageFeature: { 'vendor:unknown': ['changed'] } } as Point)).toBe(false);
    const altered = JSON.parse(JSON.stringify(decision));
    altered.selected.task.responseModality = 'self-assessment';
    expect(grammarSelfAssessmentDecisionMatches(altered, 'future', point)).toBe(false);
  });
});
