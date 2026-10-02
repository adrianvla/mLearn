import { describe, expect, it } from 'vitest';
import type { Flashcard, LanguageData } from '../../../shared/types';
import { flashcardReviewPolicyEntry, selectFlashcardReviewDecision } from './flashcardReviewDecision';
import { isLearningDecision } from '../../../shared/learningDecision';
import { selectNextEncounter } from '../../learning/engine';

const card: Flashcard = {
  id: 'authored-card', language: 'future', content: { type: 'word', front: '  odd form  ', back: 'authored answer' },
  state: 'new', ease: 2.5, interval: 0, dueDate: 10, reviews: 0, lapses: 0, learningStep: 0,
  createdAt: 10, lastReviewed: 0, lastUpdated: 10,
};

describe('review policy encounter', () => {
  it('freezes full-workload choices and exact input before presentation without making up structural improvement', () => {
    const entries = Array.from({ length: 20 }, (_, index) => flashcardReviewPolicyEntry({ ...card, id: `card-${index}` }, 'future'));
    let draws = 0;
    const selected = selectFlashcardReviewDecision({ id: 'pre-presentation', at: 20, entries,
      rng: () => { draws += 1; return draws / 25; } })!;
    expect(draws).toBe(20);
    expect(isLearningDecision(selected.provenance)).toBe(true);
    expect(selected.provenance.detail.candidateCount).toBe(20);
    expect(selected.provenance.baseline?.key).toBe(selected.provenance.selected.key);
    expect(selected.provenance.selected.presentation).toEqual({ cardId: selected.decision.candidate.key,
      language: 'future', surface: '  odd form  ' });
    entries[0].task!.requested.push('later mutation');
    expect(selected.provenance.selected.task.requested).not.toContain('later mutation');
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
