import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../shared/types';
import type { KnowledgeEventLog } from '../../shared/knowledgeEvents';
import {
  classifyGrammarMeasurements,
  grammarCurriculumRequirements,
  grammarLevelOrder,
  summarizeGrammarCurriculum,
} from './curriculumCoverage';
import { grammarEvidenceKey, grammarRecognitionEvidence } from '../../shared/grammar/evidence';

const languageData = {
  // JLPT convention: lower level number = harder (N1 = level 1).
  grammar: [
    { pattern: '〜わけではない', meaning: 'it is not that…', level: 2 },
    { pattern: 'ば', meaning: 'if (conditional)', level: 3 },
    { pattern: 'ない', meaning: 'negative', level: 4 },
    { pattern: 'no-level-point', meaning: 'unbucketed' },
  ],
  grammarLevels: { names: { '2': 'N2', '3': 'N3', '4': 'N4' } },
} as unknown as LanguageData;

const key = (pattern: string): string => grammarEvidenceKey('ja', pattern, 'grammar-recognition');

function log(entries: Array<{ pattern: string; event: ReturnType<typeof grammarRecognitionEvidence> }>): KnowledgeEventLog {
  const result: KnowledgeEventLog = {};
  for (const { pattern, event } of entries) {
    (result[key(pattern)] ??= []).push(event);
  }
  return result;
}

describe('grammarCurriculumRequirements', () => {
  it('maps package grammar points onto their own scale, skipping unbucketed ones', () => {
    const requirements = grammarCurriculumRequirements('ja', languageData);
    expect(requirements.map((requirement) => require_level(requirement))).toEqual([2, 3, 4]);
    expect(requirements.every((requirement) => requirement.component === 'grammar')).toBe(true);
  });

  function require_level(requirement: { level: number | string }): number | string {
    return requirement.level;
  }
});

describe('grammarLevelOrder', () => {
  it('orders the package grammar scale easiest first', () => {
    expect(grammarLevelOrder(languageData)).toEqual([4, 3, 2]);
  });
});

describe('classifyGrammarMeasurements', () => {
  it('passive encounter rollups are familiarity only — never measured', () => {
    const measurements = classifyGrammarMeasurements('ja', log([
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rollup', timesSeenDelta: 3 }) },
    ]));
    expect(measurements.get('ば')).toMatchObject({ state: 'unmeasured', passiveOnly: true, exposures: 3 });
  });

  it('an interactive rating measures the construction', () => {
    const measurements = classifyGrammarMeasurements('ja', log([
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rating', quality: 'fluent', easeAfter: 1.8 }) },
    ]));
    expect(measurements.get('ば')?.state).toBe('known');
    expect(measurements.get('ば')?.passiveOnly).toBe(false);
  });

  it('a failure report is measured negative, not unmeasured', () => {
    const measurements = classifyGrammarMeasurements('ja', log([
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rollup', grammarFailedDelta: 1, origin: 'grammar-failure' }) },
    ]));
    expect(measurements.get('ば')?.state).toBe('unknown');
    expect(measurements.get('ば')?.passiveOnly).toBe(false);
  });

  it('retracted evidence stops measuring the construction', () => {
    const rating = grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rating', quality: 'fluent', easeAfter: 1.8, attemptId: 'a1' });
    const eventLog = log([{ pattern: 'ば', event: rating }]);
    eventLog[key('ば')].push({
      t: 2,
      kind: 'retraction',
      source: 'srs',
      aspect: 'grammar',
      retracts: 'a1',
    });
    const measurements = classifyGrammarMeasurements('ja', eventLog);
    expect(measurements.get('ば')?.state).toBe('unmeasured');
  });
});

describe('summarizeGrammarCurriculum', () => {
  it('aggregates over the grammar scale; unmeasured blocks completion', () => {
    const eventLog = log([
      { pattern: 'ない', event: grammarRecognitionEvidence('ja', 'ない', { t: 1, kind: 'rating', quality: 'fluent', easeAfter: 1.8 }) },
      { pattern: '〜わけではない', event: grammarRecognitionEvidence('ja', '〜わけではない', { t: 2, kind: 'rollup', timesSeenDelta: 5 }) },
    ]);
    const summary = summarizeGrammarCurriculum('ja', languageData, eventLog);
    expect(summary.component).toBe('grammar');
    expect(summary.total).toBe(3);
    expect(summary.known).toBe(1);
    // Passive-only rollup: seen 5×, still not measured.
    expect(summary.unmeasured).toBe(2);
    expect(summary.complete).toBe(false);
  });
});
