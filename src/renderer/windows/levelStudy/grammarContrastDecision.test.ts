import { describe, expect, it } from 'vitest';
import { selectNextEncounter } from '../../learning/engine';
import { assembleContrastItem, itemContentVersion } from '../../learning/questionBank';
import type { GrammarPracticeItemSource } from '../../../shared/types';
import { captureGrammarContrastDecision, grammarContrastDecisionMatches, grammarContrastTask, type ContrastFormat } from './grammarContrastDecision';

const source: GrammarPracticeItemSource = { id: 'vendor:opaque', context: 'before opaque after', answerSpan: 'opaque',
  conditions: ['vendor:unknown'], distractors: [{ span: 'other', violates: ['vendor:unknown'], rationale: 'package-owned rule' },
    { span: 'different', violates: ['vendor:unknown'], rationale: 'another package-owned rule' }],
  formats: ['mcq', 'typed'] };
const item = assembleContrastItem({ ...source, validation: { semantic: { status: 'passed', validator: 'test-only-validator',
  at: '2026-10-04', contentHash: itemContentVersion(source) } } }, { language: 'future', pattern: 'arbitrary', seed: 7 });
const select = (format: ContrastFormat) => selectNextEncounter({ preset: 'CURRICULUM', levelStudyItems: [],
  curriculumGrammarItems: [{ language: 'future', pattern: 'arbitrary', level: 42, task: grammarContrastTask(format) }],
  nowMs: 1234, config: { deferFloor: 0 } })!;

describe('frozen contrast admission', () => {
  it.each(['mcq', 'typed'] as const)('binds actual %s conditions to the exact validated item', format => {
    const decision = captureGrammarContrastDecision(select(format), item, format, 1234);
    expect(grammarContrastDecisionMatches(JSON.parse(JSON.stringify(decision)), item, format)).toBe(true);
    expect(grammarContrastDecisionMatches(decision, item, format === 'mcq' ? 'typed' : 'mcq')).toBe(false);
    expect(grammarContrastDecisionMatches(decision, { ...item, seed: 8 }, format)).toBe(false);
    expect(grammarContrastDecisionMatches(decision, { ...item, version: 'new-content' }, format)).toBe(false);
    expect(grammarContrastDecisionMatches(decision, { ...item, validation: { ...item.validation,
      semantic: { ...item.validation.semantic!, validator: 'changed-validator' } } }, format)).toBe(false);
    expect(() => captureGrammarContrastDecision(select(format === 'mcq' ? 'typed' : 'mcq'), item, format, 1234)).toThrow('delivered task');
  });

  it('does not admit an item lacking executed semantic validation', () => {
    expect(() => captureGrammarContrastDecision(select('mcq'), { ...item, validation: { deterministic: item.validation.deterministic } }, 'mcq', 1234)).toThrow();
  });
});
