import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../shared/types';
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
