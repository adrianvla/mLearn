import { describe, expect, it } from 'vitest';
import type { Flashcard, LanguageData } from '../../../shared/types';
import { flashcardReviewPolicyEntry, selectFlashcardReviewDecision, restoreFlashcardReviewDecision, reviewHandoffActivity } from './flashcardReviewDecision';
import { isLearningDecision } from '../../../shared/learningDecision';
import { selectNextEncounter } from '../../learning/engine';
import { fitLearningModel } from '../../../shared/learningModel';

const card: Flashcard = {
  id: 'authored-card', language: 'future', content: { type: 'word', front: '  odd form  ', back: 'authored answer' },
  state: 'new', ease: 2.5, interval: 0, dueDate: 10, reviews: 0, lapses: 0, learningStep: 0,
  createdAt: 10, lastReviewed: 0, lastUpdated: 10,
};

describe('review policy encounter', () => {
  it('honours deliberate review outside the selected outcome without inventing positive action value', () => {
    const entry = flashcardReviewPolicyEntry(card, 'future');
    const context = { learning: { model: fitLearningModel([], 20), horizonDays: 30, deferDays: 3,
      availableSeconds: [120], continuationValue: 0, targetWeights: {} } };
    expect(selectNextEncounter({ preset: 'RETENTION', nowMs: 20, reviewQueueEntries: [entry], context })?.action).toBe('DEFER');
    const selected = selectFlashcardReviewDecision({ id: 'deliberate-review', at: 20, entries: [entry], context });
    expect(selected).not.toBeNull();
    expect(selected!.provenance.selected.key).toBe(card.id);
    expect(selected!.decision.trace?.model?.evaluations[0].expectedCapabilityDays).toBe(0);
    expect(selected!.decision.encounter.why).toContain('learner-selected activity');
  });
  it('preserves a negative recent-repeat estimate while allowing the learner to continue review', () => {
    const entry = flashcardReviewPolicyEntry(card, 'future');
    const day = 86_400_000;
    const model = fitLearningModel(entry.targets.map((target, index) => ({
      t: day, kind: 'rating' as const, source: 'manual' as const, quality: 'fluent' as const,
      method: 'recall' as const, attemptId: `recent-${index}`, taskType: entry.task!.taskTemplateId,
      targetRef: { kind: 'surface' as const, id: target.entityId, capability: target.capability },
    })), day + 1000);
    const context = { learning: { model, horizonDays: 30, deferDays: 3, availableSeconds: [120], continuationValue: 0 } };
    const selected = selectFlashcardReviewDecision({ id: 'deliberate-repeat', at: day + 1000, entries: [entry], context })!;
    expect(selected.decision.trace?.model?.activityChoicePreserved).toBe(true);
    expect(selected.decision.trace?.model?.evaluations[0].expectedCapabilityDays).toBeLessThan(0);
    expect(selected.provenance.selected.key).toBe(card.id);
    expect(model.observations).toBe(entry.targets.length);
  });
  it('freezes full-workload choices and exact input before presentation without making up structural improvement', () => {
    const entries = Array.from({ length: 20 }, (_, index) => flashcardReviewPolicyEntry({ ...card, id: `card-${index}` }, 'future'));
    let draws = 0;
    const selected = selectFlashcardReviewDecision({ id: 'pre-presentation', at: 20, entries,
      rng: () => { draws += 1; return draws / 25; } })!;
    expect(draws).toBe(0);
    expect(isLearningDecision(selected.provenance)).toBe(true);
    expect(selected.provenance.detail.candidateCount).toBe(20);
    expect(selected.provenance.baseline).toBeNull();
    expect(selected.provenance.selected.presentation).toEqual({ cardId: selected.decision.candidate.key,
      language: 'future', surface: '  odd form  ', contentVersion: expect.any(String) });
    entries[0].task!.requested.push('later mutation');
    expect(selected.provenance.selected.task.requested).not.toContain('later mutation');
  });

  it('binds an opaque Home retrieval offer to its exact declared task, card and targets', () => {
    const activity = { id: 'future::sound', kind: 'audio-recognition' as const,
      label: 'Package sound task', prompt: 'Package prompt', targets: ['future::access'] };
    const entry = flashcardReviewPolicyEntry(card, 'future', null, activity);
    const parent = { id: 'home', at: 10, policyVersion: 'home-learning-controller@12',
      selected: { key: 'review:authored-card:future::sound', action: 'review',
        task: { ...entry.task!, inputModality: 'activity-handoff', responseModality: 'none' },
        targets: entry.targets.map(target => ({ kind: 'surface', id: target.entityId, capability: target.capability })),
        presentation: { ...entry.presentation, reviewActivityId: activity.id, retrievalTask: entry.task } }, baseline: null, detail: {} };
    expect(reviewHandoffActivity(parent, 'home', card, 'future', null, [activity])).toEqual(activity);
    expect(reviewHandoffActivity(parent, 'different-request', card, 'future', null, [activity])).toBeNull();
    expect(reviewHandoffActivity(parent, 'home', card, 'other-language', null, [activity])).toBeNull();
    expect(reviewHandoffActivity(parent, 'home', { ...card, content: { ...card.content, back: 'changed answer' } }, 'future', null, [activity])).toBeNull();
    expect(reviewHandoffActivity(parent, 'home', card, 'future', null, [{ ...activity, targets: ['future::other'] }])).toBeNull();
    expect(reviewHandoffActivity(parent, 'home', card, 'future', null, [])).toBeNull();
    expect(reviewHandoffActivity({ ...parent, selected: { ...parent.selected, targets: [] } }, 'home', card, 'future', null, [activity])).toBeNull();
  });

  it('resumes the original immutable decision without drawing or using a changed cue/task', () => {
    const entry = flashcardReviewPolicyEntry(card, 'future');
    const original = selectFlashcardReviewDecision({ id: 'original-choice', at: 20, entries: [entry], rng: () => 0.8 })!;
    const presentation = { id: 'original-choice', cardId: card.id, decision: original.provenance };
    const resumed = restoreFlashcardReviewDecision(presentation, card, entry);
    expect(resumed?.provenance).toEqual(original.provenance);
    expect(restoreFlashcardReviewDecision(presentation, { ...card, content: { ...card.content, front: 'changed' } }, entry)).toBeNull();
    expect(restoreFlashcardReviewDecision(presentation, { ...card, content: { ...card.content, back: 'new answer' } }, entry)).toBeNull();
    expect(restoreFlashcardReviewDecision(presentation, card, { ...entry, task: { ...entry.task!, requested: ['future::new-task'] } })).toBeNull();
    expect(restoreFlashcardReviewDecision({ ...presentation, cardId: 'another-card' }, card, entry)).toBeNull();
  });

  it.each(['new', 'review'] as const)('addresses the exact authored cue and opaque package task for %s cards', state => {
    const languageData: LanguageData = { name: 'Future', learning: { capabilities: {
      'future::relationship': { label: 'An unfamiliar task', testableIn: ['srs-review'] },
      'future::other-task': { testableIn: ['some-other-activity'] },
    } } };
    const entry = flashcardReviewPolicyEntry({ ...card, state }, 'future', languageData);
    const decision = selectNextEncounter({ preset: 'RETENTION', nowMs: 20, reviewQueueEntries: [entry] })!;
    const id = 'future:surface:f266d8ee1dc3c5e465f34190c673abeecae0bf8b0d4e94903081e5717932d6ba';
    expect(decision.encounter.targets).toEqual([
      { entityId: id, capability: 'sense-recognition' },
      { entityId: id, capability: 'surface-recognition' },
      { entityId: id, capability: 'future::relationship' },
    ]);
    expect(decision.encounter.task.requested).toEqual(['sense-recognition', 'surface-recognition', 'future::relationship']);
    expect(decision.candidate.origin).toBe(state === 'new' ? 'new-card' : 'retention');
    expect(decision.trace?.ranking[0].targets).toEqual(decision.encounter.targets);
    expect(decision.trace?.ranking[0].task).toEqual(decision.encounter.task);
    expect(JSON.parse(JSON.stringify(decision.trace))).toEqual(decision.trace);
    decision.encounter.targets[0].entityId = 'later mutation';
    decision.encounter.task.requested.push('later mutation');
    expect(decision.trace?.ranking[0].targets?.[0].entityId).toBe(id);
    expect(decision.trace?.ranking[0].task?.requested).not.toContain('later mutation');
  });
});
