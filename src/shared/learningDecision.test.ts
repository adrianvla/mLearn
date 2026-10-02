import { describe, expect, it } from 'vitest';
import type { KnowledgeEvent } from './knowledgeEvents';
import { applyLearningDecision, isLearningDecision, type LearningDecision } from './learningDecision';

const address = { kind: 'surface', id: 'future:surface:cue', capability: 'future::access' };
const decision: LearningDecision = { id: 'choice-1', at: 1, policyVersion: 'policy-1', selected: { key: 'cue', action: 'PROBE',
  targets: [address], task: { taskTemplateId: 'future::task', inputModality: 'written-form', responseModality: 'recall',
    supplied: ['written-form'], requested: ['future::access'], fluencyRequired: false, ratingMode: 'profile' } },
  baseline: null, detail: { 'future::unknown': { nested: [3, { label: 'unregistered' }] } } };
const event: KnowledgeEvent = { t: 2, kind: 'rating', source: 'manual', attemptId: 'attempt-1', targetRef: address, quality: 'fluent' };

describe('durable learning decision/outcome join', () => {
  it('attaches the full snapshot once to actual measured rows and retains unknown structured metadata', () => {
    const rows = applyLearningDecision([event, { ...event, t: 3 }], decision);
    expect(rows.map(row => row.decisionRef)).toEqual([{ id: 'choice-1' }, { id: 'choice-1' }]);
    expect(rows[0].decision).toEqual(decision);
    expect(rows[1].decision).toBeUndefined();
    expect(rows[0].decision).not.toBe(decision);
    expect(event.decisionRef).toBeUndefined();
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });
  it('refuses an outcome outside the pinned access or an invented exact sense', () => {
    expect(() => applyLearningDecision([{ ...event, targetRef: { ...address, capability: 'future::other' } }], decision)).toThrow();
    expect(() => applyLearningDecision([{ ...event, targetRef: { ...address, kind: 'sense', id: 'future::sense' } }], decision)).toThrow();
  });
  it('validates technical envelopes without enumerating package categories or stripping unknown detail', () => {
    expect(isLearningDecision(JSON.parse(JSON.stringify(decision)))).toBe(true);
    expect(isLearningDecision({ ...decision, at: Number.NaN })).toBe(false);
    expect(isLearningDecision({ ...decision, selected: { ...decision.selected, targets: [{ ...address, capability: '' }] } })).toBe(false);
    expect(isLearningDecision({ ...decision, selected: { ...decision.selected, task: { ...decision.selected.task, requested: ['another'] } } })).toBe(false);
    expect(() => applyLearningDecision([event], { ...decision, id: '' })).toThrow();
  });
  it('does not invent an observation when every access was supplied', () => {
    expect(applyLearningDecision([], decision)).toEqual([]);
  });
});
