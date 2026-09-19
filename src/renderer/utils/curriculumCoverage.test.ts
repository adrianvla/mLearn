import { describe, expect, it } from 'vitest';
import type { LanguageData } from '../../shared/types';
import type { KnowledgeEventLog } from '../../shared/knowledgeEvents';
import {
  classifyGrammarMeasurements,
  grammarCategoryPressure,
  grammarCurriculumRequirements,
  grammarLevelOrder,
  summarizeGrammarCurriculum,
} from './curriculumCoverage';
import { grammarEvidenceKey, grammarRecognitionEvidence, replayGrammarRecognition } from '../../shared/grammar/evidence';
import { effectiveThresholds, evidenceStatusFromEase } from '../../shared/knowledge/effectiveKnowledge';

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

describe('grammarCategoryPressure (R07 bottleneck signal)', () => {
  const items = [
    { pattern: 'ば', category: 'conditional' },
    { pattern: '〜わけではない', category: 'negation' },
    { pattern: 'ない', category: 'negation' },
    { pattern: 'uncategorized', category: undefined },
  ];

  it('scores mean insecurity per category from recorded measurements only', () => {
    const measurements = classifyGrammarMeasurements('ja', log([
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rating', quality: 'missed', easeAfter: 1.3 }) },
      { pattern: '〜わけではない', event: grammarRecognitionEvidence('ja', '〜わけではない', { t: 2, kind: 'rating', quality: 'fluent', easeAfter: 2.5 }) },
    ]));
    const pressure = grammarCategoryPressure(items, measurements);
    // conditional: its one measured construction is unknown → 1;
    // negation: its one measured construction is known → 0.
    expect(pressure).toEqual({ conditional: 1, negation: 0 });
  });

  it('stays absent without measured attempts and ignores uncategorized items', () => {
    const measurements = classifyGrammarMeasurements('ja', log([
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rollup', timesSeenDelta: 5 }) },
    ]));
    // Passive exposure is not attempt evidence: no pressure invented.
    expect(measurements.get('ば')?.passiveOnly).toBe(true);
    expect(grammarCategoryPressure(items, measurements)).toEqual({});
    expect(grammarCategoryPressure(items, new Map())).toEqual({});
  });
});

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

  it('a rating followed by a failure rollup matches the full journal replay (no filtered second authority)', () => {
    // FINAL review reproduction: coverage used to replay only the rating
    // (1.8 → Known) while the materialized selector replayed the complete
    // ordered journal (1.8 − failure penalty → Learning). Coverage must use
    // the same full replay and resolve the SAME state.
    const events = log([
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rating', quality: 'fluent', easeAfter: 1.8 }) },
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 2, kind: 'rollup', grammarFailedDelta: 1, origin: 'grammar-failure' }) },
    ]);
    const fullReplay = replayGrammarRecognition(events[grammarEvidenceKey('ja', 'ば', 'grammar-recognition')]!)!;
    expect(fullReplay.hasActiveEvidence).toBe(true);
    expect(fullReplay.ease).toBeCloseTo(1.8 - 0.15, 10);
    const covered = classifyGrammarMeasurements('ja', events).get('ば')!;
    expect(covered.state).toBe(evidenceStatusFromEase(fullReplay.ease, effectiveThresholds()));
    expect(covered.state).toBe('learning');
    expect(covered.passiveOnly).toBe(fullReplay.hasActiveEvidence === false);
    expect(covered.failures).toBe(1);
  });

  it('rated state uses the configured effective thresholds, not the shipped anchors', () => {
    // ease 2.6 with easeThresholdKnown 3.0 is Learning. The former
    // knowledgeStrength.easeToStatus hardcoded the 1.8 anchor and reported
    // Known — the Level Study vs GrammarSelector disagreement the FINAL
    // review reproduced.
    const measurements = classifyGrammarMeasurements('ja', log([
      { pattern: 'ば', event: grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rating', quality: 'good', easeAfter: 2.6 }) },
    ]), effectiveThresholds({ easeThresholdLearning: 2.0, easeThresholdKnown: 3.0 }));
    expect(measurements.get('ば')?.state).toBe('learning');
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
