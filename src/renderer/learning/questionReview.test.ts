import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../shared/types';
import { assembleMockInstance, deriveMockBlueprints, startMockSession, rebuildStoredMockSession, gradeMockSubmission, applyMockAnswer, summarizeMockResults, saveMockSummary, loadMockSummaries, mockResultCompatibility } from './mockExam';
import { assembleQuestionBatch, questionBankFromLanguageData } from './questionBank';
import { exportQuestionReview, importQuestionReview } from './questionReview';

const source = { id: 'answer-bearing-id', context: 'a b c', answerSpan: 'b', conditions: ['future:conditional'],
  distractors: [{ span: 'd', violates: ['future:conditional'], rationale: 'not conditional' },
    { span: 'e', violates: ['future:conditional'], rationale: 'not conditional' }] };
const data = { languageData: { version: 'future@1' }, grammar: [{ pattern: 'answer-bearing-pattern', items: [source] }] } as unknown as LanguageData;
const result = () => ({ payloadBinding: exportQuestionReview('future', data).binding, protocol: 'mlearn-blind-review@1', reviewer: 'real-teacher', reviewerVersion: 'review-session@1',
  at: '2026-10-07T08:00:00Z', items: [{ id: 'item-1', natural: true, objectiveAligned: true, legitimateAnswers: ['b'],
    distractorsMeaningful: true, accidentalClues: false, reasons: ['conditional is uniquely supported'] }] });

describe('auditable independent question review import', () => {
  it('exports only the delivered gap and neutral aliases, then binds real results to exact scope', () => {
    const frozen = exportQuestionReview('future', data);
    expect(JSON.stringify(frozen)).not.toContain(source.id);
    expect(JSON.stringify(frozen)).not.toContain('answer-bearing-pattern');
    expect(frozen.items[0].prompt).toBe('a ［　］ c');
    const imported = importQuestionReview('future', data, frozen, result());
    const semantic = imported.grammar?.[0].items?.[0].validation?.semantic;
    expect(semantic).toMatchObject({ status: 'passed', validator: 'real-teacher', protocol: 'mlearn-blind-review@1',
      scope: { language: 'future', pattern: 'answer-bearing-pattern', packageVersion: 'future@1' } });
    expect(JSON.parse(JSON.stringify(imported))).toEqual(imported);
  });
  it('quarantines ambiguous answers and retains the actual independent judgment', () => {
    const review = result(); review.items[0].legitimateAnswers.push('d');
    const imported = importQuestionReview('future', data, exportQuestionReview('future', data), review);
    expect(imported.grammar?.[0].items?.[0].validation?.semantic).toMatchObject({ status: 'rejected', legitimateAnswers: ['b', 'd'] });
  });
  it('refuses changed payloads, incomplete/duplicate results, missing provenance and changed scope', () => {
    const frozen = exportQuestionReview('future', data);
    expect(() => importQuestionReview('other', data, frozen, result())).toThrow();
    expect(() => importQuestionReview('future', { ...data, languageData: { version: 'future@2' } } as LanguageData, frozen, result())).toThrow();
    const changed = JSON.parse(JSON.stringify(frozen)); changed.items[0].prompt = 'changed';
    expect(() => importQuestionReview('future', data, changed, result())).toThrow();
    expect(() => importQuestionReview('future', data, frozen, { ...result(), items: [] })).toThrow();
    expect(() => importQuestionReview('future', data, frozen, { ...result(), items: [result().items[0], result().items[0]] })).toThrow();
    expect(() => importQuestionReview('future', data, frozen, { ...result(), payloadBinding: 'different-review' })).toThrow();
    expect(() => importQuestionReview('future', data, frozen, { ...result(), at: 'not-a-date' })).toThrow();
    expect(() => importQuestionReview('future', data, frozen, { ...result(), reviewer: '' })).toThrow();
  });
});

it('preserves an actual imported judgment across dictionary-only package revisions but rejects changed objective semantics', () => {
  const imported = importQuestionReview('future', data, exportQuestionReview('future', data), result());
  const updated = { ...imported, languageData: { ...imported.languageData!, version: 'future@2' } };
  expect(assembleQuestionBatch(questionBankFromLanguageData('future', updated), 8).items).toHaveLength(1);
  const changed = { ...updated, grammar: updated.grammar!.map(point => ({ ...point, meaning: 'A different objective' })) };
  expect(assembleQuestionBatch(questionBankFromLanguageData('future', changed), 8).items).toHaveLength(0);
});

it('retains admitted option seed on resume, durable result identity, and historical incompatibility', () => {
  const declared = { ...data, grammar: data.grammar!.map(point => ({ ...point, level: 1, meaning: 'Package-owned arbitrary objective' })) };
  const imported = importQuestionReview('future', declared, exportQuestionReview('future', declared), { ...result(), payloadBinding: exportQuestionReview('future', declared).binding });
  const blueprint = deriveMockBlueprints('future', imported)[0];
  const instance = assembleMockInstance(blueprint, questionBankFromLanguageData('future', imported), {}, 7, 1000);
  const admitted = startMockSession(instance, 1000);
  const updated = { ...imported, languageData: { ...imported.languageData!, version: 'future@2' } };
  const restored = rebuildStoredMockSession('future', updated, { ...admitted, persistedAt: 1000 });
  expect(restored?.instance.steps[0].item.seed).toBe(admitted.instance.steps[0].item.seed);
  expect(restored?.instance.steps[0].item.options).toEqual(admitted.instance.steps[0].item.options);
  const step = admitted.instance.steps[0];
  const gold = step.item.options.findIndex(option => option.text === step.source.answerSpan);
  expect(gradeMockSubmission(step, { kind: 'mcq', index: gold })?.quality).toBe('struggled');
  const answered = applyMockAnswer(admitted, { kind: 'mcq', index: gold }, 'attempt-kept', 1100);
  const summary = summarizeMockResults(answered);
  expect(saveMockSummary('future', summary)).toBe(true);
  expect(loadMockSummaries('future').some(result => result.sessionId === summary.sessionId)).toBe(true);
  expect(mockResultCompatibility(summary, updated, {})).toBe('current');
  const changed = { ...updated, grammar: updated.grammar!.map(point => ({ ...point, meaning: 'Changed owner meaning' })) };
  expect(mockResultCompatibility(summary, changed, {})).toBe('changed');
  expect(summary.attempts?.[0].attemptId).toBe('attempt-kept');
});
