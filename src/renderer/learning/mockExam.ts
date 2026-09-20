/**
 * Checkpoints and mock tests (R13) — pure core.
 *
 * A mock is a FIXED, declared session over the package's own item-backed
 * curriculum: blueprint → assembled instance (held-out first) → fixed queue →
 * canonical attempts → results with provenance → repair through the SAME
 * TeachingPolicy (the regular curriculum walk; no second scheduler).
 *
 * Honesty contracts baked in here:
 * - Provider/version bound: a blueprint carries the language package's own
 *   level scale and content version, and is labeled `mlearn-derived` — it is
 *   NEVER an official provider blueprint and its results are NEVER an
 *   official score (no score conversion exists anywhere in this module).
 * - No covert easing (R13): the step queue is fixed at assembly; answering
 *   cannot reorder, substitute, or shorten what remains.
 * - Held-out item families (R13/G02): fresh items (no recorded attempts)
 *   are served before rehearsed ones; any rehearsed backfill is counted and
 *   reported in the results, never silent.
 * - Same evidence path (R01/R13): attempts go through the canonical grammar
 *   writer with the same conservative quality mapping the contrast pass uses
 *   (correct MCQ → `struggled`, wrong → `missed`) — a correct answer is one
 *   successful attempt, never automatic proof of full objective mastery.
 * - G01 session integrity: one submission per presented step (the presenter
 *   re-grade gates on the current cursor), explicit pauses recorded and
 *   excluded from the declared clock, and resume restores exactly the
 *   stored instance or discards it — never a silent replan.
 * - G04 non-epistemic exits: skipping, pausing, timeout and abandoning
 *   record no knowledge events; unanswered items simply stay unanswered.
 * - Empty pools degrade honestly: a section that cannot assemble its
 *   declared items is reported as unavailable, not padded (G04).
 *
 * Mock bookkeeping (in-progress sessions, finished summaries) is ACTIVITY
 * metadata in localStorage — the journal remains the only epistemic
 * authority and no separate mastery store exists.
 */

import type { AttemptQuality } from '../../shared/constants';
import { nextAttemptId, type
  AttemptScaffolds,
  AttemptId,
  KnowledgeEventLog,
  KnowledgeEvent,
} from '../../shared/knowledgeEvents';
import type { GrammarPracticeItemSource, LanguageData } from '../../shared/types';
import { createSeededRng } from './teachingPolicy';
import {
  assembleContrastItem,
  gradeContrastAnswer,
  isDeliverableItem,
  itemAttemptCounts,
  itemsForPattern,
  questionBankFromLanguageData,
  type LanguageQuestionBank,
  type QuestionItem,
} from './questionBank';
import { grammarLevelName } from '../utils/curriculumCoverage';

// ---------------------------------------------------------------------------
// Blueprint (declared, provider/version-bound — R13/R19)
// ---------------------------------------------------------------------------

/** Hard cap on items one section draws, keeping a mock session bounded. */
export const MOCK_MAX_REQUESTED_PER_SECTION = 8;
/** Declared mLearn pacing guide per item (NOT official exam timing). */
export const MOCK_PER_ITEM_SECONDS = 90;
/** Finished summaries kept per language (bounded activity bookkeeping). */
export const MOCK_SUMMARY_LIMIT = 8;

export interface MockSectionPlan {
  /** Stable section id (`${blueprintId}#section`). */
  id: string;
  /** Package-declared category. Absent = the level's constructions share no declared category. */
  category?: string;
  /** Item-backed patterns of the section, package order. */
  patterns: readonly string[];
  /** Declared draw size: the section's declared item sources, capped. Fixed before any session. */
  requestedCount: number;
}

export interface MockBlueprint {
  id: string;
  language: string;
  /** `mock-blueprint-v1:<hex8>` — bound to the declared structure AND the package content version. */
  version: string;
  /** The language package version the blueprint was declared under (G03). */
  contentVersion?: string;
  /** Package level (the package's OWN scale — never merged with other scales). */
  level: number;
  /** The package's own name for that level (e.g. "B1", "N3"). */
  levelLabel: string;
  /** Honest provider labeling: derived from the installed package, never an official provider blueprint. */
  provider: 'mlearn-derived';
  scope: 'grammar-contrast';
  /** Declared timing rules: an mLearn pacing guide, explicit pauses, timeout unanswered. */
  timing: {
    perItemSeconds: number;
    pauses: 'allowed-and-recorded';
    timeout: 'unanswered-not-scored';
  };
  /** Declared assistance rules for the session (G02). This surface never
   *  renders lookup aids or answer cues; the rule is declared so consumers
   *  can audit it, and the delivery enforces it by construction. */
  assistance: { policy: 'closed-book' };
  sections: readonly MockSectionPlan[];
}

/**
 * Declares one blueprint per package grammar level that DECLARES item
 * sources. Structure (sections, requested counts) derives from the package
 * declaration alone — deliverability (validation records) never changes a
 * blueprint's identity, so a checkpoint's denominator does not move when
 * validation runs; the assembled instance reports actual availability.
 */
export function deriveMockBlueprints(
  language: string,
  languageData: LanguageData,
): MockBlueprint[] {
  const bank = questionBankFromLanguageData(language, languageData);
  const levels = new Map<number, string[]>(); // level → declared patterns (package order)
  for (const point of languageData.grammar ?? []) {
    if (typeof point.level !== 'number' || typeof point.pattern !== 'string') continue;
    if ((bank.itemsByPattern.get(point.pattern)?.length ?? 0) === 0) continue;
    const list = levels.get(point.level) ?? [];
    if (!list.includes(point.pattern)) list.push(point.pattern);
    levels.set(point.level, list);
  }
  const blueprints: MockBlueprint[] = [];
  for (const [level, patterns] of levels) {
    // Sections: one per package-declared category, in first-declaration
    // order; patterns without a category share one section. A section's
    // requested draw is one item per declared family, capped.
    const byCategory = new Map<string | undefined, string[]>();
    for (const pattern of patterns) {
      const point = (languageData.grammar ?? []).find((candidate) => candidate.pattern === pattern);
      const category = point?.category;
      const list = byCategory.get(category) ?? [];
      if (!list.includes(pattern)) list.push(pattern);
      byCategory.set(category, list);
    }
    const sections: MockSectionPlan[] = [];
    for (const [category, categoryPatterns] of byCategory) {
      if (categoryPatterns.length === 0) continue;
      sections.push({
        id: `${mockBlueprintId(language, level)}#${category === undefined ? 'constructions' : `cat:${category}`}`,
        ...(category !== undefined ? { category } : {}),
        patterns: categoryPatterns,
        requestedCount: Math.min(categoryPatterns.length, MOCK_MAX_REQUESTED_PER_SECTION),
      });
    }
    if (sections.length === 0) continue;
    const blueprint: MockBlueprint = {
      id: mockBlueprintId(language, level),
      language,
      version: blueprintVersion(language, level, sections, languageData.languageData?.version),
      ...(languageData.languageData?.version !== undefined ? { contentVersion: languageData.languageData.version } : {}),
      level,
      levelLabel: grammarLevelName(level, languageData),
      provider: 'mlearn-derived',
      scope: 'grammar-contrast',
      timing: {
        perItemSeconds: MOCK_PER_ITEM_SECONDS,
        pauses: 'allowed-and-recorded',
        timeout: 'unanswered-not-scored',
      },
      assistance: { policy: 'closed-book' },
      sections,
    };
    blueprints.push(blueprint);
  }
  // Package scale order: easiest level first.
  return blueprints.sort((a, b) => a.level - b.level);
}

export const mockBlueprintId = (language: string, level: number): string => `mlearn-mock:${language}:${level}`;

/** Stable structure+content version (change detection, FNV-1a 32-bit). */
function blueprintVersion(
  language: string,
  level: number,
  sections: readonly MockSectionPlan[],
  contentVersion: string | undefined,
): string {
  const canonical = JSON.stringify({
    id: mockBlueprintId(language, level),
    sections: sections.map((section) => ({
      id: section.id,
      category: section.category ?? null,
      patterns: [...section.patterns],
      requestedCount: section.requestedCount,
    })),
    contentVersion: contentVersion ?? null,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `mock-blueprint-v1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Instance assembly (held-out first — R13/G02)
// ---------------------------------------------------------------------------

export interface MockStepPlan {
  sectionId: string;
  pattern: string;
  level: number;
  /** The item's DECLARED delivery format (package-owned; absent = MCQ). */
  mode: 'mcq' | 'typed';
  source: GrammarPracticeItemSource;
  item: QuestionItem;
}

export interface MockSectionInstance {
  section: MockSectionPlan;
  requestedCount: number;
  /** Deliverable items actually assembled (may be fewer — reported, never padded). */
  steps: readonly MockStepPlan[];
  /** Items served from a HELD-OUT FAMILY (contrast group with no recorded attempt). */
  freshFamilyCount: number;
  /** Items backfilled from rehearsed families — counted and surfaced, never silent. */
  rehearsedFamilyCount: number;
}

export interface MockInstance {
  blueprint: MockBlueprint;
  seed: number;
  /** Flat steps in section order — the FIXED queue. */
  steps: readonly MockStepPlan[];
  sections: readonly MockSectionInstance[];
  assembledAt: number;
}

function declaredMockMode(source: GrammarPracticeItemSource): 'mcq' | 'typed' {
  const formats: readonly ('mcq' | 'typed')[] = source.formats === undefined ? ['mcq'] : [...new Set(source.formats)];
  return formats[0] ?? 'mcq';
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const order = [...values];
  const rng = createSeededRng(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

/**
 * Assembles one mock instance. Deterministic: the same (blueprint, bank,
 * eventLog, seed) always yields the same instance.
 *
 * Held-out FAMILIES (R13/G02): the family is the contrast group — the
 * pattern. A pattern with ANY recorded item attempt is rehearsed material:
 * serving its unattempted sibling item would still re-test an already
 * tested discrimination, so families, not items, classify held-out. Per
 * section, candidates from fresh families are served first (seeded
 * shuffle); rehearsed families only backfill a shortfall, preferring that
 * family's LEAST-attempted items (stable seeded order on ties), and every
 * backfilled item is counted and surfaced in the results. The queue never
 * depends on anything that changes mid-session (G01): the eventLog is a
 * snapshot.
 */
export function assembleMockInstance(
  blueprint: MockBlueprint,
  bank: LanguageQuestionBank,
  eventLog: KnowledgeEventLog,
  seed: number,
  now: number = Date.now(),
): MockInstance {
  const attemptCounts = itemAttemptCounts(eventLog);
  const steps: MockStepPlan[] = [];
  const sections: MockSectionInstance[] = [];
  for (const section of blueprint.sections) {
    const candidates: Array<{ source: GrammarPracticeItemSource; item: QuestionItem; pattern: string }> = [];
    for (const pattern of section.patterns) {
      for (const source of itemsForPattern(bank, pattern)) {
        const item = assembleContrastItem(source, {
          language: bank.language,
          pattern,
          contentVersion: bank.contentVersion,
        });
        if (isDeliverableItem(item)) candidates.push({ source, item, pattern });
      }
    }
    // Family classification: a family (contrast group = pattern) is
    // rehearsed when ANY of its candidates carries a recorded attempt;
    // otherwise it is held-out.
    const familyRehearsed = new Map<string, boolean>();
    for (const candidate of candidates) {
      const rehearsed = (attemptCounts.get(candidate.item.id) ?? 0) !== 0;
      if (rehearsed || !familyRehearsed.has(candidate.pattern)) familyRehearsed.set(candidate.pattern, rehearsed);
    }
    // A mock draws at most one item from each family. Otherwise a sibling
    // shown later in the same mock would be mislabeled as fresh even though
    // the family had already been exercised earlier in that fixed queue.
    const representatives = [...familyRehearsed.entries()].map(([pattern, rehearsed]) => {
      const family = seededShuffle(
        candidates.filter((candidate) => candidate.pattern === pattern),
        seed ^ sectionHash(section.id) ^ sectionHash(pattern),
      ).sort((a, b) => (attemptCounts.get(a.item.id) ?? 0) - (attemptCounts.get(b.item.id) ?? 0));
      return { candidate: family[0], rehearsed };
    }).filter((entry): entry is { candidate: { source: GrammarPracticeItemSource; item: QuestionItem; pattern: string }; rehearsed: boolean } => entry.candidate !== undefined);
    const freshFamily = representatives.filter((entry) => !entry.rehearsed).map((entry) => entry.candidate);
    const rehearsedFamily = representatives.filter((entry) => entry.rehearsed).map((entry) => entry.candidate);
    const chosen = [
      ...seededShuffle(freshFamily, seed ^ sectionHash(section.id)),
      ...seededShuffle(rehearsedFamily, (seed ^ sectionHash(section.id)) + 1)
        // Least-attempted first inside rehearsed families; the stable sort
        // keeps the seeded order as the deterministic tiebreak.
        .sort((a, b) => (attemptCounts.get(a.item.id) ?? 0) - (attemptCounts.get(b.item.id) ?? 0)),
    ].slice(0, section.requestedCount);
    const sectionSteps: MockStepPlan[] = chosen.map(({ source, item, pattern }) => ({
      sectionId: section.id,
      pattern,
      level: blueprint.level,
      mode: declaredMockMode(source),
      source,
      item,
    }));
    steps.push(...sectionSteps);
    const freshCount = new Set(sectionSteps.filter((step) => familyRehearsed.get(step.pattern) === false).map((step) => step.pattern)).size;
    sections.push({
      section,
      requestedCount: section.requestedCount,
      steps: sectionSteps,
      freshFamilyCount: freshCount,
      rehearsedFamilyCount: sectionSteps.length - freshCount,
    });
  }
  return { blueprint, seed, steps, sections, assembledAt: now };
}

function sectionHash(sectionId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sectionId.length; index += 1) {
    hash ^= sectionId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------
// Session state machine (G01 / R13)
// ---------------------------------------------------------------------------

export interface MockAnswerRecord {
  stepIndex: number;
  correct: boolean;
  timedOut: boolean;
  mode: 'mcq' | 'typed';
  chosenSpan?: string;
  /** Canonical attempt id from the journal writer (absent for timeouts — no event written). */
  attemptId?: AttemptId;
  /** Stable id reserved before the journal call; survives an interrupted
   * response so the same append can be reconciled idempotently on restart. */
  pendingAttemptId?: AttemptId;
  answeredAt: number;
  /** Wall-clock presentation → submission. */
  latencyMs: number;
  /** Presentation → submission minus explicit pauses (declared mock timing). */
  activeLatencyMs: number;
  /** Explicit pauses that overlapped this step. */
  pauseCount: number;
  scaffolds?: AttemptScaffolds;
}

export interface MockPause { start: number; end?: number }

export interface MockSessionState {
  /** Stable session identity, persisted with the state (G01). */
  sessionId: string;
  instance: MockInstance;
  cursor: number;
  startedAt: number;
  /** Wall time the CURRENT step was presented (0 before start / after finish). */
  stepStartedAt: number;
  pauses: readonly MockPause[];
  answers: readonly MockAnswerRecord[];
  finishedAt?: number;
  abandoned?: boolean;
}

/**
 * One response envelope. `stepIndex` names the step the response is FOR:
 * the reducer applies a submission ONLY to the presented step, so a
 * replayed/stale response for an earlier step (double click, cross-tab
 * echo, retried write) can never advance the queue (G01).
 */
export type MockSubmission =
  | { kind: 'mcq'; index: number; stepIndex?: number }
  | { kind: 'typed'; value: string; suppliedBy?: 'keyboard' | 'ime' | 'speech'; stepIndex?: number }
  | { kind: 'timeout'; stepIndex?: number };

export interface MockGradedSubmission {
  correct: boolean;
  quality: AttemptQuality;
  chosenSpan?: string;
  scaffolds?: AttemptScaffolds;
}

/**
 * Conservative grading (R13): re-derives gold from the item source at submit
 * time and maps a correct answer to `struggled` — one successful MCQ attempt
 * is not automatic proof of full objective mastery — and a wrong answer to
 * `missed`. Typed input supplies device provenance (G05), never an error.
 */
export function gradeMockSubmission(step: MockStepPlan, submission: MockSubmission): MockGradedSubmission | null {
  if (submission.kind === 'timeout') return null;
  const result = gradeContrastAnswer(step.item, step.source, submission);
  const scaffolds = submission.kind === 'typed'
    ? (result.scaffolds as AttemptScaffolds | undefined)
    : undefined;
  return {
    correct: result.correct,
    quality: result.correct ? 'struggled' : 'missed',
    ...(result.chosenSpan !== undefined ? { chosenSpan: result.chosenSpan } : {}),
    ...(scaffolds !== undefined ? { scaffolds } : {}),
  };
}

/** Stable per-session identity: blueprint, seed and start bind one session (G01). */
const mockSessionId = (instance: MockInstance, startedAt: number): string =>
  `${instance.blueprint.id}#${instance.seed}#${startedAt}`;

export function startMockSession(instance: MockInstance, now: number = Date.now()): MockSessionState {
  return {
    sessionId: mockSessionId(instance, now),
    instance,
    cursor: 0,
    startedAt: now,
    stepStartedAt: instance.steps.length > 0 ? now : 0,
    pauses: [],
    answers: [],
  };
}

/** The step currently presented, or null when the session is over. */
export function presentedMockStep(state: MockSessionState): MockStepPlan | null {
  if (state.finishedAt !== undefined || state.abandoned === true) return null;
  return state.instance.steps[state.cursor] ?? null;
}

/** True between pause() and resume() — the clock is stopped. */
export function isMockPaused(state: MockSessionState): boolean {
  const last = state.pauses[state.pauses.length - 1];
  return last !== undefined && last.end === undefined;
}

/** Active (unpaused) elapsed time of one step window, in ms. */
function activeMs(state: MockSessionState, from: number, to: number): number {
  let paused = 0;
  for (const pause of state.pauses) {
    const end = pause.end ?? to;
    const overlap = Math.min(end, to) - Math.max(pause.start, from);
    if (overlap > 0) paused += overlap;
  }
  return Math.max(0, to - from - paused);
}

/** Active elapsed ms on the CURRENT step, respecting declared pause rules. */
export function activeStepMs(state: MockSessionState, now: number = Date.now()): number {
  const step = presentedMockStep(state);
  if (step === null || state.stepStartedAt <= 0) return 0;
  return activeMs(state, state.stepStartedAt, now);
}

/** Declared timing enforcement: the step budget counts ACTIVE time only. */
export function isMockStepTimedOut(state: MockSessionState, now: number = Date.now()): boolean {
  const step = presentedMockStep(state);
  if (step === null) return false;
  return activeStepMs(state, now) > state.instance.blueprint.timing.perItemSeconds * 1000;
}

/** Total active session time and explicit pause totals (provenance for results). */
export function mockSessionTiming(state: MockSessionState, now: number = Date.now()): { activeMs: number; pausedMs: number; pauseCount: number } {
  const to = state.finishedAt ?? now;
  let paused = 0;
  for (const pause of state.pauses) {
    const end = pause.end ?? to;
    paused += Math.max(0, end - pause.start);
  }
  return { activeMs: Math.max(0, to - state.startedAt - paused), pausedMs: paused, pauseCount: state.pauses.length };
}

/**
 * Explicit pause (R13: pause/help modifications are explicit). Recorded and
 * excluded from the declared clock. No-ops when already paused or finished.
 */
export function pauseMockSession(state: MockSessionState, now: number = Date.now()): MockSessionState {
  if (state.finishedAt !== undefined || state.abandoned === true || isMockPaused(state)) return state;
  return { ...state, pauses: [...state.pauses, { start: now }] };
}

export function resumeMockSession(state: MockSessionState, now: number = Date.now()): MockSessionState {
  if (!isMockPaused(state)) return state;
  const pauses = [...state.pauses];
  const last = pauses[pauses.length - 1];
  pauses[pauses.length - 1] = { start: last.start, end: now };
  return { ...state, pauses };
}

export interface MockJournalPayload {
  pattern: string;
  level: number;
  quality: AttemptQuality;
  scaffolds?: AttemptScaffolds;
  itemRef: { id: string; version: string; seed?: number };
  validationRef: NonNullable<KnowledgeEvent['validationRef']>;
  taskType: string;
  timing: { wallLatencyMs: number; activeLatencyMs: number; interruptionCount: number; interrupted: boolean; stalled: false };
}

/** The journal write the CURRENT step's submission produces (caller executes it). */
export function mockAttemptPayload(state: MockSessionState, submission: MockSubmission, now: number = Date.now()): MockJournalPayload | null {
  const step = presentedMockStep(state);
  if (step === null) return null;
  // Same declared-budget cutoff as applyMockAnswer: no payload is derived
  // for a step whose ACTIVE budget is already exhausted.
  if (submission.kind !== 'timeout' && isMockStepTimedOut(state, now)) return null;
  const graded = gradeMockSubmission(step, submission);
  if (graded === null) return null;
  const semantic = step.item.validation.semantic!;
  const wall = Math.max(0, now - state.stepStartedAt);
  const active = activeStepMs(state, now);
  const stepPauses = state.pauses.filter((pause) => pause.start >= state.stepStartedAt || (pause.end ?? now) > state.stepStartedAt).length;
  return {
    pattern: step.pattern,
    level: step.level,
    quality: graded.quality,
    ...(graded.scaffolds !== undefined ? { scaffolds: graded.scaffolds } : {}),
    itemRef: { id: step.item.id, version: step.item.version, seed: step.item.seed },
    validationRef: {
      validator: semantic.validator,
      ...(semantic.validatorVersion !== undefined ? { validatorVersion: semantic.validatorVersion } : {}),
      at: semantic.at,
      contentHash: semantic.contentHash,
    },
    // Mock provenance: a checkpoint attempt is a DIFFERENT task context than
    // a practice attempt — the journal must be able to tell them apart.
    taskType: step.mode === 'typed' ? 'mock-typed' : 'mock-contrast',
    timing: { wallLatencyMs: wall, activeLatencyMs: active, interruptionCount: stepPauses, interrupted: stepPauses > 0, stalled: false },
  };
}

/**
 * Applies ONE submission to the CURRENT step (G01). Integrity guards, all
 * no-op returns (never a replan, never a half-advance):
 * - finished/abandoned sessions accept nothing;
 * - a submission whose `stepIndex` envelope names any step other than the
 *   presented one is stale (double click, cross-tab echo, retried write)
 *   and is ignored;
 * - an attemptId already recorded is a replayed journal write and is
 *   ignored — one attempt id can never record evidence twice;
 * - a real (non-timeout) submission whose ACTIVE time has already overrun
 *   the declared per-item budget is late (throttled tick, backlog click) and
 *   is ignored — only the declared timeout records the step unanswered;
 * - a real (non-timeout) submission without the attempt id the canonical
 *   writer returned is rejected — no silent evidence;
 * - timeouts record no attempt id (declared: unanswered is not scored).
 */
export function applyMockAnswer(
  state: MockSessionState,
  submission: MockSubmission,
  attemptId: AttemptId | undefined,
  now: number = Date.now(),
): MockSessionState {
  if (state.finishedAt !== undefined || state.abandoned === true) return state;
  const step = state.instance.steps[state.cursor];
  if (step === undefined) return state;
  if (submission.stepIndex !== undefined && submission.stepIndex !== state.cursor) return state;
  if (attemptId !== undefined && state.answers.some((answer) => answer.attemptId === attemptId)) return state;
  // Declared budget is a hard cutoff: the overrun is strict, so an answer
  // landing exactly at the budget still counts.
  if (submission.kind !== 'timeout' && isMockStepTimedOut(state, now)) return state;
  const timedOut = submission.kind === 'timeout';
  const graded = timedOut ? null : gradeMockSubmission(step, submission);
  if (!timedOut && graded === null) return state;
  if (!timedOut && attemptId === undefined) return state;
  const wall = Math.max(0, now - state.stepStartedAt);
  const active = activeStepMs(state, now);
  const stepPauses = state.pauses.filter((pause) => pause.start >= state.stepStartedAt || (pause.end ?? now) > state.stepStartedAt).length;
  const record: MockAnswerRecord = {
    stepIndex: state.cursor,
    correct: timedOut ? false : graded!.correct,
    timedOut,
    mode: step.mode,
    ...(graded?.chosenSpan !== undefined ? { chosenSpan: graded.chosenSpan } : {}),
    ...(attemptId !== undefined ? { attemptId } : {}),
    answeredAt: now,
    latencyMs: wall,
    activeLatencyMs: active,
    pauseCount: stepPauses,
    ...(graded?.scaffolds !== undefined ? { scaffolds: graded.scaffolds } : {}),
  };
  const nextCursor = state.cursor + 1;
  return {
    ...state,
    cursor: nextCursor,
    answers: [...state.answers, record],
    stepStartedAt: nextCursor >= state.instance.steps.length ? 0 : now,
    finishedAt: nextCursor >= state.instance.steps.length ? now : undefined,
  };
}

/**
 * Durable-FIRST staging of ONE real submission (G01, PlacementSession
 * `stageDraw` contract): advances the cursor and records the graded answer
 * WITHOUT a journal attempt id — the staged record is a durable cursor
 * reservation, not yet evidence. The canonical writer may be invoked only
 * AFTER this staged state was persisted successfully; the returned attempt
 * id is then bound with `bindMockAttempt`. The staged record carries a stable
 * pending id and terminal stages remain stored, so an interrupted journal
 * response can be retried idempotently after restart. A FAILED staged persist
 * must lead the caller to refuse the submission entirely — no evidence
 * without a cursor. Timeouts never stage (they record no evidence and keep
 * the plain reducer path). Guards mirror `applyMockAnswer`; refusal returns null.
 */
export function stageMockAnswer(
  state: MockSessionState,
  submission: MockSubmission,
  now: number = Date.now(),
): MockSessionState | null {
  if (state.finishedAt !== undefined || state.abandoned === true) return null;
  if (submission.kind === 'timeout') return null;
  const step = state.instance.steps[state.cursor];
  if (step === undefined) return null;
  if (submission.stepIndex !== undefined && submission.stepIndex !== state.cursor) return null;
  // Same declared-budget cutoff as applyMockAnswer: staging an answer the
  // reducer would refuse would publish a cursor the evidence cannot follow.
  if (isMockStepTimedOut(state, now)) return null;
  const graded = gradeMockSubmission(step, submission);
  if (graded === null) return null;
  const wall = Math.max(0, now - state.stepStartedAt);
  const active = activeStepMs(state, now);
  const stepPauses = state.pauses.filter((pause) => pause.start >= state.stepStartedAt || (pause.end ?? now) > state.stepStartedAt).length;
  const record: MockAnswerRecord = {
    stepIndex: state.cursor,
    correct: graded.correct,
    timedOut: false,
    mode: step.mode,
    ...(graded.chosenSpan !== undefined ? { chosenSpan: graded.chosenSpan } : {}),
    answeredAt: now,
    latencyMs: wall,
    activeLatencyMs: active,
    pauseCount: stepPauses,
    pendingAttemptId: nextAttemptId(),
    ...(graded.scaffolds !== undefined ? { scaffolds: graded.scaffolds } : {}),
  };
  const nextCursor = state.cursor + 1;
  return {
    ...state,
    cursor: nextCursor,
    answers: [...state.answers, record],
    stepStartedAt: nextCursor >= state.instance.steps.length ? 0 : now,
    finishedAt: nextCursor >= state.instance.steps.length ? now : undefined,
  };
}

/**
 * Binds the canonical writer's attempt id to the staged record (the
 * durable-first contract's second phase). The staged record is the LAST one
 * (its stepIndex is cursor - 1) and still unbound; anything else returns
 * the state unchanged (defensive — no invented binding, G01). Binding never
 * moves the cursor. The attempt id remains absent when the process died
 * between the staged persist and the bind: the durable answer stands, only
 * its stable pending id remains recoverable for journal reconciliation.
 */
export function bindMockAttempt(state: MockSessionState, attemptId: AttemptId): MockSessionState {
  const last = state.answers[state.answers.length - 1];
  // A staged record is a real, non-timeout answer: binding onto a timeout
  // record (unbound by declaration) or a foreign step would invent evidence.
  if (
    last === undefined
    || last.attemptId !== undefined
    || last.pendingAttemptId !== attemptId
    || last.timedOut
    || last.stepIndex !== state.cursor - 1
  ) return state;
  const answers = state.answers.slice(0, -1);
  answers.push({ ...last, attemptId, pendingAttemptId: undefined });
  return { ...state, answers };
}

/** Rebuilds the exact journal payload for a durable pending answer. */
export function pendingMockAttempt(state: MockSessionState): { attemptId: AttemptId; payload: MockJournalPayload } | null {
  const answer = state.answers[state.answers.length - 1];
  if (answer?.pendingAttemptId === undefined || answer.timedOut) return null;
  const step = state.instance.steps[answer.stepIndex];
  const semantic = step?.item.validation.semantic;
  if (step === undefined || semantic === undefined) return null;
  return {
    attemptId: answer.pendingAttemptId,
    payload: {
      pattern: step.pattern,
      level: step.level,
      quality: answer.correct ? 'struggled' : 'missed',
      ...(answer.scaffolds !== undefined ? { scaffolds: answer.scaffolds } : {}),
      itemRef: { id: step.item.id, version: step.item.version, seed: step.item.seed },
      validationRef: {
        validator: semantic.validator,
        ...(semantic.validatorVersion !== undefined ? { validatorVersion: semantic.validatorVersion } : {}),
        at: semantic.at,
        contentHash: semantic.contentHash,
      },
      taskType: step.mode === 'typed' ? 'mock-typed' : 'mock-contrast',
      timing: {
        wallLatencyMs: answer.latencyMs,
        activeLatencyMs: answer.activeLatencyMs,
        interruptionCount: answer.pauseCount,
        interrupted: answer.pauseCount > 0,
        stalled: false,
      },
    },
  };
}

/** Abandoning is non-epistemic (G04): answered attempts stand, unanswered stay unanswered. */
export function abandonMockSession(state: MockSessionState): MockSessionState {
  if (state.finishedAt !== undefined || state.abandoned === true) return state;
  return { ...state, abandoned: true, stepStartedAt: 0 };
}

// ---------------------------------------------------------------------------
// Results (provenance, not scores)
// ---------------------------------------------------------------------------

export interface MockSectionResult {
  sectionId: string;
  category?: string;
  requestedCount: number;
  assembledCount: number;
  answered: number;
  correct: number;
  timedOut: number;
  /** Items served from held-out families (contrast groups with no recorded attempt). */
  freshFamilyCount: number;
  /** Items backfilled from rehearsed families (surfaced, never silent). */
  rehearsedFamilyCount: number;
}

export interface MockResults {
  blueprintId: string;
  blueprintVersion: string;
  language: string;
  level: number;
  levelLabel: string;
  seed: number;
  contentVersion?: string;
  startedAt: number;
  finishedAt?: number;
  abandoned: boolean;
  totalAnswered: number;
  totalCorrect: number;
  totalTimedOut: number;
  freshFamilyCount: number;
  rehearsedFamilyCount: number;
  activeMs: number;
  pausedMs: number;
  pauseCount: number;
  sections: readonly MockSectionResult[];
  /** Per-pattern outcomes — the repair view feeds the SAME TeachingPolicy. */
  patterns: ReadonlyArray<{ pattern: string; attempted: number; correct: number; missed: number }>;
  /** True when any section could not assemble its declared draw (honest gap, G04). */
  availabilityGap: boolean;
}

export function summarizeMockResults(state: MockSessionState): MockResults {
  const instance = state.instance;
  const timing = mockSessionTiming(state);
  const sections: MockSectionResult[] = instance.sections.map((section) => {
    const sectionAnswers = state.answers.filter((answer) => instance.steps[answer.stepIndex]?.sectionId === section.section.id);
    const answered = sectionAnswers.filter((answer) => !answer.timedOut);
    return {
      sectionId: section.section.id,
      ...(section.section.category !== undefined ? { category: section.section.category } : {}),
      requestedCount: section.requestedCount,
      assembledCount: section.steps.length,
      answered: answered.length,
      correct: answered.filter((answer) => answer.correct).length,
      timedOut: sectionAnswers.filter((answer) => answer.timedOut).length,
      freshFamilyCount: section.freshFamilyCount,
      rehearsedFamilyCount: section.rehearsedFamilyCount,
    };
  });
  const patternTotals = new Map<string, { attempted: number; correct: number; missed: number }>();
  for (const step of instance.steps) {
    patternTotals.set(step.pattern, patternTotals.get(step.pattern) ?? { attempted: 0, correct: 0, missed: 0 });
  }
  for (const answer of state.answers) {
    const step = instance.steps[answer.stepIndex];
    if (step === undefined || answer.timedOut) continue;
    const totals = patternTotals.get(step.pattern) ?? { attempted: 0, correct: 0, missed: 0 };
    totals.attempted += 1;
    if (answer.correct) totals.correct += 1;
    else totals.missed += 1;
    patternTotals.set(step.pattern, totals);
  }
  const results: MockResults = {
    blueprintId: instance.blueprint.id,
    blueprintVersion: instance.blueprint.version,
    language: instance.blueprint.language,
    level: instance.blueprint.level,
    levelLabel: instance.blueprint.levelLabel,
    seed: instance.seed,
    ...(instance.blueprint.contentVersion !== undefined ? { contentVersion: instance.blueprint.contentVersion } : {}),
    startedAt: state.startedAt,
    ...(state.finishedAt !== undefined ? { finishedAt: state.finishedAt } : {}),
    abandoned: state.abandoned === true,
    totalAnswered: state.answers.filter((answer) => !answer.timedOut).length,
    totalCorrect: state.answers.filter((answer) => answer.correct && !answer.timedOut).length,
    totalTimedOut: state.answers.filter((answer) => answer.timedOut).length,
    freshFamilyCount: instance.sections.reduce((total, section) => total + section.freshFamilyCount, 0),
    rehearsedFamilyCount: instance.sections.reduce((total, section) => total + section.rehearsedFamilyCount, 0),
    activeMs: timing.activeMs,
    pausedMs: timing.pausedMs,
    pauseCount: timing.pauseCount,
    sections,
    patterns: [...patternTotals.entries()].map(([pattern, totals]) => ({ pattern, ...totals })),
    availabilityGap: instance.sections.some((section) => section.steps.length < section.requestedCount),
  };
  return results;
}

/** Patterns with at least one wrong (non-timeout) answer — the repair set. */
export function mockMissedPatterns(state: MockSessionState): readonly { pattern: string; missed: number }[] {
  return summarizeMockResults(state).patterns
    .filter((row) => row.missed > 0)
    .map((row) => ({ pattern: row.pattern, missed: row.missed }));
}

// ---------------------------------------------------------------------------
// Persistence: in-progress resume (G01) + bounded finished summaries
// ---------------------------------------------------------------------------

const sessionHeartbeatStorageKey = (language: string): string => `mlearn-mock-session-heartbeat:${language}`;
const summaryStorageKey = (language: string): string => `mlearn-mock-results:${language}`;
const pendingResultsStorageKey = (language: string): string => `mlearn-mock-pending-results:${language}`;

/** Durable in-progress session key. Exported for the surface's cross-window
 *  storage arbitration (the window listens for OTHER windows' session
 *  writes; PlacementSession's `storage`-listener convention). */
export const mockSessionStorageKey = (language: string): string => `mlearn-mock-session:${language}`;
const sessionStorageKey = mockSessionStorageKey;

function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined {
  return globalThis.localStorage;
}

/**
 * Persists the durable in-progress session (or removes it at terminal
 * states). Returns whether the durable write succeeded: callers MUST treat
 * `false` as "cursor not durable" and refuse evidence writes (the
 * PlacementSession `persistTo` contract — no evidence without a cursor,
 * G01). Removal is part of the same contract; a failed removal is reported
 * the same way (the terminal bookkeeping treats a leftover entry as
 * best-effort cleanup, mirroring PlacementSession's terminal policy).
 */
export function saveStoredMockSession(language: string, state: MockSessionState | null, now: number = Date.now()): boolean {
  const store = storage();
  if (store === undefined) return false;
  try {
    if (state === null || (state.finishedAt !== undefined && pendingMockAttempt(state) === null) || state.abandoned === true) {
      store.removeItem(sessionStorageKey(language));
      store.removeItem(sessionHeartbeatStorageKey(language));
    } else {
      store.setItem(sessionStorageKey(language), JSON.stringify({ ...state, persistedAt: now }));
      touchStoredMockSession(language, state, now);
    }
    return true;
  } catch {
    // Storage unavailable/quota: the caller must refuse evidence, not
    // silently run a session whose cursor cannot be kept (G01/G04).
    return false;
  }
}

/** Lightweight active-clock checkpoint; avoids rewriting the fixed instance on every tick. */
export function touchStoredMockSession(language: string, state: MockSessionState, now: number = Date.now()): void {
  try {
    storage()?.setItem(sessionHeartbeatStorageKey(language), JSON.stringify({ sessionId: state.sessionId, activeAt: now }));
  } catch {
    // The full persisted state remains the conservative fallback boundary.
  }
}

/**
 * Reassembles the durable in-progress session against the CURRENT package
 * WITHOUT persisting or inferring anything: the blueprint identity must
 * still derive at the same version, and every queued item must still be
 * declared, content-identical and deliverable. Anything else is discarded —
 * a retired or changed item can never silently resume, and no replan
 * substitutes steps (G01/G03).
 *
 * Returns the raw durable content (`persistedAt` carried through). Callers
 * decide what happens around it: `loadStoredMockSession` adds the offline
 * interruption pause and makes the restore durable; the cross-window
 * adoption path uses this raw form so an adoption can never write back and
 * ping-pong storage events between windows.
 */
export function rebuildStoredMockSession(
  language: string,
  languageData: LanguageData,
): (MockSessionState & { persistedAt: number }) | null {
  try {
    const raw = storage()?.getItem(sessionStorageKey(language));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockSessionState & { persistedAt: number };
    if (
      typeof parsed?.startedAt !== 'number'
      || !Number.isInteger(parsed.cursor) || parsed.cursor < 0
      || !Array.isArray(parsed.pauses)
      || !Array.isArray(parsed.answers)
      || typeof parsed.persistedAt !== 'number'
      || (parsed.finishedAt !== undefined && pendingMockAttempt(parsed) === null)
      || parsed.abandoned === true
      || parsed.instance?.blueprint?.language !== language
    ) return null;
    const derived = deriveMockBlueprints(language, languageData).find((blueprint) => blueprint.id === parsed.instance.blueprint.id);
    if (derived === undefined || derived.version !== parsed.instance.blueprint.version) return null;
    const bank = questionBankFromLanguageData(language, languageData);
    // Re-derive every step's item bytes from the CURRENT package; a stored
    // item that no longer assembles identically invalidates the whole session.
    const steps: MockStepPlan[] = parsed.instance.steps.map((step) => {
      const source = itemsForPattern(bank, step.pattern).find((candidate) => candidate.id === step.item.id);
      if (source === undefined) throw new Error('stored step item retired');
      const item = assembleContrastItem(source, { language, pattern: step.pattern, contentVersion: bank.contentVersion });
      if (item.version !== step.item.version || !isDeliverableItem(item)) throw new Error('stored step item changed');
      return { ...step, source, item };
    });
    const sections = parsed.instance.sections.map((section) => ({
      ...section,
      section: derived.sections.find((candidate) => candidate.id === section.section.id) ?? (() => { throw new Error('stored section retired'); })(),
      steps: steps.filter((step) => step.sectionId === section.section.id),
    }));
    const instance: MockInstance = { ...parsed.instance, blueprint: derived, steps, sections };
    const rebuilt: MockSessionState & { persistedAt: number } = {
      ...parsed,
      instance,
      cursor: Math.min(parsed.cursor, instance.steps.length),
      answers: parsed.answers.filter((answer) => typeof answer?.stepIndex === 'number' && answer.stepIndex < instance.steps.length),
    };
    if (rebuilt.cursor > instance.steps.length || (rebuilt.cursor === instance.steps.length && pendingMockAttempt(rebuilt) === null)) return null;
    return rebuilt;
  } catch {
    return null;
  }
}

/**
 * Restores an in-progress session. The stored instance is revalidated
 * against the CURRENT package (see `rebuildStoredMockSession`); the wall
 * time since the last durable checkpoint closes as an explicit interruption
 * pause, so a restored step keeps its full declared active window. The
 * restored state is persisted back immediately — without this checkpoint a
 * second reload before the next interaction would rebuild from the older
 * snapshot and count the first interruption as active time.
 */
export function loadStoredMockSession(
  language: string,
  languageData: LanguageData,
  now: number = Date.now(),
): MockSessionState | null {
  try {
    const rebuilt = rebuildStoredMockSession(language, languageData);
    if (rebuilt === null) return null;
    let interruptionStart = rebuilt.persistedAt;
    try {
      const heartbeatRaw = storage()?.getItem(sessionHeartbeatStorageKey(language));
      const heartbeat = heartbeatRaw == null ? null : JSON.parse(heartbeatRaw) as { sessionId?: string; activeAt?: number };
      if (
        heartbeat?.sessionId === rebuilt.sessionId
        && typeof heartbeat.activeAt === 'number'
        && heartbeat.activeAt >= rebuilt.persistedAt
        && heartbeat.activeAt <= now
      ) interruptionStart = heartbeat.activeAt;
    } catch {
      // A missing/malformed heartbeat falls back to the full state's boundary.
    }
    const interruptionPause = !isMockPaused(rebuilt) && now > interruptionStart
      ? [{ start: interruptionStart, end: now }]
      : [];
    const restored: MockSessionState = { ...rebuilt, pauses: [...rebuilt.pauses, ...interruptionPause] };
    saveStoredMockSession(language, restored, now);
    return restored;
  } catch {
    return null;
  }
}

/**
 * Stable identity fingerprint of the DURABLE session content (G01): the
 * fields a cross-window action must still match before it may act. Covers
 * the cursor, the answer count and the FULL pause history — a concurrent
 * window's pause/resume or cursor advance changes the fingerprint, so a
 * stale window's queued action is dropped (or adopted) instead of
 * double-writing evidence or clobbering the shared session.
 */
export function mockSessionFingerprint(state: Pick<MockSessionState, 'sessionId' | 'cursor' | 'startedAt' | 'stepStartedAt' | 'finishedAt' | 'abandoned' | 'answers' | 'pauses'>): string {
  return [
    state.sessionId,
    state.cursor,
    state.startedAt,
    state.stepStartedAt,
    state.finishedAt ?? '-',
    state.abandoned === true ? 'abandoned' : 'live',
    JSON.stringify(state.answers),
    JSON.stringify(state.pauses),
  ].join('|');
}

/** Fingerprint of the in-progress session as currently stored (null when
 *  none is stored). Cross-window actions compare this against the in-memory
 *  fingerprint before acting; a corrupt entry behaves like an absent one —
 *  the durable copy is untrustworthy, so the action drops and adopts. */
export function storedMockSessionFingerprint(language: string): string | null {
  try {
    const raw = storage()?.getItem(sessionStorageKey(language));
    if (!raw) return null;
    return mockSessionFingerprint(JSON.parse(raw) as MockSessionState);
  } catch {
    return null;
  }
}

export function saveMockSummary(language: string, results: MockResults): void {
  try {
    const existing = loadMockSummaries(language);
    const next = [results, ...existing].slice(0, MOCK_SUMMARY_LIMIT);
    storage()?.setItem(summaryStorageKey(language), JSON.stringify(next));
  } catch {
    // Storage unavailable: history is simply not shown.
  }
}

/**
 * Detailed results remain pending until the learner explicitly closes them.
 * Level Study temporarily unmounts this surface while canonical projections
 * refresh after an attempt, so component memory alone cannot own the result.
 */
export function savePendingMockResults(language: string, results: MockResults | null): void {
  try {
    if (results === null) storage()?.removeItem(pendingResultsStorageKey(language));
    else storage()?.setItem(pendingResultsStorageKey(language), JSON.stringify(results));
  } catch {
    // Storage unavailable: the current mounted view remains usable.
  }
}

export function loadPendingMockResults(language: string): MockResults | null {
  try {
    const raw = storage()?.getItem(pendingResultsStorageKey(language));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockResults;
    return parsed !== null
      && typeof parsed === 'object'
      && parsed.language === language
      && typeof parsed.blueprintId === 'string'
      && typeof parsed.startedAt === 'number'
      && Array.isArray(parsed.sections)
      && Array.isArray(parsed.patterns)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function loadMockSummaries(language: string): MockResults[] {
  try {
    const raw = storage()?.getItem(summaryStorageKey(language));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MockResults =>
      entry !== null && typeof entry === 'object'
      && typeof (entry as MockResults).blueprintId === 'string'
      && typeof (entry as MockResults).startedAt === 'number'
      && Array.isArray((entry as MockResults).sections));
  } catch {
    return [];
  }
}
