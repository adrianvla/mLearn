import { describe, expect, it } from 'vitest';
import type { GrammarItemSemanticValidation, GrammarPracticeItemSource, LanguageData } from '../../shared/types';
import type { KnowledgeEvent, KnowledgeEventLog } from '../../shared/knowledgeEvents';
import { grammarEvidenceKey } from '../../shared/grammar/evidence';
import {
  MOCK_MAX_REQUESTED_PER_SECTION,
  MOCK_PER_ITEM_SECONDS,
  MOCK_SUMMARY_LIMIT,
  abandonMockSession,
  activeStepMs,
  applyMockAnswer,
  assembleMockInstance,
  deriveMockBlueprints,
  gradeMockSubmission,
  isMockPaused,
  isMockStepTimedOut,
  loadMockSummaries,
  loadStoredMockSession,
  mockAttemptPayload,
  mockMissedPatterns,
  mockSessionTiming,
  pauseMockSession,
  presentedMockStep,
  resumeMockSession,
  saveMockSummary,
  saveStoredMockSession,
  startMockSession,
  summarizeMockResults,
} from './mockExam';
import { itemContentVersion, questionBankFromLanguageData } from './questionBank';
import type { MockBlueprint } from './mockExam';

// ---------------------------------------------------------------------------
// Fixtures — German-like package declaring item sources per pattern. Records
// are produced by the FIXTURE validator (a stand-in for an actually-executed
// independent validation); production packages carry none until a real
// validator runs (R12) and mocks then simply have nothing to assemble (G04).
// ---------------------------------------------------------------------------

type PatternName = 'weil' | 'deshalb' | 'obwohl' | 'trotzdem';

const CONTRAST: Record<PatternName, {
  context: string;
  conditions: string[];
  distractors: ReadonlyArray<{ span: string; violates: string[]; rationale: string }>;
}> = {
  weil: {
    context: 'Ich bleibe heute im Bett, weil ich Fieber habe.',
    conditions: ['causal-reading', 'subordinate-clause-final-verb'],
    distractors: [
      { span: 'obwohl', violates: ['causal-reading'], rationale: 'concessive reading contradicts staying in bed' },
      { span: 'deshalb', violates: ['causal-reading', 'subordinate-clause-final-verb'], rationale: 'causal adverb, verb-second' },
    ],
  },
  deshalb: {
    context: 'Ich habe Fieber, deshalb bleibe ich heute im Bett.',
    conditions: ['causal-reading', 'verb-second-main-clause'],
    distractors: [
      { span: 'weil', violates: ['verb-second-main-clause'], rationale: 'subordinate conjunction, verb-final' },
      { span: 'trotzdem', violates: ['causal-reading', 'verb-second-main-clause'], rationale: 'concessive reading contradicts the fever' },
    ],
  },
  obwohl: {
    context: 'Wir gehen spazieren, obwohl es regnet.',
    conditions: ['concessive-reading', 'subordinate-clause-final-verb'],
    distractors: [
      { span: 'weil', violates: ['concessive-reading'], rationale: 'causal reading contradicts the walk' },
      { span: 'deshalb', violates: ['concessive-reading', 'subordinate-clause-final-verb'], rationale: 'causal adverb, verb-second' },
    ],
  },
  trotzdem: {
    context: 'Es regnet, trotzdem gehen wir spazieren.',
    conditions: ['concessive-reading', 'verb-second-main-clause'],
    distractors: [
      { span: 'deshalb', violates: ['concessive-reading'], rationale: 'causal reading contradicts the walk' },
      { span: 'obwohl', violates: ['concessive-reading', 'verb-second-main-clause'], rationale: 'subordinate conjunction, verb-final' },
    ],
  },
};

let itemCounter = 0;
const semanticRecord = (source: GrammarPracticeItemSource, overrides: Partial<GrammarItemSemanticValidation> = {}): GrammarItemSemanticValidation => ({
  status: 'passed',
  validator: 'fixture-independent-validator@1',
  at: '2026-09-19T00:00:00Z',
  contentHash: itemContentVersion(source),
  reasons: ['fixture record'],
  ...overrides,
});
const reviewedItem = (pattern: PatternName, overrides: Partial<GrammarPracticeItemSource> = {}): GrammarPracticeItemSource => {
  itemCounter += 1;
  const base: GrammarPracticeItemSource = {
    id: `de-${pattern}-${itemCounter}`,
    context: CONTRAST[pattern].context,
    answerSpan: pattern,
    conditions: [...CONTRAST[pattern].conditions],
    distractors: CONTRAST[pattern].distractors.map((d) => ({ ...d, violates: [...d.violates] })),
    ...overrides,
  };
  return { ...base, validation: { semantic: semanticRecord(base) } };
};
const rejectedItem = (pattern: PatternName, id: string): GrammarPracticeItemSource => {
  itemCounter += 1;
  const base: GrammarPracticeItemSource = {
    id,
    context: CONTRAST[pattern].context,
    answerSpan: pattern,
    conditions: [...CONTRAST[pattern].conditions],
    distractors: CONTRAST[pattern].distractors.map((d) => ({ ...d, violates: [...d.violates] })),
  };
  return { ...base, validation: { semantic: semanticRecord(base, { status: 'rejected', reasons: ['fixture rejection'] }) } };
};

const weilA = reviewedItem('weil');
const weilB = reviewedItem('weil');
const deshalbA = reviewedItem('deshalb');
const deshalbB = reviewedItem('deshalb');
const obwohlA = reviewedItem('obwohl');
const obwohlB = reviewedItem('obwohl');
const trotzdemA = reviewedItem('trotzdem');

const baseLanguageData = (): LanguageData => ({
  grammar: [
    { pattern: 'weil', level: 3, category: 'reasons', items: [weilA, weilB] },
    { pattern: 'deshalb', level: 3, category: 'reasons', items: [deshalbA, deshalbB] },
    { pattern: 'obwohl', level: 3, category: 'concession', items: [obwohlA, obwohlB] },
    { pattern: 'trotzdem', level: 2, items: [trotzdemA] },
    { pattern: 'bare', level: 1, items: [] },
  ],
  grammarLevels: { names: { '2': 'A2', '3': 'B1' } },
  languageData: { version: '2026.09.19-test' },
} as unknown as LanguageData);

const bank = () => questionBankFromLanguageData('de', baseLanguageData());

const attemptEvent = (attemptId: string, pattern: PatternName, itemId: string): KnowledgeEvent => ({
  t: 1000,
  kind: 'rating',
  source: 'grammar',
  aspect: 'grammar',
  attemptId,
  quality: 'struggled',
  easeAfter: 1.55,
  itemRef: { id: itemId, version: 'item-v3:fixture' },
  targetRef: { kind: 'grammar-pattern', id: `de:grammar:${pattern}`, capability: 'grammar-recognition' },
} as KnowledgeEvent);
const logWith = (attempts: ReadonlyArray<{ pattern: PatternName; itemId: string }>): KnowledgeEventLog => {
  const log: KnowledgeEventLog = {};
  for (const { pattern, itemId } of attempts) {
    const key = grammarEvidenceKey('de', pattern, 'grammar-recognition');
    log[key] = [...(log[key] ?? []), attemptEvent(`${pattern}-${itemId}`, pattern, itemId)];
  }
  return log;
};

const blueprint3 = (): MockBlueprint =>
  deriveMockBlueprints('de', baseLanguageData()).find((candidate) => candidate.level === 3)!;

// Convenience: the MCQ index of the gold span for a step's item.
const goldIndex = (step: { item: { options: ReadonlyArray<{ text: string }> } }): number =>
  step.item.options.findIndex((option) => option.text === step.source.answerSpan);

describe('blueprint derivation (R13/R19)', () => {
  it('declares one fixed blueprint per item-backed level in package scale order', () => {
    const blueprints = deriveMockBlueprints('de', baseLanguageData());
    expect(blueprints.map((candidate) => candidate.id)).toEqual(['mlearn-mock:de:2', 'mlearn-mock:de:3']);
    expect(blueprints.map((candidate) => candidate.levelLabel)).toEqual(['A2', 'B1']);
    for (const candidate of blueprints) {
      expect(candidate.provider).toBe('mlearn-derived');
      expect(candidate.scope).toBe('grammar-contrast');
      expect(candidate.contentVersion).toBe('2026.09.19-test');
      expect(candidate.timing).toEqual({
        perItemSeconds: MOCK_PER_ITEM_SECONDS,
        pauses: 'allowed-and-recorded',
        timeout: 'unanswered-not-scored',
      });
      expect(candidate.assistance).toEqual({ policy: 'closed-book' });
    }
  });

  it('sections follow the package declaration: one per category, uncategorized share one section', () => {
    const level3 = blueprint3();
    expect(level3.sections.map((section) => section.id)).toEqual([
      'mlearn-mock:de:3#cat:reasons',
      'mlearn-mock:de:3#cat:concession',
    ]);
    expect(level3.sections.map((section) => section.category)).toEqual(['reasons', 'concession']);
    expect(level3.sections[0].patterns).toEqual(['weil', 'deshalb']);
    expect(level3.sections[0].requestedCount).toBe(2);
    expect(level3.sections[1].requestedCount).toBe(1);
    const level2 = deriveMockBlueprints('de', baseLanguageData())[0];
    expect(level2.sections.map((section) => section.id)).toEqual(['mlearn-mock:de:2#constructions']);
    expect(level2.sections[0].requestedCount).toBeLessThanOrEqual(MOCK_MAX_REQUESTED_PER_SECTION);
  });

  it('a level without declared items has no blueprint (G04: nothing to assemble)', () => {
    expect(deriveMockBlueprints('de', baseLanguageData()).some((candidate) => candidate.level === 1)).toBe(false);
  });

  it('version binds structure AND content version; deliverability never moves the denominator', () => {
    const first = blueprint3();
    const second = blueprint3();
    expect(second.version).toBe(first.version);

    const otherVersion = baseLanguageData();
    (otherVersion.languageData as { version?: string }).version = '2026.09.20-test';
    expect(deriveMockBlueprints('de', otherVersion).find((candidate) => candidate.level === 3)!.version)
      .not.toBe(first.version);

    // A semantically REJECTED family is still declared: requestedCount (and
    // therefore the blueprint identity) stays; assembly reports the gap.
    const withRejected = baseLanguageData();
    const reasons = withRejected.grammar!.find((point) => point.pattern === 'weil')!;
    reasons.items = [rejectedItem('weil', 'de-weil-rejected'), ...reasons.items.filter((entry) => entry.id !== weilA.id)];
    const rederived = deriveMockBlueprints('de', withRejected).find((candidate) => candidate.level === 3)!;
    expect(rederived.version).toBe(first.version);
    expect(rederived.sections[0].requestedCount).toBe(2);
  });
});

describe('instance assembly — held-out families (R13/G02)', () => {
  it('is deterministic: same inputs assemble identical steps', () => {
    const blueprint = blueprint3();
    const first = assembleMockInstance(blueprint, bank(), {}, 42, 1000);
    const second = assembleMockInstance(blueprint, bank(), {}, 42, 1000);
    expect(second.steps.map((step) => step.item.id)).toEqual(first.steps.map((step) => step.item.id));
  });

  it('the seed shuffles order, never the fixed structure', () => {
    const blueprint = blueprint3();
    const first = assembleMockInstance(blueprint, bank(), {}, 7, 1000);
    const second = assembleMockInstance(blueprint, bank(), {}, 1007, 1000);
    expect([...first.steps.map((step) => step.pattern)].sort()).toEqual([...second.steps.map((step) => step.pattern)].sort());
    expect(second.steps.map((step) => step.item.id)).not.toEqual(first.steps.map((step) => step.item.id));
  });

  it('serves fresh families before rehearsed ones and backfills least-attempted first', () => {
    const blueprint = blueprint3();
    const instance = assembleMockInstance(blueprint, bank(), logWith([{ pattern: 'weil', itemId: weilA.id }]), 42, 1000);
    const reasons = instance.sections.find((section) => section.section.category === 'reasons')!;
    const stepIds = reasons.steps.map((step) => step.item.id);
    // weilA carries an attempt → the WHOLE weil family is rehearsed; the
    // fresh deshalb family is served first, then one representative from
    // the rehearsed weil family; its unattempted sibling is preferred.
    expect([deshalbA.id, deshalbB.id]).toContain(stepIds[0]);
    expect(stepIds[1]).toBe(weilB.id);
    expect(reasons.freshFamilyCount).toBe(1);
    expect(reasons.rehearsedFamilyCount).toBe(1);
    // The concession section has no recorded attempt at all: fully fresh.
    const concession = instance.sections.find((section) => section.section.category === 'concession')!;
    expect(concession.freshFamilyCount).toBe(1);
    expect(concession.rehearsedFamilyCount).toBe(0);
  });

  it('one rehearsed family never marks another family rehearsed', () => {
    const blueprint = blueprint3();
    const instance = assembleMockInstance(blueprint, bank(), logWith([{ pattern: 'obwohl', itemId: obwohlA.id }]), 42, 1000);
    const concession = instance.sections.find((section) => section.section.category === 'concession')!;
    // Same family (obwohl): its one selected sibling is rehearsed material.
    expect(concession.freshFamilyCount).toBe(0);
    expect(concession.rehearsedFamilyCount).toBe(1);
    const reasons = instance.sections.find((section) => section.section.category === 'reasons')!;
    expect(reasons.freshFamilyCount).toBe(2);
    expect(reasons.rehearsedFamilyCount).toBe(0);
  });

  it('reports a section that cannot assemble its declared draw (G04: never padded)', () => {
    const withRejected = baseLanguageData();
    const reasons = withRejected.grammar!.find((point) => point.pattern === 'weil')!;
    reasons.items = [rejectedItem('weil', 'de-weil-rejected-a'), rejectedItem('weil', 'de-weil-rejected-b')];
    const blueprint = deriveMockBlueprints('de', withRejected).find((candidate) => candidate.level === 3)!;
    const instance = assembleMockInstance(blueprint, questionBankFromLanguageData('de', withRejected), {}, 42, 1000);
    const reasonsInstance = instance.sections.find((section) => section.section.category === 'reasons')!;
    expect(reasonsInstance.requestedCount).toBe(2);
    expect(reasonsInstance.steps).toHaveLength(1);
  });

  it('declares the step mode from the package formats (absent = mcq)', () => {
    const blueprint = blueprint3();
    const typedData = baseLanguageData();
    const reasons = typedData.grammar!.find((point) => point.pattern === 'deshalb')!;
    reasons.items = [reviewedItem('deshalb', { formats: ['typed'] })];
    const causal = typedData.grammar!.find((point) => point.pattern === 'weil')!;
    causal.items = [reviewedItem('weil', { formats: ['mcq', 'typed'] })];
    const typedBank = questionBankFromLanguageData('de', typedData);
    const instance = assembleMockInstance(blueprint, typedBank, {}, 42, 1000);
    const reasonsModes = instance.steps.filter((step) => step.pattern === 'deshalb').map((step) => step.mode).sort();
    expect(reasonsModes).toEqual(['typed']);
    const untouched = instance.steps.filter((step) => step.pattern === 'weil');
    for (const step of untouched) expect(step.mode).toBe('mcq');
  });
});

describe('conservative, gold-blind grading (R13)', () => {
  const blueprint = () => blueprint3();
  const instance = () => assembleMockInstance(blueprint(), bank(), {}, 42, 1000);

  it('a correct MCQ is one successful attempt (struggled), never proof of mastery', () => {
    const step = instance().steps.find((candidate) => candidate.pattern === 'weil')!;
    const graded = gradeMockSubmission(step, { kind: 'mcq', index: goldIndex(step) });
    expect(graded).toMatchObject({ correct: true, quality: 'struggled' });
    const wrong = gradeMockSubmission(step, { kind: 'mcq', index: (goldIndex(step) + 1) % step.item.options.length });
    expect(wrong).toMatchObject({ correct: false, quality: 'missed' });
    expect(wrong?.chosenSpan).not.toBe(step.source.answerSpan);
  });

  it('times out without a grade: unanswered is not scored', () => {
    const step = instance().steps[0];
    expect(gradeMockSubmission(step, { kind: 'timeout' })).toBeNull();
  });

  it('grades typed answers against the declared span + declared accepts, with device provenance (G05)', () => {
    const typedData = baseLanguageData();
    const reasons = typedData.grammar!.find((point) => point.pattern === 'deshalb')!;
    reasons.items = [reviewedItem('deshalb', { formats: ['typed'], accepts: ['daher'] })];
    const typedBlueprint = blueprint();
    const typedInstance = assembleMockInstance(typedBlueprint, questionBankFromLanguageData('de', typedData), {}, 42, 1000);
    const step = typedInstance.steps.find((candidate) => candidate.pattern === 'deshalb')!;
    expect(step.mode).toBe('typed');
    expect(gradeMockSubmission(step, { kind: 'typed', value: 'deshalb' })).toMatchObject({ correct: true, quality: 'struggled' });
    expect(gradeMockSubmission(step, { kind: 'typed', value: 'daher' })).toMatchObject({ correct: true, quality: 'struggled' });
    const ime = gradeMockSubmission(step, { kind: 'typed', value: 'deshalb', suppliedBy: 'ime' });
    expect(ime?.scaffolds).toEqual({ 'ime-composition': true });
    // An undeclared variant is simply wrong — never fuzzy credit.
    expect(gradeMockSubmission(step, { kind: 'typed', value: 'somit' })).toMatchObject({ correct: false, quality: 'missed' });
  });

  it('re-derives gold from the item source at submit time (no baked-in answer key)', () => {
    const mockedInstance = instance();
    const step = mockedInstance.steps.find((candidate) => candidate.pattern === 'weil')!;
    expect(step.item.options.every((option) => !('correct' in option))).toBe(true);
    // Mutating the declared source AFTER assembly flips grading: the item's
    // delivered options carry no correctness and grading consults the source.
    const mutated = { ...step.source, answerSpan: 'obwohl' };
    const graded = gradeMockSubmission({ ...step, source: mutated }, { kind: 'mcq', index: goldIndex(step) });
    expect(graded?.correct).toBe(false);
  });
});

describe('session integrity (G01)', () => {
  const setup = () => {
    const mockedInstance = assembleMockInstance(blueprint3(), bank(), {}, 42, 1000);
    const state = startMockSession(mockedInstance, 1_000_000);
    return { mockedInstance, state };
  };

  it('presents exactly the current step and finishes after the last one', () => {
    const { state } = setup();
    expect(presentedMockStep(state)).toBe(state.instance.steps[0]);
    const answered = applyMockAnswer(state, { kind: 'mcq', index: 0 }, 'attempt-1', 1_005_000);
    expect(answered.cursor).toBe(1);
    expect(presentedMockStep(answered)).toBe(state.instance.steps[1]);
    let current = answered;
    while (presentedMockStep(current) !== null) {
      current = applyMockAnswer(current, { kind: 'timeout' }, undefined, current.startedAt + 1000);
    }
    expect(current.finishedAt).toBeDefined();
    expect(presentedMockStep(current)).toBeNull();
  });

  it('rejects a real submission without a canonical attempt id (no silent evidence)', () => {
    const { state } = setup();
    expect(applyMockAnswer(state, { kind: 'mcq', index: 0 }, undefined, 1_002_000)).toEqual(state);
  });

  it('ignores stale/replayed submissions: prior-step echo, replayed attempt id, future step (G01)', () => {
    const { state } = setup();
    const first = applyMockAnswer(state, { kind: 'mcq', index: 0, stepIndex: 0 }, 'attempt-1', 1_005_000);
    expect(first.cursor).toBe(1);
    // A replayed response for the ALREADY-ANSWERED step (double click,
    // cross-tab echo, retried write) must not answer the next step.
    const priorEcho = applyMockAnswer(first, { kind: 'mcq', index: 1, stepIndex: 0 }, 'attempt-2', 1_006_000);
    expect(priorEcho).toEqual(first);
    // A replayed attempt id is a duplicate journal write: never re-recorded.
    const replayedId = applyMockAnswer(first, { kind: 'mcq', index: 1, stepIndex: 1 }, 'attempt-1', 1_006_000);
    expect(replayedId).toEqual(first);
    // A submission naming a FUTURE step is stale.
    const future = applyMockAnswer(first, { kind: 'mcq', index: 1, stepIndex: 5 }, 'attempt-3', 1_006_000);
    expect(future).toEqual(first);
    // The correctly enveloped next-step submission still applies.
    const next = applyMockAnswer(first, { kind: 'mcq', index: 1, stepIndex: 1 }, 'attempt-2', 1_006_000);
    expect(next.cursor).toBe(2);
  });

  it('records timeouts without an attempt id and keeps them unscored', () => {
    const { state } = setup();
    const answered = applyMockAnswer(state, { kind: 'timeout' }, undefined, 1_095_000);
    expect(answered.answers).toHaveLength(1);
    expect(answered.answers[0]).toMatchObject({ timedOut: true, stepIndex: 0 });
    expect(answered.answers[0].attemptId).toBeUndefined();
  });

  it('declared budget is a hard cutoff: late real answers are ignored, only the timeout records unanswered', () => {
    const { state } = setup();
    const step = presentedMockStep(state)!;
    // Exactly at the budget the answer still counts (the overrun is strict).
    const atBudget = applyMockAnswer(state, { kind: 'mcq', index: goldIndex(step), stepIndex: 0 }, 'attempt-at-budget', 1_090_000);
    expect(atBudget.answers).toHaveLength(1);
    // 1ms past the budget a real answer is late and ignored…
    expect(applyMockAnswer(state, { kind: 'mcq', index: goldIndex(step), stepIndex: 0 }, 'attempt-late', 1_090_001)).toEqual(state);
    // …no payload is derived for the unanswerable step…
    expect(mockAttemptPayload(state, { kind: 'mcq', index: goldIndex(step), stepIndex: 0 }, 1_090_001)).toBeNull();
    // …and the declared timeout still records the step unanswered.
    const timed = applyMockAnswer(state, { kind: 'timeout', stepIndex: 0 }, undefined, 1_090_001);
    expect(timed.answers).toHaveLength(1);
    expect(timed.answers[0]).toMatchObject({ timedOut: true, stepIndex: 0 });
  });

  it('declared timing: pauses are explicit, excluded from the clock, and timeouts need ACTIVE overrun', () => {
    const { state } = setup();
    const paused = pauseMockSession(state, 1_002_000);
    expect(isMockPaused(paused)).toBe(true);
    // While paused the clock is stopped: 98s of wall time, 2s active.
    expect(activeStepMs(paused, 1_100_000)).toBe(2_000);
    expect(isMockStepTimedOut(paused, 1_100_000)).toBe(false);
    const resumed = resumeMockSession(paused, 1_012_000);
    expect(isMockPaused(resumed)).toBe(false);
    expect(activeStepMs(resumed, 1_092_000)).toBe(82_000);
    expect(isMockStepTimedOut(resumed, 1_092_000)).toBe(false);
    // Past the 90s ACTIVE budget the step is timed out.
    expect(isMockStepTimedOut(resumed, 1_102_000)).toBe(true);
    // Pause/resume are no-ops outside their valid states.
    expect(pauseMockSession(paused, 1_003_000)).toEqual(paused);
    expect(resumeMockSession(state, 1_003_000)).toEqual(state);
  });

  it('aggregates declared timing provenance for the results', () => {
    const { state } = setup();
    const withPause = pauseMockSession(state, 1_002_000);
    const resumed = resumeMockSession(withPause, 1_020_000);
    const finished = applyMockAnswer(resumed, { kind: 'timeout' }, undefined, 1_030_000);
    // finishedAt stays open until the LAST step; force completion:
    let current = finished;
    while (presentedMockStep(current) !== null) current = applyMockAnswer(current, { kind: 'timeout' }, undefined, current.answers[current.answers.length - 1].answeredAt + 1_000);
    const timing = mockSessionTiming(current, current.answers[current.answers.length - 1].answeredAt);
    expect(timing.pauseCount).toBe(1);
    expect(timing.pausedMs).toBe(18_000);
  });

  it('the journal payload carries provenance, conservative quality and timing (same T2 path)', () => {
    const { state } = setup();
    const step = presentedMockStep(state)!;
    const payload = mockAttemptPayload(state, { kind: 'mcq', index: goldIndex(step) }, 1_004_000);
    expect(payload).toMatchObject({
      pattern: step.pattern,
      level: 3,
      quality: 'struggled',
      itemRef: { id: step.item.id, version: step.item.version, seed: step.item.seed },
      validationRef: {
        validator: 'fixture-independent-validator@1',
        at: '2026-09-19T00:00:00Z',
        contentHash: step.item.validation.semantic?.contentHash,
      },
      taskType: step.mode === 'typed' ? 'mock-typed' : 'mock-contrast',
      timing: { wallLatencyMs: 4_000, activeLatencyMs: 4_000, interruptionCount: 0, interrupted: false, stalled: false },
    });
    // Timeout and finished sessions produce no payload.
    expect(mockAttemptPayload(state, { kind: 'timeout' }, 1_004_000)).toBeNull();
    expect(mockAttemptPayload({ ...state, finishedAt: 1_004_000 }, { kind: 'mcq', index: 0 }, 1_004_000)).toBeNull();
  });

  it('abandoning is non-epistemic: answered attempts stand, unanswered stay unanswered (G04)', () => {
    const { state } = setup();
    const partial = applyMockAnswer(state, { kind: 'mcq', index: goldIndex(presentedMockStep(state)!) }, 'attempt-1', 1_005_000);
    const abandoned = abandonMockSession(partial);
    expect(abandoned.abandoned).toBe(true);
    expect(presentedMockStep(abandoned)).toBeNull();
    expect(abandoned.answers).toEqual(partial.answers);
    const results = summarizeMockResults(abandoned);
    expect(results.abandoned).toBe(true);
    expect(results.totalAnswered).toBe(1);
  });
});

describe('results and the repair set (R13)', () => {
  it('summarizes totals, section provenance and per-pattern outcomes', () => {
    const mockedInstance = assembleMockInstance(blueprint3(), bank(), {}, 42, 1000);
    let state = startMockSession(mockedInstance, 1_000_000);
    // Answer every step by pattern: weil correctly, deshalb wrongly, the
    // rest times out. (Each pattern family contributes two steps.)
    let submissions = 0;
    while (presentedMockStep(state) !== null) {
      const step = presentedMockStep(state)!;
      const submission = step.pattern === 'weil'
        ? { kind: 'mcq' as const, index: goldIndex(step) }
        : step.pattern === 'deshalb'
          ? { kind: 'mcq' as const, index: (goldIndex(step) + 1) % step.item.options.length }
          : { kind: 'timeout' as const };
      state = applyMockAnswer(state, submission, `a${submissions}`, 1_005_000 + submissions * 1000);
      submissions += 1;
    }
    const results = summarizeMockResults(state);
    expect(results.blueprintId).toBe('mlearn-mock:de:3');
    expect(results.blueprintVersion).toBe(mockedInstance.blueprint.version);
    expect(results.levelLabel).toBe('B1');
    expect(results.seed).toBe(42);
    expect(results.contentVersion).toBe('2026.09.19-test');
    expect(results.totalAnswered).toBe(2);
    expect(results.totalCorrect).toBe(1);
    expect(results.totalTimedOut).toBe(mockedInstance.steps.length - 2);
    expect(results.availabilityGap).toBe(false);
    expect(results.patterns.find((row) => row.pattern === 'weil')).toMatchObject({ attempted: 1, correct: 1, missed: 0 });
    expect(results.patterns.find((row) => row.pattern === 'deshalb')).toMatchObject({ attempted: 1, correct: 0, missed: 1 });
    // The concession section was only ever offered timeouts: honest zeros.
    expect(results.patterns.find((row) => row.pattern === 'obwohl')).toMatchObject({ attempted: 0, correct: 0, missed: 0 });
    expect(mockMissedPatterns(state)).toEqual([{ pattern: 'deshalb', missed: 1 }]);
  });

  it('flags availability gaps instead of padding (G04)', () => {
    const withRejected = baseLanguageData();
    const reasons = withRejected.grammar!.find((point) => point.pattern === 'weil')!;
    reasons.items = [rejectedItem('weil', 'de-weil-rejected-a'), rejectedItem('weil', 'de-weil-rejected-b')];
    const mockedInstance = assembleMockInstance(
      deriveMockBlueprints('de', withRejected).find((candidate) => candidate.level === 3)!,
      questionBankFromLanguageData('de', withRejected),
      {},
      42,
      1000,
    );
    let state = startMockSession(mockedInstance, 1_000_000);
    while (presentedMockStep(state) !== null) state = applyMockAnswer(state, { kind: 'timeout' }, undefined, 1_010_000);
    const results = summarizeMockResults(state);
    expect(results.availabilityGap).toBe(true);
    const reasonsResult = results.sections.find((section) => section.sectionId.endsWith('cat:reasons'))!;
    expect(reasonsResult.assembledCount).toBe(1);
    expect(reasonsResult.requestedCount).toBe(2);
  });
});

describe('persistence (G01/G04)', () => {
  it('round-trips an in-progress session and the restored session stays usable', () => {
    const languageData = baseLanguageData();
    const mockedInstance = assembleMockInstance(blueprint3(), questionBankFromLanguageData('de', languageData), {}, 42, 1000);
    let state = startMockSession(mockedInstance, 1_000_000);
    state = applyMockAnswer(state, { kind: 'timeout' }, undefined, 1_005_000);
    saveStoredMockSession('de', state, 1_005_000);
    const restored = loadStoredMockSession('de', languageData, 1_125_000);
    expect(restored).not.toBeNull();
    expect(restored!.cursor).toBe(state.cursor);
    expect(restored!.answers.map((answer) => answer.stepIndex)).toEqual(state.answers.map((answer) => answer.stepIndex));
    expect(restored!.instance.steps.map((step) => step.item.id)).toEqual(state.instance.steps.map((step) => step.item.id));
    expect(presentedMockStep(restored!)).toBe(restored!.instance.steps[state.cursor]);
    expect(activeStepMs(restored!, 1_125_000)).toBe(0);
    expect(isMockStepTimedOut(restored!, 1_125_000)).toBe(false);
    expect(restored!.pauses).toContainEqual({ start: 1_005_000, end: 1_125_000 });
    saveStoredMockSession('de', null);
    expect(loadStoredMockSession('de', languageData)).toBeNull();
  });

  it('discards the stored session when the package changed: content or blueprint drift, no silent replan', () => {
    const languageData = baseLanguageData();
    const mockedInstance = assembleMockInstance(blueprint3(), questionBankFromLanguageData('de', languageData), {}, 42, 1000);
    saveStoredMockSession('de', startMockSession(mockedInstance, 1_000_000));
    expect(loadStoredMockSession('de', languageData)).not.toBeNull();

    const driftVersion = baseLanguageData();
    (driftVersion.languageData as { version?: string }).version = '2026.09.20-test';
    expect(loadStoredMockSession('de', driftVersion)).toBeNull();

    const driftContent = baseLanguageData();
    const reasons = driftContent.grammar!.find((point) => point.pattern === 'weil')!;
    reasons.items = [reviewedItem('weil', { id: weilA.id, context: 'Ich bleibe heute im Bett, weil ich Kopfweh habe.' }), ...reasons.items.filter((entry) => entry.id !== weilA.id)];
    expect(loadStoredMockSession('de', driftContent)).toBeNull();
  });

  it('never stores a finished or abandoned session', () => {
    const languageData = baseLanguageData();
    const mockedInstance = assembleMockInstance(blueprint3(), questionBankFromLanguageData('de', languageData), {}, 42, 1000);
    let state = startMockSession(mockedInstance, 1_000_000);
    while (presentedMockStep(state) !== null) state = applyMockAnswer(state, { kind: 'timeout' }, undefined, 1_010_000);
    saveStoredMockSession('de', state);
    expect(loadStoredMockSession('de', languageData)).toBeNull();
  });

  it('keeps finished summaries bounded and newest-first', () => {
    const mockedInstance = assembleMockInstance(blueprint3(), bank(), {}, 42, 1000);
    const state = startMockSession(mockedInstance, 1_000_000);
    for (let index = 0; index < MOCK_SUMMARY_LIMIT + 1; index += 1) {
      saveMockSummary('de', { ...summarizeMockResults(state), startedAt: 1_000_000 + index });
    }
    const summaries = loadMockSummaries('de');
    expect(summaries).toHaveLength(MOCK_SUMMARY_LIMIT);
    expect(summaries[0].startedAt).toBe(1_000_000 + MOCK_SUMMARY_LIMIT);
  });
});
