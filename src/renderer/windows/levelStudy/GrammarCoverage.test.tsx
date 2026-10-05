// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { GrammarCoverage, type GrammarUndoLifecycle } from './GrammarCoverage';
import { itemContentVersion } from '../../learning/questionBank';
import { loadQuestionValidationRecords } from '../../learning/questionValidation';
import { MAX_UNDO_STACK_SIZE } from '../../learning/undoHistory';
import type { StudySessionLocks } from '../../learning/studySessionController';
import type { GrammarItemSemanticValidation, GrammarPracticeItemSource } from '../../../shared/types';
import type { CurriculumComponentSummary } from '../../../shared/curriculum';
import type { AttemptScaffolds, KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import { grammarEvidenceKey, grammarPatternFromEvidenceKey, grammarRecognitionEvidence, replayGrammarRecognition } from '../../../shared/grammar/evidence';
import type { GrammarProjectionMap } from '../../../shared/knowledge/historyQueries';
import type { LanguageData } from '../../../shared/types';
import type { AttemptQuality } from '../../../shared/constants';


// ── The shared durable Undo lifecycle ────────────────────────────
// Modelled on the real protocol: the record is written BEFORE the retraction
// and cleared by completing it, so a window that reloads mid-undo can still
// find and finish it. Tests drive refusals through `retract` exactly as the
// other study surfaces' harnesses do.
import type { PendingRetraction } from '../../../shared/retractionRecovery';
import type { RetractionCompletion, RetractionProjection } from '../../context/FlashcardContext';
type UndoRecord = PendingRetraction;
let pendingRecord: UndoRecord | null = null;
const undoHarness: {
  retract: Mock<(record: UndoRecord, ids: string[]) => Promise<boolean>>;
  record: Mock<(record: UndoRecord) => Promise<boolean>>;
  recover: Mock<() => Promise<void>>;
  projections: Map<string, (record: UndoRecord) => Promise<RetractionProjection>>;
  register: (surface: string, build: (record: UndoRecord) => Promise<RetractionProjection>) => void;
  complete: (record: UndoRecord, build?: (record: UndoRecord) => Promise<RetractionProjection>) => Promise<RetractionCompletion>;
  lifecycle: () => GrammarUndoLifecycle;
} = {
  retract: vi.fn(async (_record: UndoRecord, _ids: string[]): Promise<boolean> => true),
  record: vi.fn(async (record: UndoRecord) => { pendingRecord = record; return true; }),
  recover: vi.fn(async () => {}),
  projections: new Map<string, (record: UndoRecord) => Promise<RetractionProjection>>(),
  register: (surface: string, build: (record: UndoRecord) => Promise<RetractionProjection>) => {
    undoHarness.projections.set(surface, build);
  },
  complete: async (
    record: UndoRecord,
    build?: (record: UndoRecord) => Promise<RetractionProjection>,
  ): Promise<RetractionCompletion> => {
    if (pendingRecord?.attemptId !== record.attemptId) return 'stale';
    if (!await undoHarness.retract(record, record.attemptIds)) return 'retraction-refused';
    const project = build ? await build(record) : undefined;
    void project;
    pendingRecord = null;
    return 'completed';
  },
  lifecycle: () => ({
    record: undoHarness.record,
    complete: undoHarness.complete,
    recover: undoHarness.recover,
    register: undoHarness.register,
  }),
};

let settingsUiLanguage = 'en';
let settingsLlmProvider = 'builtin';

vi.mock('../../context', () => ({
  useLocalization: () => ({ t: (key: string) => key }),
  useSettings: () => ({
    settings: {
      easeThresholdLearning: 1.5,
      easeThresholdKnown: 1.8,
      get uiLanguage() { return settingsUiLanguage; },
      get llmProvider() { return settingsLlmProvider; },
      ratingKeyboardMode: 'mnemonic',
      builtinModel: 'fixture-local-model',
      ollamaModel: '',
    },
  }),
}));

// The question-validation producer (R12) runs through the renderer's unified
// LLM service. Tests never call a real model: this handler is programmable
// per test and defaults to an honest provider failure.
const llmHarness = vi.hoisted(() => ({
  handler: null as null | ((
    messages: readonly unknown[],
    callbacks: { onDone: (value: string) => void; onError: (error: unknown) => void },
  ) => void),
  calls: 0 as number,
}));
vi.mock('../../services/llmProvider', () => ({
  streamChat: (
    messages: readonly unknown[],
    _tools: unknown,
    callbacks: { onDone: (value: string) => void; onError: (error: unknown) => void },
  ) => {
    llmHarness.calls += 1;
    if (llmHarness.handler) llmHarness.handler(messages, callbacks);
    else callbacks.onError(new Error('bridge-unavailable'));
    return { abort: () => {} };
  },
}));

// Package-owned scale fixture (JLPT-style: lower number is harder). Meanings
// exercise the localized-variant contract: `のには` carries en+de variants,
// `ば` a canonical English string only, `たびに` the same via map.
const languageData = {
  language: 'ja',
  grammar: [
    { pattern: 'のに', meaning: 'even though', meanings: { de: 'obwohl (trotzdem)' }, level: 2 },
    { pattern: 'ば', meaning: 'conditional "if"', level: 2 },
    { pattern: 'たびに', meaning: 'every time', meanings: { de: 'jedes Mal' }, level: 3 },
  ],
  grammarLevels: { difficulty: 'lower-is-harder', names: { '2': 'N3', '3': 'N2' } },
} as unknown as LanguageData;

/** Mirrors getGrammarProjections: fold each recognition key into the read model. */
function projectionsOf(language: string, log: KnowledgeEventLog): GrammarProjectionMap {
  const projections: GrammarProjectionMap = {};
  for (const [key, events] of Object.entries(log)) {
    if (grammarPatternFromEvidenceKey(language, key) === null) continue;
    const projection = replayGrammarRecognition(events);
    if (projection) projections[key] = projection;
  }
  return projections;
}

const summary: CurriculumComponentSummary = {
  component: 'grammar',
  buckets: [
    { level: 2, total: 2, known: 0, learning: 0, unknown: 0, unmeasured: 2 },
    { level: 3, total: 1, known: 0, learning: 0, unknown: 0, unmeasured: 1 },
  ],
  total: 3,
  known: 0,
  learning: 0,
  unknown: 0,
  unmeasured: 3,
  complete: false,
};

function storedGrammarSession(
  language: string,
  level: number,
  queue: string[],
  kind: 'self-assess' | 'contrast' = 'self-assess',
  index = 0,
) {
  const denominator = [...queue].sort().join('\u0000');
  return {
    id: 'fixture-session',
    identity: JSON.stringify({ language, level, kind, denominator }),
    queue: queue.map((id) => ({ id })),
    index,
    visited: Array.from({ length: index }, (_, value) => value),
    rated: index,
    revealed: false,
    meta: { level, kind, denominator, ...(kind === 'contrast' ? { mode: 'mcq' } : {}) },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** The presentation beat (GrammarCoverage rate lock) before the next prompt
 *  accepts input; the gesture guards (click detail / key repeat) are the
 *  load-bearing duplicate-submission protection, the beat is secondary. */
const beat = () => new Promise<void>((resolve) => setTimeout(resolve, 170));

/** Pass-through fake lock (shared study-session test convention): single-window
 *  tests exercise the serialized path without changing timing. Tests that
 *  need a lock-less environment pass `null` explicitly. */
const passThroughLocks: StudySessionLocks = {
  request: async (_name: string, callback: () => void) => { await callback(); },
};

function mount(
  onProbe: (p: string, q: AttemptQuality, l: number, scaffolds?: AttemptScaffolds, attempt?: unknown) => unknown,
  languageDataOverride?: LanguageData,
  summaryOverride?: CurriculumComponentSummary,
  eventLogOverride?: KnowledgeEventLog,
  onValidated?: () => void,
  repairRequest?: () => { level: number; requestedAt: number; patterns?: string[]; handoffDecision?: import('../../../shared/learningDecision').LearningDecision } | null,
  onRepairRequestHandled?: (requestedAt: number) => void,
  locks: StudySessionLocks | null = passThroughLocks,
  initiallyPaused = false,
  scopePatterns?: readonly string[],
  resumeSessionId?: string,
  purpose?: 'practice' | 'check',
) {
  const container = document.createElement('div');
  // Solid attaches delegated listeners on the document; container must be
  // connected for bubbled clicks to reach them (see DECISIONS D10).
  document.body.appendChild(container);
  const eventLog = eventLogOverride ?? ({} as KnowledgeEventLog);
  const dispose = render(
    () => (
      <GrammarCoverage
        purpose={purpose}
        initiallyPaused={initiallyPaused}
        resumeSessionId={resumeSessionId}
        scopePatterns={scopePatterns}
        language="ja"
        languageData={languageDataOverride ?? languageData}
        eventLog={eventLog}
        projections={projectionsOf('ja', eventLog)}
        summary={summaryOverride ?? summary}
        onProbe={async (...args) => {
          // Echo the controller's reserved attempt id, as the real owner does:
          // the id the pass allocated is the identity the journal is written
          // under, so the mount helper must not substitute its own.
          await onProbe(...args);
          return (args[4] as { attemptId?: string } | undefined)?.attemptId ?? 'fixture-grammar-attempt';
        }}
        undoLifecycle={undoHarness.lifecycle()}
        onValidated={onValidated}
        repairRequest={repairRequest?.()}
        onRepairRequestHandled={onRepairRequestHandled}
        locks={locks}
      />
    ),
    container,
  );
  return { container, dispose };
}

function levelBlock(container: HTMLElement, level: number): HTMLElement {
  const block = container.querySelector(`[data-level="${level}"]`);
  expect(block).toBeTruthy();
  return block as HTMLElement;
}

async function expand(container: HTMLElement, level: number) {
  const row = container.querySelector(`.grammar-coverage__level-row[data-level="${level}"]`) as HTMLElement;
  if (row.getAttribute('aria-expanded') !== 'true') row.click();
  await tick();
}

async function startPass(container: HTMLElement, level: number) {
  await expand(container, level);
  const practise = levelBlock(container, level).querySelector('.grammar-coverage__session-btn') as HTMLButtonElement;
  expect(practise.disabled).toBe(false);
  practise.click();
  await tick();
}

function revealCurrent(container: HTMLElement, level: number) {
  const reveal = levelBlock(container, level).querySelector<HTMLButtonElement>('.study-encounter__reveal');
  reveal?.click();
}

function undoButton(container: HTMLElement, level: number) {
  return levelBlock(container, level).querySelector<HTMLButtonElement>('.grammar-coverage__session-undo');
}

function promptedPattern(container: HTMLElement, level: number) {
  return levelBlock(container, level).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern');
}

describe('GrammarCoverage policy-selected practice session', () => {
  it('shares Space reveal, rating and Undo with lexical tasks without composing or repeated submissions', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, undefined, undefined, undefined, undefined, undefined, undefined, passThroughLocks, false, ['ば']);
    try {
      await startPass(container, 2);
      const key = (value: string, options: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, cancelable: true, ...options }));
      key(' ', { isComposing: true }); key(' ', { repeat: true }); await beat();
      expect(container.querySelector('[data-testid="grammar-session-answer"]')).toBeNull();
      key(' '); await beat();
      expect(container.querySelector('[data-testid="grammar-session-answer"]')).not.toBeNull();
      expect(onProbe).not.toHaveBeenCalled();
      key('3'); await beat(); expect(onProbe).toHaveBeenCalledOnce();
      key('z', { ctrlKey: true }); await beat(); expect(undoHarness.retract).toHaveBeenCalledOnce();
    } finally { dispose(); }
  });

  it('admits only the resolved construction subset through the shared encounter and rating path', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, undefined, undefined, undefined, undefined, undefined, undefined, passThroughLocks, false, ['ば']);
    await startPass(container, 2);
    expect(promptedPattern(container, 2)).toBe('ば');
    revealCurrent(container, 2);
    (levelBlock(container, 2).querySelectorAll('.study-encounter__response .rating-matrix__quality')[2] as HTMLButtonElement).click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][4]).toMatchObject({ method: 'recall', taskType: 'grammar-self-assess' });
    expect(onProbe.mock.calls[0][4]).toMatchObject({ decision: {
      id: expect.any(String), selected: { targets: [{ kind: 'grammar-pattern', id: 'ja:grammar:ば', capability: 'grammar-recognition' }],
        task: { taskTemplateId: 'grammar-self-assess', responseModality: 'recall' },
        presentation: { language: 'ja', pattern: 'ば', contentHash: expect.any(String) } },
    } });
    expect(container.querySelector('.grammar-coverage__session-done')).toBeTruthy();
    expect(undoButton(container, 2)).not.toBeNull();
    undoButton(container, 2)!.click();
    await beat();
    expect(undoHarness.retract).toHaveBeenCalled();
    expect(promptedPattern(container, 2)).toBe('ば');
    dispose();
    const resumed = mount(onProbe);
    await tick();
    expect(promptedPattern(resumed.container, 2)).toBe('ば');
    expect(resumed.container.querySelector('[data-testid="grammar-session-answer"]')).not.toBeNull();
    resumed.dispose();
  });
  // Durable-pass storage is cleared at the shared boundary: tests that dispose
  // mid-pass would otherwise leak `mlearn-study-grammar:ja` into later mounts
  // and restore unexpectedly.
  beforeEach(() => {
    localStorage.clear();
    settingsUiLanguage = 'en';
    // Passes serialize their durable mutations with the Web Locks API;
    // happy-dom reports navigator.locks as null, which DISABLES the pass
    // surfaces (G04). These tests drive the serialized paths (including
    // direct createComponent renders that bypass the mount helper's lock
    // prop), so inject a pass-through lock (the shared study-session test
    // convention); removed in afterEach.
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
      configurable: true,
    });
  });
  afterEach(() => {
    // happy-dom's Navigator type predates the LockManager global; the stub
    // above installs an own configurable property that shadows it.
    const lockStubHost = globalThis.navigator as { locks?: unknown };
    delete lockStubHost.locks;
  });
  beforeEach(() => {
    // Resume persistence is per-test: clear the registered pass so no
    // test's stored cursor leaks into the next fixture (G01 isolation).
    globalThis.localStorage?.clear();
  });
  it('walks the level constructions once, probing each via onProbe before showing done', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);

    const probeBtns = () => Array.from(
      levelBlock(container, 2).querySelectorAll('.study-encounter__response .rating-matrix__quality'),
    ) as HTMLButtonElement[];
    const seen = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      const pattern = levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern');
      expect(['のに', 'ば']).toContain(pattern);
      seen.add(pattern as string);
      expect(probeBtns().length).toBeGreaterThanOrEqual(3);
      revealCurrent(container, 2);
      (probeBtns()[2] as HTMLElement).click(); // fluent
      await beat();
    }

    expect(seen.size).toBe(2); // each level-2 construction exactly once, no repeats
    expect(onProbe).toHaveBeenCalledTimes(2);
    const probed = onProbe.mock.calls.map((call) => call[0]);
    expect(probed).toEqual(expect.arrayContaining(['のに', 'ば']));
    expect(onProbe.mock.calls.every((call) => call[1] === 'fluent' && call[2] === 2)).toBe(true);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-done')).toBeTruthy();

    dispose();
    container.remove();
  });

  it('keeps a self-reported grammar check distinct from suspended practice and records its purpose', async () => {
    const onProbe = vi.fn();
    const practice = mount(onProbe); await startPass(practice.container, 2);
    const original = localStorage.getItem('mlearn-study-grammar:ja');
    practice.dispose(); practice.container.remove();
    const check = mount(onProbe, undefined, undefined, undefined, undefined, undefined, undefined, passThroughLocks, true, undefined, undefined, 'check');
    expect(check.container.querySelector('.grammar-coverage__start')).toBeNull();
    await startPass(check.container, 2);
    expect(localStorage.getItem('mlearn-study-grammar:ja')).toBe(original);
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar-check:ja')!).meta.purpose).toBe('check');
    revealCurrent(check.container, 2);
    (levelBlock(check.container, 2).querySelectorAll('.study-encounter__response .rating-matrix__quality')[2] as HTMLButtonElement).click();
    await beat();
    expect(onProbe.mock.calls[0][4]).toMatchObject({ method: 'recall', taskType: 'grammar-self-check' });
    expect(onProbe.mock.calls[0][4].decision.selected.task.taskTemplateId).toBe('grammar-self-check');
    expect(localStorage.getItem('mlearn-study-grammar:ja')).toBe(original);
    check.dispose(); check.container.remove();
  });

  it('resumes a revealed question and advances only after an acknowledged rating without remounting the session', async () => {
    const onProbe = vi.fn().mockResolvedValue('attempt-1');
    const first = mount(onProbe);
    await startPass(first.container, 2);
    const firstPrompt = levelBlock(first.container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern');
    expect(levelBlock(first.container, 2).querySelector<HTMLButtonElement>('.rating-matrix__quality:nth-child(3)')?.disabled).toBe(true);
    expect(levelBlock(first.container, 2).textContent).toContain('mlearn.LevelStudy.Grammar.SessionProgress');
    revealCurrent(first.container, 2);
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).revealed).toBe(true);
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).queue[0].id).toBe(firstPrompt);
    first.dispose();
    first.container.remove();

    const second = mount(onProbe);
    const sessionNode = levelBlock(second.container, 2).querySelector('.grammar-coverage__session');
    expect(second.container.querySelector('[data-testid="grammar-session-answer"]')).toBeTruthy();
    (second.container.querySelector('.study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect((onProbe.mock.calls[0] as unknown[])[4]).toMatchObject({ taskType: 'grammar-self-assess', attemptId: expect.any(String) });
    expect(levelBlock(second.container, 2).querySelector('.grammar-coverage__session')).toBe(sessionNode);
    expect(levelBlock(second.container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern')).not.toBe(firstPrompt);
    expect(second.container.querySelector('[aria-busy="true"]')).toBeNull();
    second.dispose();
    second.container.remove();
  });

  it('retries a failed acknowledged write using the reserved attempt identity', async () => {
    const attemptIds: string[] = [];
    const onProbe = vi.fn((_pattern: string, _quality: AttemptQuality, _level: number, _scaffolds?: AttemptScaffolds, attempt?: unknown) => {
      const attemptId = (attempt as { attemptId: string }).attemptId;
      attemptIds.push(attemptId);
      return attemptIds.length === 1 ? Promise.reject(new Error('controlled write failure')) : Promise.resolve(attemptId);
    });
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    revealCurrent(container, 2);
    (container.querySelector('.study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await tick();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).pending?.attemptId).toBe(attemptIds[0]);
    expect(container.querySelector('[data-phase="save-failed"]')).toBeTruthy();
    (container.querySelector('[data-testid="grammar-session-retry"]') as HTMLButtonElement).click();
    await tick();
    expect(attemptIds).toEqual([attemptIds[0], attemptIds[0]]);
    expect(onProbe.mock.calls[1][4]).toEqual(onProbe.mock.calls[0][4]);
    expect(onProbe.mock.calls[0][4]).toMatchObject({ decision: { id: expect.any(String) } });
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).index).toBe(1);
    dispose();
    container.remove();
  });

  it('refuses Skip while a failed journal write owns the current cursor', async () => {
    const onProbe = vi.fn().mockRejectedValue(new Error('journal unavailable'));
    const first = mount(onProbe);
    await startPass(first.container, 2);
    revealCurrent(first.container, 2);
    (first.container.querySelector('.study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await beat();
    const reserved = localStorage.getItem('mlearn-study-grammar:ja');
    const skip = first.container.querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement;
    skip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await beat();
    expect(localStorage.getItem('mlearn-study-grammar:ja')).toBe(reserved);
    expect(skip.disabled).toBe(true);
    first.dispose();
    first.container.remove();
    const second = mount(onProbe);
    await beat();
    expect(second.container.querySelector('[data-phase="save-failed"]')).toBeTruthy();
    expect(localStorage.getItem('mlearn-study-grammar:ja')).toBe(reserved);
    second.dispose();
    second.container.remove();
  });

  it('uses the shared knowledge matrix for the live construction probe', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);

    const live = levelBlock(container, 2).querySelector('.study-encounter__response') as HTMLElement;
    expect(live.querySelector('.rating-matrix')).not.toBeNull();
    revealCurrent(container, 2);
    (live.querySelector('.rating-matrix__adjust') as HTMLButtonElement).click();
    expect(live.textContent).toContain('mlearn.Knowledge.Capability.grammar-recognition');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await tick();

    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][1]).toBe('fluent');
    dispose();
    container.remove();
  });

  it('keeps the live matrix retryable after repeated durable cursor failures', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    const prompt = levelBlock(container, 2).querySelector('[data-pattern]')?.getAttribute('data-pattern');
    const fluent = () => levelBlock(container, 2).querySelector<HTMLButtonElement>('.study-encounter__response .rating-matrix__quality:nth-child(3)')!;
    revealCurrent(container, 2);
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    fluent().click();
    await beat();
    fluent().click();
    await beat();
    expect(onProbe).not.toHaveBeenCalled();
    expect(levelBlock(container, 2).querySelector('[data-pattern]')?.getAttribute('data-pattern')).toBe(prompt);
    setItem.mockRestore();
    fluent().click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });

  it('starts an explicit new scoped request while preserving and resuming the earlier cursor', async () => {
    const onProbe = vi.fn();
    const first = mount(onProbe); await startPass(first.container, 2); revealCurrent(first.container, 2);
    const prior = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    first.dispose(); first.container.remove();
    const next = mount(onProbe, undefined, undefined, undefined, undefined,
      () => ({ level: 2, requestedAt: 10, patterns: ['ば'] }), undefined, passThroughLocks, true, ['ば']);
    await tick();
    const active = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    expect(active.id).not.toBe(prior.id);
    expect(active.queue.map((item: { id: string }) => item.id)).toEqual(['ば']);
    expect(JSON.parse(localStorage.getItem(`mlearn-study-grammar:ja:session:${encodeURIComponent(prior.id)}`)!)).toEqual(prior);
    const pause = Array.from(next.container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'mlearn.LevelStudy.Mock.Pause')!;
    pause.click(); await tick();
    next.container.querySelector<HTMLButtonElement>('.grammar-coverage__saved-session button')!.click(); await tick();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!)).toEqual(prior);
    expect(onProbe).not.toHaveBeenCalled();
    next.dispose(); next.container.remove();
  });
  it('keeps a complete cross-level request through restart and records each construction at its package level', async () => {
    const onProbe = vi.fn();
    const first = mount(onProbe, undefined, undefined, undefined, undefined,
      () => ({ level: 2, requestedAt: 10, patterns: ['ば', 'たびに'] }), undefined, passThroughLocks, true, ['ば', 'たびに']);
    await tick();
    const saved = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    expect(saved.queue.map((item: { id: string }) => item.id).sort()).toEqual(['ば', 'たびに'].sort());
    first.dispose(); first.container.remove();
    const resumed = mount(onProbe, undefined, undefined, undefined, undefined, undefined, undefined,
      passThroughLocks, true, undefined, saved.id);
    await tick();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!)).toEqual(saved);
    for (const item of saved.queue as Array<{ id: string }>) {
      const point = languageData.grammar!.find(point => point.pattern === item.id)!;
      expect(promptedPattern(resumed.container, point.level!)).toBe(item.id);
      revealCurrent(resumed.container, point.level!);
      expect(levelBlock(resumed.container, point.level!).querySelector('[data-testid="grammar-session-answer"]')?.textContent).not.toContain('AnswerUnavailable');
      (resumed.container.querySelector('.study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
      await beat();
      expect(onProbe.mock.calls.at(-1)?.slice(0, 3)).toEqual([item.id, 'fluent', point.level]);
    }
    expect(onProbe).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).index).toBe(2);
    resumed.dispose(); resumed.container.remove();
  });
  it('resumes only an explicitly named saved session and leaves unrelated work paused for an unavailable ID', async () => {
    const onProbe = vi.fn(); const first = mount(onProbe); await startPass(first.container, 2);
    const saved = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    first.dispose(); first.container.remove();
    const missing = mount(onProbe, undefined, undefined, undefined, undefined, undefined, undefined, passThroughLocks, true, undefined, 'missing');
    await tick();
    expect(missing.container.textContent).toContain('mlearn.Product.ResumeUnavailable');
    expect(missing.container.querySelector('.grammar-coverage__session-prompt')).toBeNull();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!)).toEqual(saved);
    missing.dispose(); missing.container.remove();
    const resumed = mount(onProbe, undefined, undefined, undefined, undefined, undefined, undefined, passThroughLocks, true, undefined, saved.id);
    await tick(); expect(resumed.container.querySelector('.grammar-coverage__session-prompt')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!)).toEqual(saved);
    expect(onProbe).not.toHaveBeenCalled(); resumed.dispose(); resumed.container.remove();
  });
  it('acknowledges a new scope only after its cursor persists and offers retry after a storage refusal', async () => {
    const onProbe = vi.fn(); const first = mount(onProbe); await startPass(first.container, 2);
    const saved = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    first.dispose(); first.container.remove();
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('full'); });
    const handled = vi.fn();
    const next = mount(onProbe, undefined, undefined, undefined, undefined,
      () => ({ level: 2, requestedAt: 10, patterns: ['ば'] }), handled, passThroughLocks, true, ['ば']);
    await tick(); expect(handled).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!)).toEqual(saved);
    setItem.mockRestore();
    Array.from(next.container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'mlearn.Knowledge.Retry')!.click();
    await tick(); expect(handled).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).queue.map((item: { id: string }) => item.id)).toEqual(['ば']);
    expect(onProbe).not.toHaveBeenCalled(); next.dispose(); next.container.remove();
  });
  it('queues a mock repair until the live policy walk finishes without hiding it', async () => {
    const onProbe = vi.fn();
    const [repairRequest, setRepairRequest] = createSignal<{ level: number; requestedAt: number } | null>(null);
    const { container, dispose } = mount(onProbe, undefined, undefined, undefined, undefined, repairRequest);
    await startPass(container, 2);

    setRepairRequest({ level: 3, requestedAt: 1 });
    await tick();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')).toBeTruthy();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__level-row')?.getAttribute('aria-expanded')).toBe('true');

    for (let index = 0; index < 2; index += 1) {
      const fluent = levelBlock(container, 2).querySelector(
        '.study-encounter__response .rating-matrix__quality:nth-child(3)',
      ) as HTMLButtonElement;
      revealCurrent(container, 2);
      fluent.click();
      await beat();
    }

    expect(levelBlock(container, 3).querySelector('.grammar-coverage__level-row')?.getAttribute('aria-expanded')).toBe('true');
    expect(levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt')).toBeTruthy();
    expect(onProbe).toHaveBeenCalledTimes(2);
    dispose();
    container.remove();
  });

  it('keeps an owner-held mock repair queued across a projection-refresh remount', async () => {
    const onProbe = vi.fn();
    const [repairRequest, setRepairRequest] = createSignal<{ level: number; requestedAt: number } | null>(null);
    const onHandled = vi.fn((requestedAt: number) => {
      setRepairRequest((request) => request?.requestedAt === requestedAt ? null : request);
    });
    const first = mount(onProbe, undefined, undefined, undefined, undefined, repairRequest, onHandled);
    await startPass(first.container, 2);
    setRepairRequest({ level: 3, requestedAt: 42 });
    await tick();
    first.dispose();
    first.container.remove();

    // LevelStudyTab replaces this subtree while projections reload. The live
    // walk resumes from storage and the owner still supplies the unhandled request.
    const second = mount(onProbe, undefined, undefined, undefined, undefined, repairRequest, onHandled);
    await expand(second.container, 2);
    expect(levelBlock(second.container, 2).querySelector('.grammar-coverage__session-prompt')).toBeTruthy();
    expect(onHandled).not.toHaveBeenCalled();

    for (let index = 0; index < 2; index += 1) {
      const fluent = levelBlock(second.container, 2).querySelector(
        '.study-encounter__response .rating-matrix__quality:nth-child(3)',
      ) as HTMLButtonElement;
      revealCurrent(second.container, 2);
      fluent.click();
      await beat();
    }

    expect(levelBlock(second.container, 3).querySelector('.grammar-coverage__session-prompt')).toBeTruthy();
    expect(onHandled).toHaveBeenCalledWith(42);
    expect(repairRequest()).toBeNull();
    second.dispose();
    second.container.remove();
  });

  it('skip advances without recording evidence (non-epistemic, G04)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);

    const first = levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern');
    (levelBlock(container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLElement).click();
    await beat();
    expect(onProbe).not.toHaveBeenCalled();

    const second = levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern');
    expect(second).not.toBe(first);
    expect(['のに', 'ば']).toContain(second);
    expect(container.querySelector('.grammar-coverage__session-done')).toBeNull();

    dispose();
    container.remove();
  });

  it('a rapid second click never rates the next, unseen construction (G01)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);

    const firstFluent = levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    revealCurrent(container, 2);
    firstFluent.click();
    firstFluent.click(); // same tick double-fire / stale handler
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);

    // After the presentation beat the next prompt is shown — but the trailing
    // half of an ordinary double-click (MouseEvent.detail === 2, same
    // position within the platform double-click window) is the SAME gesture,
    // not a deliberate answer: it must not rate the unseen construction.
    await beat();
    const pattern = levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern');
    expect(pattern).toBeDefined();
    expect(pattern).not.toBe(onProbe.mock.calls[0][0]);
    const nextFluent = levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    expect(nextFluent.disabled).toBe(true);
    nextFluent.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);

    // A genuinely fresh activation (detail <= 1) rates the next prompt once.
    revealCurrent(container, 2);
    nextFluent.click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(2);
    expect(onProbe.mock.calls[1][0]).not.toBe(onProbe.mock.calls[0][0]);

    dispose();
    container.remove();
  });

  it('key auto-repeat never rates the next, unseen construction (G01)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);

    const fluent = levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    revealCurrent(container, 2);
    fluent.click();
    await beat();

    // The prompt advanced, so the controls were re-created: re-query before
    // simulating the held key against the live element.
    const second = levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    revealCurrent(container, 2);
    // Holding Enter/Space auto-repeats keydown; the control must cancel the
    // default activation so the held key cannot rate the following prompt.
    second.focus();
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(repeat, 'repeat', { value: true });
    const prevent = vi.spyOn(repeat, 'preventDefault');
    second.dispatchEvent(repeat);
    expect(prevent).toHaveBeenCalled();
    expect(onProbe).toHaveBeenCalledTimes(1);

    revealCurrent(container, 2);
    second.click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(2);

    dispose();
    container.remove();
  });

  it('a completed pass can be rerun (submission state resets with the new pass)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    const fluent = () => levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    revealCurrent(container, 2);
    (fluent()).click();
    await beat();
    revealCurrent(container, 2);
    (fluent()).click();
    await beat();
    expect(container.querySelector('.grammar-coverage__session-done')).toBeTruthy();

    // Start a fresh pass over the same level: the first rating must register.
    const practise = levelBlock(container, 2).querySelector('.grammar-coverage__session-btn') as HTMLButtonElement;
    practise.click();
    await tick();
    revealCurrent(container, 2);
    (fluent()).click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(3);

    dispose();
    container.remove();
  });

  it('policy practice launches the shared recall task while rows remain inspection', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await expand(container, 2);
    expect(container.querySelector('.grammar-coverage__probe-btn')).toBeNull();
    expect(container.querySelector('.grammar-coverage__check')).toBeNull();
    container.querySelector<HTMLButtonElement>('.grammar-coverage__start')!.click();
    await tick();
    const pattern = promptedPattern(container, 2);
    expect(pattern).toBeTruthy();
    expect(container.querySelector('.grammar-coverage--studying')).not.toBeNull();
    expect(container.querySelector('.study-encounter')).not.toBeNull();
    expect(container.querySelector('.study-encounter__response')?.hasAttribute('hidden')).toBe(true);
    expect(container.querySelector('[data-testid="grammar-session-answer"]')).toBeNull();
    expect(onProbe).not.toHaveBeenCalled();
    revealCurrent(container, 2);
    await tick();
    expect(container.querySelector('[data-testid="grammar-session-answer"]')).not.toBeNull();
    expect(container.querySelectorAll('.rating-matrix__quality')).toHaveLength(4);
    container.querySelectorAll<HTMLButtonElement>('.rating-matrix__quality')[2].click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][0]).toBe(pattern);
    dispose(); container.remove();
  });

  it('returns to coverage without leaving a hidden rating controller active, then resumes the same prompt', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    const pattern = promptedPattern(container, 2);
    revealCurrent(container, 2); await tick();
    const back = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('mlearn.LevelStudy.Mock.Pause'))!;
    back.click(); await tick();
    expect(container.querySelector('.study-encounter')).toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await tick(); expect(onProbe).not.toHaveBeenCalled();
    expect(container.querySelector('.grammar-coverage__meaning')).toBeNull();
    await expand(container, 3);
    const resume = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('mlearn.StudyEncounter.Resume'))!;
    resume.click(); await tick();
    expect(promptedPattern(container, 2)).toBe(pattern);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await tick(); expect(onProbe).toHaveBeenCalledTimes(1);
    dispose(); container.remove();
  });

  it('keeps an open review list mounted when journal projections update its level counts', async () => {
    const [liveSummary, setLiveSummary] = createSignal(summary);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => (
      <GrammarCoverage
        language="ja"
        languageData={languageData}
        eventLog={{} as KnowledgeEventLog}
        projections={{}}
        summary={liveSummary()}
        onProbe={async () => 'fixture-grammar-attempt'}
        undoLifecycle={undoHarness.lifecycle()}
        locks={passThroughLocks}
      />
    ), container);
    await expand(container, 2);
    const details = levelBlock(container, 2).querySelector<HTMLDetailsElement>('.grammar-coverage__review')!;
    details.open = true;

    setLiveSummary({
      ...summary,
      known: 1,
      unmeasured: 2,
      buckets: summary.buckets.map((bucket) => bucket.level === 2
        ? { ...bucket, known: 1, unmeasured: 1 }
        : { ...bucket }),
    });
    await tick();

    expect(levelBlock(container, 2).querySelector('.grammar-coverage__review')).toBe(details);
    expect(details.open).toBe(true);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__level-bar')?.getAttribute('aria-label')).toBe('1/2');
    dispose();
    container.remove();
  });

  it('session ratings describe pre-reveal recall and retain unassisted provenance', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2); // level 2 pass running
    // No meaning cue is rendered anywhere while the pass is live.
    expect(container.querySelectorAll('.grammar-coverage__meaning').length).toBe(0);
    expect(container.querySelector('[data-testid="grammar-session-answer"]')).toBeNull();
    const fluent = container.querySelector('.study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLElement;
    revealCurrent(container, 2);
    expect(container.querySelector('[data-testid="grammar-session-answer"]')).toBeTruthy();
    fluent.click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][3]).toBeUndefined();
    dispose();
    container.remove();
  });

  it('a live pass never leaks across levels and explicit Start suspends it instead of imposing a latch', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2); // level 2 pass running
    const original = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);

    await expand(container, 3);
    const level3 = levelBlock(container, 3);
    expect(level3.querySelector('.grammar-coverage__session-prompt')).toBeNull();
    expect(level3.querySelector('.study-encounter__response')).toBeNull();
    const level3Practise = level3.querySelector('.grammar-coverage__session-btn') as HTMLButtonElement;
    expect(level3Practise).toBeTruthy();
    expect(level3Practise.disabled).toBe(false);
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).id).toBe(original.id);

    // Single-expansion collapsed level 2; reopening shows the pass intact.
    await expand(container, 2);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')).toBeTruthy();
    expect(levelBlock(container, 2).querySelector('.study-encounter__response')).toBeTruthy();
    await expand(container, 3);
    levelBlock(container, 3).querySelector<HTMLButtonElement>('.grammar-coverage__session-btn')!.click(); await tick();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).meta.level).toBe(3);
    expect(JSON.parse(localStorage.getItem(`mlearn-study-grammar:ja:session:${encodeURIComponent(original.id)}`)!)).toEqual(original);

    dispose();
    container.remove();
  });

  it('answers stay inside the shared task; coverage remains a list of progress after the pass', async () => {
    settingsUiLanguage = 'en';
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    expect(container.querySelectorAll('.grammar-coverage__meaning').length).toBe(0);
    expect(container.querySelectorAll('.grammar-coverage__construction').length).toBe(0);

    const fluent = () => levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    revealCurrent(container, 2);
    (fluent()).click();
    await beat();
    revealCurrent(container, 2);
    (fluent()).click();
    await beat();

    // Coverage returns without supplying answers to a later recall task.
    expect(container.querySelectorAll('.grammar-coverage__construction').length).toBe(2);
    expect(container.querySelectorAll('.grammar-coverage__meaning').length).toBe(0);
    expect(onProbe).toHaveBeenCalledTimes(2);

    dispose();
    container.remove();
  });

  it('the revealed answer uses localized package meanings; unsupported translations stay unavailable', async () => {
    for (const locale of ['de', 'en']) {
      settingsUiLanguage = locale;
      localStorage.removeItem('mlearn-study-grammar:ja');
      const { container, dispose } = mount(vi.fn());
      await startPass(container, 2);
      const meanings: string[] = [];
      for (let index = 0; index < 2; index++) {
        revealCurrent(container, 2); await tick();
        meanings.push(container.querySelector('[data-testid="grammar-session-answer"]')?.textContent ?? '');
        levelBlock(container, 2).querySelector<HTMLButtonElement>('.grammar-coverage__session-skip, .study-encounter__skip')!.click();
        await tick();
      }
      expect(meanings).toEqual(expect.arrayContaining(locale === 'de'
        ? ['obwohl (trotzdem)', 'mlearn.LevelStudy.Grammar.AnswerUnavailable']
        : ['even though', 'conditional "if"']));
      dispose(); container.remove();
    }
  });

  it('a stored pass survives a de→ja→de language round trip without being clobbered', async () => {
    // Seed a VALID de pass so the de cursor is genuinely ACTIVE on load — this
    // exercises a real de→ja reload (not stale-entry rejection).
    const storedGerman = JSON.stringify(storedGrammarSession('de', 2, ['weil', 'trotzdem']));
    globalThis.localStorage?.setItem('mlearn-study-grammar:de', storedGerman);
    const germanPackage = {
      language: 'de',
      meaningLanguage: 'en',
      grammar: [
        { pattern: 'weil', meaning: 'because', level: 2 },
        { pattern: 'trotzdem', meaning: 'nevertheless', level: 2 },
      ],
      grammarLevels: { difficulty: 'higher-is-harder', names: { '2': 'B1' } },
    } as unknown as LanguageData;
    const germanSummary: CurriculumComponentSummary = {
      component: 'grammar',
      buckets: [{ level: 2, total: 2, known: 0, learning: 0, unknown: 0, unmeasured: 2 }],
      total: 2,
      known: 0,
      learning: 0,
      unknown: 0,
      unmeasured: 2,
      complete: false,
    };

    const { createComponent, createSignal } = await import('solid-js');
    const { render } = await import('solid-js/web');
    const [activeLanguage, setActiveLanguage] = createSignal('de');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => createComponent(GrammarCoverage, {
      get language() { return activeLanguage(); },
      get languageData() { return activeLanguage() === 'de' ? germanPackage : languageData; },
      get summary() { return activeLanguage() === 'de' ? germanSummary : summary; },
      eventLog: {} as KnowledgeEventLog,
      projections: {},
      onProbe: async () => 'fixture-grammar-attempt',
      undoLifecycle: undoHarness.lifecycle(),
    }), container);

    // The stored de cursor is ACTIVE on load (cursor 0 restored).
    await expand(container, 2);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern')).toBe('weil');

    // Flip de → ja: the ja view has no stored pass, and the persistence effect
    // must NOT clobber the stored de cursor with the (different) ja context.
    setActiveLanguage('ja');
    await tick();
    expect(globalThis.localStorage?.getItem('mlearn-study-grammar:de')).toBe(storedGerman);
    expect(globalThis.localStorage?.getItem('mlearn-study-grammar:ja')).toBeNull();

    // Flip back: the de cursor resumes exactly where it was.
    setActiveLanguage('de');
    await tick();
    await vi.waitFor(() => expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern')).toBe('weil'));

    dispose();
    container.remove();
    globalThis.localStorage?.removeItem('mlearn-study-grammar:de');
  });

  it('a package-declared non-English meaning language is honored (open-world)', async () => {
    settingsUiLanguage = 'en';
    const germanCanonical = {
      language: 'de',
      meaningLanguage: 'de',
      grammar: [
        { pattern: 'weil', meaning: 'kausaler Nebensatz', level: 2 },
      ],
      grammarLevels: { difficulty: 'higher-is-harder', names: { '2': 'B1' } },
    } as unknown as LanguageData;
    const germanSummary: CurriculumComponentSummary = {
      ...summary,
      buckets: [{ level: 2, total: 1, known: 0, learning: 0, unknown: 0, unmeasured: 1 }],
      total: 1,
      unmeasured: 1,
    };
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, germanCanonical, germanSummary);
    await startPass(container, 2);
    revealCurrent(container, 2); await tick();
    expect(container.querySelector('[data-testid="grammar-session-answer"]')?.textContent).toBe('mlearn.LevelStudy.Grammar.AnswerUnavailable');

    settingsUiLanguage = 'de';
    const { container: deContainer, dispose: disposeDe } = mount(onProbe, germanCanonical, germanSummary);
    await tick();
    expect(deContainer.querySelector('[data-testid="grammar-session-answer"]')?.textContent).toBe('kausaler Nebensatz');

    dispose();
    container.remove();
    disposeDe();
    deContainer.remove();
  });

  it('collapsed coverage fabricates nothing; constructions render only inside expanded levels', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    expect(container.querySelectorAll('.grammar-coverage__construction').length).toBe(0);
    await startPass(container, 2);
    expect(container.querySelectorAll('.grammar-coverage__construction').length).toBe(0); // hidden while live
    expect(onProbe).toHaveBeenCalledTimes(0);
    dispose();
    container.remove();
  });

  it('a live pass resumes across remount at the same cursor and clears on completion', async () => {
    const onProbe = vi.fn();
    const first = mount(onProbe);
    await startPass(first.container, 2);
    const firstPresented = first.container.querySelector('[data-level="2"] [data-pattern]')?.getAttribute('data-pattern');
    expect(firstPresented).toBeTruthy();
    revealCurrent(first.container, 2);
    (first.container.querySelector('[data-level="2"] .study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(globalThis.localStorage?.getItem('mlearn-study-grammar:ja')).toBeTruthy(); // in-progress pass persisted
    first.dispose();
    first.container.remove();

    // A fresh mount must restore the interrupted pass at the next cursor — no
    // Practise click needed, and the resumed item is the not-yet-seen one.
    const second = mount(onProbe);
    expect((levelBlock(second.container, 2).querySelector('.grammar-coverage__level-row') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
    const resumedPattern = second.container.querySelector('[data-level="2"] [data-pattern]')?.getAttribute('data-pattern');
    expect(resumedPattern).toBeTruthy();
    expect(resumedPattern).not.toBe(firstPresented);
    expect(levelBlock(second.container, 2).querySelector('.grammar-coverage__session-btn:not(.study-encounter__reveal)')).toBeNull();

    revealCurrent(second.container, 2);
    (second.container.querySelector('[data-level="2"] .study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(2);
    // Level 2 has exactly two constructions: after the resumed rating the pass
    // is complete, which must clear the stored cursor (no phantom resume).
    expect(second.container.querySelector('.grammar-coverage__session-done')).toBeTruthy();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!).index).toBe(2);

    second.dispose();
    second.container.remove();
  });

  it('a plan visit offers explicit resume without opening or arming the saved grammar exercise', async () => {
    const first = mount(vi.fn());
    await startPass(first.container, 2);
    const pattern = first.container.querySelector('[data-level="2"] [data-pattern]')?.getAttribute('data-pattern');
    first.dispose(); first.container.remove();
    const second = mount(vi.fn(), undefined, undefined, undefined, undefined, undefined, undefined, passThroughLocks, true);
    expect(second.container.querySelector('.grammar-coverage--studying')).toBeNull();
    expect(second.container.querySelector('.study-encounter')).toBeNull();
    const resume = Array.from(second.container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('mlearn.StudyEncounter.Resume'));
    expect(resume).toBeDefined();
    resume!.click(); await tick();
    expect(second.container.querySelector('.grammar-coverage--studying')).not.toBeNull();
    expect(second.container.querySelector('[data-level="2"] [data-pattern]')?.getAttribute('data-pattern')).toBe(pattern);
    second.dispose(); second.container.remove();
  });

  it('refuses a saved admission when the package changes its cue without changing membership', async () => {
    const first = mount(vi.fn());
    await startPass(first.container, 2);
    const stored = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    const pattern = stored.queue[0].id;
    expect(stored.queue[0].decision).toBeDefined();
    first.dispose(); first.container.remove();
    const changed = { ...languageData, grammar: languageData.grammar!.map(point => point.pattern === pattern
      ? { ...point, meaning: 'replacement package cue' } : point) };
    const onProbe = vi.fn();
    const second = mount(onProbe, changed);
    await expand(second.container, 2);
    expect(second.container.querySelector('[data-level="2"] [data-pattern]')).toBeNull();
    expect(onProbe).not.toHaveBeenCalled();
    second.dispose(); second.container.remove();
  });

  it('corrupt or stale stored pass entries are discarded, never resumed', async () => {
    const cases: [string, string][] = [
      ['not-valid-json', 'not-valid-json'],
      ['unknown-level', JSON.stringify({ level: 9, queue: ['のに'], index: 0 })],
      ['retired-pattern', JSON.stringify({ level: 2, queue: ['のに', 'でない'], index: 0, denominator: 'のに\u0000ば' })],
      ['duplicate-pattern', JSON.stringify({ level: 2, queue: ['のに', 'のに'], index: 0, denominator: 'のに\u0000ば' })],
      ['out-of-bounds-cursor', JSON.stringify({ level: 2, queue: ['のに', 'ば'], index: 7, denominator: 'のに\u0000ば' })],
      ['partial-queue-denominator', JSON.stringify({ level: 2, queue: ['のに'], index: 0, denominator: 'のに\u0000ば' })],
      ['stale-denominator', JSON.stringify({ level: 2, queue: ['のに', 'ば'], index: 0, denominator: 'のに\u0000でない' })],
      ['duplicate-substituted-queue', JSON.stringify({ level: 2, queue: ['のに', 'のに'], index: 0, denominator: 'のに\u0000ば' })],
      ['empty-queue', JSON.stringify({ level: 2, queue: [], index: 0 })],
    ];
    for (const [label, value] of cases) {
      globalThis.localStorage?.setItem('mlearn-study-grammar:ja', value);
      const { container, dispose } = mount(vi.fn());
      await expand(container, 2);
      // No restored prompt; the user gets a clean Practise entry instead.
      expect(container.querySelector('[data-level="2"] [data-pattern]'), label).toBeNull();
      expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-btn'), label).toBeTruthy();
      dispose();
      container.remove();
    }
  });

  it('stored pass is scoped to its learning language (no cross-language resume)', async () => {
    globalThis.localStorage?.setItem('mlearn-study-grammar:de', JSON.stringify(storedGrammarSession('de', 2, ['weil', 'trotzdem'])));
    const { container, dispose } = mount(vi.fn());
    await expand(container, 2);
    // The 'ja' mount must not adopt a German-language cursor.
    expect(container.querySelector('[data-level="2"] [data-pattern]')).toBeNull();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-btn')).toBeTruthy();
    dispose();
    container.remove();
  });

  it('a same-language package update re-validates the in-memory pass (reload on package identity)', async () => {
    localStorage.clear();
    // Level 2 is のに + ば; a valid stored pass for that multiset.
    globalThis.localStorage?.setItem(
      'mlearn-study-grammar:ja',
      JSON.stringify(storedGrammarSession('ja', 2, ['のに', 'ば'])),
    );
    const { createComponent, createSignal } = await import('solid-js');
    const { render } = await import('solid-js/web');
    // A content update adds a third same-level construction: the stored
    // multiset 'のに\u0000ば' no longer equals the new level denominator, so
    // the same-language reload must drop the pass rather than keep it stale.
    const updatedData = {
      ...languageData,
      grammar: [...(languageData.grammar ?? []), { pattern: 'てしまう', meaning: 'to end up doing (with regret)', level: 2 }],
    } as unknown as LanguageData;
    const [data, setData] = createSignal(languageData);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => createComponent(GrammarCoverage, {
      language: 'ja',
      get languageData() { return data(); },
      summary,
      eventLog: {} as KnowledgeEventLog,
      projections: {},
      onProbe: async () => 'fixture-grammar-attempt',
      undoLifecycle: undoHarness.lifecycle(),
    }), container);

    // Active under the original package.
    await expand(container, 2);
    expect(levelBlock(container, 2).querySelector('[data-pattern]')).toBeTruthy();

    // Same language, updated package: the pass is re-validated and dropped.
    setData(updatedData);
    await tick();
    expect(levelBlock(container, 2).querySelector('[data-pattern]')).toBeNull();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-btn')).toBeTruthy();
    // Stored entry is untouched by re-validation (restart/remount reconciles).
    expect(globalThis.localStorage?.getItem('mlearn-study-grammar:ja')).not.toBeNull();

    dispose();
    container.remove();
    localStorage.clear();
  });

  it('persists the pass cursor synchronously inside the handler, before any effect flush (G01)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!)).toMatchObject({ index: 0 });

    // The rating handler synchronously persists a stable pending attempt at
    // the presented cursor before invoking the journal writer.
    revealCurrent(container, 2);
    const setItem = vi.spyOn(localStorage, 'setItem');
    (levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLElement).click();
    const persistedWrite = setItem.mock.calls.find(([key]) => key === 'mlearn-study-grammar:ja');
    expect(persistedWrite).toBeTruthy(); // persisted synchronously IN the handler
    expect(JSON.parse(persistedWrite![1]!).index).toBe(0);
    expect(JSON.parse(persistedWrite![1]!).pending?.index).toBe(0);
    expect(JSON.parse(persistedWrite![1]!).pending?.attemptId).toEqual(expect.any(String));
    expect(onProbe).toHaveBeenCalledTimes(1);
    setItem.mockRestore();

    // Completing the walk removes the stored entry (index past the end).
    await beat();
    revealCurrent(container, 2);
    (levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLElement).click();
    await beat();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-done')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).index).toBe(2);
    dispose();
    container.remove();
  });

  it('a language switch with a live pass never files one language under another key (R19/G01)', async () => {
    const germanData = {
      language: 'de',
      grammar: [{ pattern: 'weil', meaning: 'because', level: 2 }],
      grammarLevels: { names: { '2': 'B1' } },
    } as unknown as LanguageData;
    const germanSummary: CurriculumComponentSummary = {
      component: 'grammar',
      buckets: [{ level: 2, total: 1, known: 0, learning: 0, unknown: 0, unmeasured: 1 }],
      total: 1, known: 0, learning: 0, unknown: 0, unmeasured: 1, complete: false,
    };
    const [language, setLanguage] = createSignal('ja');
    const [data, setData] = createSignal(languageData);
    const onProbe = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => (
      <GrammarCoverage
        language={language()}
        languageData={data()}
        summary={language() === 'ja' ? summary : germanSummary}
        eventLog={{} as KnowledgeEventLog}
        projections={{}}
        onProbe={onProbe}
        undoLifecycle={undoHarness.lifecycle()}
      />
    ), container);

    await startPass(container, 2);
    expect(globalThis.localStorage?.getItem('mlearn-study-grammar:ja')).not.toBeNull();

    // Switch to German while the Japanese pass is live: the stored Japanese
    // entry stays under its own key untouched, German's key stays empty, and
    // the in-memory pass swaps to German's durable state (none) — never
    // cross-filed through a reactive persist (R19/G01).
    setLanguage('de');
    setData(germanData);
    await tick();
    await tick();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!).meta.level).toBe(2);
    expect(globalThis.localStorage?.getItem('mlearn-study-grammar:de')).toBeNull();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')).toBeNull();

    dispose();
    container.remove();
    localStorage.clear();
  });

  it('disables the pass surfaces without a Web Lock (G04): honest note, no starts, nothing restored to act on', async () => {
    // A stored live pass exists, but without a lock primitive nothing may
    // act on it: the honest note replaces the start affordances — never an
    // unserialized multi-window pass (the MockExam G04 convention).
    globalThis.localStorage?.setItem('mlearn-study-grammar:ja', JSON.stringify({ level: 2, queue: ['のに', 'ば'], index: 0, denominator: 'のに\u0000ば' }));
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, undefined, undefined, undefined, undefined, undefined, undefined, null);
    await expand(container, 2);
    expect(container.querySelector('[data-testid="grammar-no-locks"]')).toBeTruthy();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-btn')).toBeNull();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__contrast-btn')).toBeNull();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')).toBeNull();
    expect(onProbe).not.toHaveBeenCalled();
    dispose();
    container.remove();
    globalThis.localStorage?.removeItem('mlearn-study-grammar:ja');
  });
});

describe('GrammarCoverage durable Undo', () => {
  // The retraction harness is module-level (it stands in for the shared
  // provider), so its state is reset per test rather than per mount.
  beforeEach(() => {
    localStorage.clear();
    settingsUiLanguage = 'en';
    pendingRecord = null;
    undoHarness.projections.clear();
    undoHarness.record.mockClear();
    undoHarness.recover.mockClear();
    undoHarness.retract.mockClear();
    undoHarness.retract.mockImplementation(async () => true);
    undoHarness.record.mockImplementation(async (record: UndoRecord) => { pendingRecord = record; return true; });
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
      configurable: true,
    });
  });
  afterEach(() => {
    const lockStubHost = globalThis.navigator as { locks?: unknown };
    delete lockStubHost.locks;
    pendingRecord = null;
  });

  /** Rates the revealed prompt fluent and waits for the journal write to land. */
  const rateRevealed = async (onProbe: Mock, container: HTMLElement, level: number) => {
    const buttons = levelBlock(container, level).querySelectorAll('.study-encounter__response .rating-matrix__quality');
    (buttons[2] as HTMLButtonElement).click(); // fluent
    await beat();
    // The pass only advances once the write for that attempt is accepted, so
    // the identity the Undo must use is the one the pass actually probed.
    const attemptId = (onProbe.mock.calls[0]?.[4] as { attemptId: string } | undefined)?.attemptId;
    expect(typeof attemptId).toBe('string');
    return attemptId as string;
  };
  /** A live pass with one rating already acknowledged: the only state in
   *  which an Undo is a meaningful offer. */
  const mountRatedPass = async (level = 2) => {
    const onProbe = vi.fn();
    const mounted = mount(onProbe);
    await startPass(mounted.container, level);
    revealCurrent(mounted.container, level);
    await tick();
    const rated = promptedPattern(mounted.container, level) as string;
    const attemptId = await rateRevealed(onProbe, mounted.container, level);
    return { ...mounted, onProbe, rated, attemptId };
  };

  it('offers no Undo before anything is rated, then one exactly where a rating can be taken back', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    // Nothing rated: the control is absent, not disabled — there is nothing to
    // take back, and a visible-but-dead affordance would lie about that.
    expect(undoButton(container, 2)).toBeNull();

    revealCurrent(container, 2);
    await tick();
    expect(undoButton(container, 2)).toBeNull();

    const rated = promptedPattern(container, 2);
    await rateRevealed(onProbe, container, 2);
    expect(undoButton(container, 2)?.disabled).toBe(false);
    // The pass advanced past the rated step, and the prompt on screen is now a
    // different construction — not the one the learner just answered.
    expect(promptedPattern(container, 2)).not.toBe(rated);
    dispose();
    container.remove();
  });

  it('takes a rating back through the shared protocol: record first, retract the grammar key, rewind the pass', async () => {
    const { container, dispose, rated, attemptId } = await mountRatedPass();

    undoButton(container, 2)!.click();
    await beat();

    // The decision is durably recorded BEFORE the retraction: an interrupted
    // Undo has to be finishable by a reloaded window, not only by this one.
    expect(undoHarness.record).toHaveBeenCalledTimes(1);
    const record = undoHarness.record.mock.calls[0][0];
    expect(record.surface).toBe('grammar');
    expect(record.word).toBe(rated);
    expect(record.attemptId).toBe(attemptId);
    expect(record.attemptIds).toEqual([attemptId]);
    // Routed to the key this surface's evidence actually lands on, and named
    // for replay, rather than re-derived through a word-form helper.
    expect(record.target?.keys).toEqual([grammarEvidenceKey('ja', rated, 'grammar-recognition')]);
    expect(record.target?.replay).toEqual({ kind: 'grammar', language: 'ja', patterns: [rated] });
    expect(undoHarness.retract).toHaveBeenCalledWith(record, [attemptId]);

    // The pass is back on the rated step, revealed — a rating can only be made
    // on a revealed prompt, so restoring the position without the reveal would
    // silently re-arm a rating the learner never made.
    expect(promptedPattern(container, 2)).toBe(rated);
    expect(levelBlock(container, 2).querySelector('.study-encounter__reveal')).toBeNull();
    expect(levelBlock(container, 2).querySelector('[data-testid="grammar-session-answer"]')).toBeTruthy();
    // And the affordance withdraws: there is nothing left to take back.
    expect(undoButton(container, 2)).toBeNull();
    dispose();
    container.remove();
  });

  it('retains the original self-report correction after Undo and restart and rerates once to the next prompt', async () => {
    const { container, dispose, rated, onProbe, attemptId } = await mountRatedPass();
    const next = promptedPattern(container, 2);
    undoButton(container, 2)!.click();
    await beat();
    expect(promptedPattern(container, 2)).toBe(rated);
    expect(levelBlock(container, 2).querySelectorAll('.rating-matrix__quality')).toHaveLength(4);
    const persisted = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    expect(persisted.meta.correction).toMatchObject({ index: persisted.index, itemId: rated, attemptId });
    expect(persisted.meta.priorCueExposure).toBeUndefined();
    dispose(); container.remove();
    const resumed = mount(onProbe);
    await tick();
    expect(resumed.container.textContent).toContain('mlearn.Flashcards.Review.CorrectingReport');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(2);
    expect(onProbe.mock.calls[1][4]).toMatchObject({ correctsAttemptId: attemptId });
    expect(promptedPattern(resumed.container, 2)).toBe(next);
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).meta.correction).toBeUndefined();
    resumed.dispose(); resumed.container.remove();
  });

  it('keeps older Undo receipts without original report identity as exposed replay after restart', async () => {
    const { container, dispose, rated, onProbe } = await mountRatedPass();
    undoHarness.record.mockImplementation(async record => {
      delete (record.restore as { correctionAttemptId?: string }).correctionAttemptId;
      pendingRecord = record;
      return true;
    });
    undoButton(container, 2)!.click(); await beat();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).meta.priorCueExposure).toMatchObject({ itemId: rated });
    expect(levelBlock(container, 2).querySelectorAll('.rating-matrix__quality')).toHaveLength(0);
    dispose(); container.remove();
    const resumed = mount(onProbe); await tick();
    expect(resumed.container.textContent).toContain('mlearn.WordSync.ContinueAfterReference');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true })); await beat();
    expect(onProbe).toHaveBeenCalledTimes(1);
    resumed.dispose(); resumed.container.remove();
  });

  it('a refused retraction keeps the rating, the record and the control, and reports a retryable failure', async () => {
    undoHarness.retract.mockImplementation(async () => false);
    const { container, dispose, attemptId } = await mountRatedPass();
    const advancedTo = promptedPattern(container, 2);

    undoButton(container, 2)!.click();
    await beat();

    // The rating is still applied and the pass still advanced — an Undo that
    // did not land must not look like it did.
    expect(promptedPattern(container, 2)).toBe(advancedTo);
    // The record survives, so the retry finishes THIS Undo rather than
    // starting a new one, and the control is still offered.
    expect(pendingRecord).not.toBeNull();
    expect(undoButton(container, 2)?.disabled).toBe(false);
    const alert = levelBlock(container, 2).querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('mlearn.LevelStudy.Grammar.UndoSaveFailed');

    undoHarness.retract.mockImplementation(async () => true);
    (alert!.querySelector('button') as HTMLButtonElement).click();
    await beat();
    expect(undoHarness.retract).toHaveBeenCalledTimes(2);
    expect(undoHarness.retract.mock.calls.every((call) => call[0].attemptId === attemptId)).toBe(true);
    expect(pendingRecord).toBeNull();
    dispose();
    container.remove();
  });

  it('a reloaded window finishes an interrupted Undo through the projection this surface registered', async () => {
    // The retraction never answers: the learner asked, the decision was
    // recorded, and the window goes away before it could be applied. That is
    // exactly the case the durable record exists for.
    let answer: ((accepted: boolean) => void) | undefined;
    undoHarness.retract.mockImplementation(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    const first = await mountRatedPass();
    undoButton(first.container, 2)!.click();
    await beat();
    const interrupted = pendingRecord;
    expect(interrupted).not.toBeNull();
    first.dispose();
    first.container.remove();
    answer?.(true);
    await tick();

    // The reloaded window never saw the learner's click, but the record
    // outlived the window it was decided in, so the projection this surface
    // registered under its own tag is what can finish it.
    const second = mount(vi.fn());
    expect(undoHarness.recover).toHaveBeenCalled();
    const projection = undoHarness.projections.get('grammar');
    expect(projection).toBeTypeOf('function');
    // The projection is a commit callback the shared protocol invokes once the
    // retraction is durable; here it is invoked directly with a stand-in store,
    // since the durable store is the owner's, not this suite's.
    const restored = await projection!(interrupted!);
    restored(interrupted!, {} as never);
    await beat();
    expect(second.container.querySelector('[role="alert"]')).toBeNull();
    second.dispose();
    second.container.remove();
    pendingRecord = null;
  });
});

describe('GrammarCoverage take-back window follows the shared retention policy', () => {
  // The retention window is ONE decision owned by undoHistory (see that
  // module's contract). This surface is a third study pass, so it must obey
  // the same window as flashcard review and word sync — the bug this guards
  // is a raw unbounded append plus no reset, which let the stack grow across
  // every pass and every level in the window's lifetime.
  beforeEach(() => {
    localStorage.clear();
    settingsUiLanguage = 'en';
    pendingRecord = null;
    undoHarness.projections.clear();
    undoHarness.record.mockClear();
    undoHarness.recover.mockClear();
    undoHarness.retract.mockClear();
    undoHarness.retract.mockImplementation(async () => true);
    undoHarness.record.mockImplementation(async (record: UndoRecord) => { pendingRecord = record; return true; });
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
      configurable: true,
    });
  });
  afterEach(() => {
    const lockStubHost = globalThis.navigator as { locks?: unknown };
    delete lockStubHost.locks;
    pendingRecord = null;
  });

  /** A pass with more constructions than the retention window can hold, so
   *  an over-long window is observable rather than theoretical. */
  const longLanguageData = (count: number): LanguageData => ({
    language: 'ja',
    grammar: Array.from({ length: count }, (_v, i) => ({
      pattern: `p${i}`, meaning: `m${i}`, level: 2,
    })),
    grammarLevels: { difficulty: 'lower-is-harder', names: { '2': 'N3' } },
  } as unknown as LanguageData);

  /** Rates the revealed prompt fluent and waits for the journal write. */
  const rateOnce = async (container: HTMLElement, level = 2) => {
    const fluent = levelBlock(container, level).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    fluent.click();
    await beat();
  };

  it('a pass longer than the window keeps exactly the window takeable', async () => {
    // The window is the policy; the pass length is the learner's business. A
    // pass longer than the window must drop the oldest take-back entries, so
    // the number of ratings a learner can take back is the shared cap — never
    // the length of the pass they just did.
    const total = MAX_UNDO_STACK_SIZE + 5;
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, longLanguageData(total));
    await startPass(container, 2);

    let rated = 0;
    while (rated < MAX_UNDO_STACK_SIZE + 2) {
      if (container.querySelector('.grammar-coverage__session-done')) break;
      revealCurrent(container, 2);
      await tick();
      const fluent = levelBlock(container, 2).querySelector(
        '.study-encounter__response .rating-matrix__quality:nth-child(3)',
      ) as HTMLButtonElement | null;
      if (!fluent || fluent.disabled) break;
      await rateOnce(container, 2);
      rated += 1;
    }
    expect(rated).toBe(MAX_UNDO_STACK_SIZE + 2);

    // Unwind the take-back window one entry at a time and count it. The
    // shared window is finite, so the count is the cap however long the pass
    // was: a stack that grew with the pass (52 entries here) would let a
    // learner rewind every rating they had just made.
    let undos = 0;
    while (undoButton(container, 2) && undos < total + 5) {
      undoButton(container, 2)!.click();
      await tick();
      undos += 1;
    }
    expect(undos).toBe(MAX_UNDO_STACK_SIZE);
    dispose();
    container.remove();
    // 52 ratings + 50 undos, each gated by the presentation beat, exceeds the
    // default 5s.
  }, 60_000);

  it('a fresh pass starts a fresh take-back window (old ratings are not takeable)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    revealCurrent(container, 2);
    await tick();
    await rateOnce(container, 2);
    // A rating in pass 1 is live in the take-back window.
    expect(undoButton(container, 2)?.disabled).toBe(false);

    // Finish pass 1 and start a new pass over the same level.
    revealCurrent(container, 2);
    await tick();
    const stillOpen = levelBlock(container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement | null;
    if (stillOpen && !stillOpen.disabled) await rateOnce(container, 2);
    expect(container.querySelector('.grammar-coverage__session-done')).toBeTruthy();

    const practise = levelBlock(container, 2).querySelector('.grammar-coverage__session-btn') as HTMLButtonElement;
    practise.click();
    await tick();

    // The new pass begins with an EMPTY window: the previous pass's ratings
    // belong to a session that is gone, so the control is absent (there is
    // nothing to take back) rather than offering to rewind across passes.
    revealCurrent(container, 2);
    await tick();
    expect(undoButton(container, 2)).toBeNull();
    dispose();
    container.remove();
  });
});

describe('category-bottleneck pass order (R07 production reachability)', () => {
  const categorizedLanguageData = {
    language: 'ja',
    grammar: [
      { pattern: 'のに', meaning: 'even though', level: 2, category: 'concession' },
      { pattern: 'ば', meaning: 'conditional "if"', level: 2, category: 'conditional' },
    ],
    grammarLevels: { difficulty: 'lower-is-harder', names: { '2': 'N3' } },
  } as unknown as LanguageData;

  const categorizedSummary: CurriculumComponentSummary = {
    component: 'grammar',
    buckets: [{ level: 2, total: 2, known: 0, learning: 0, unknown: 0, unmeasured: 2 }],
    total: 2,
    known: 0,
    learning: 0,
    unknown: 0,
    unmeasured: 2,
    complete: false,
  };

  it('does not turn a category-pressure heuristic into a fitted learning effect', async () => {
    // 'ば' carries an actively measured failure (unknown state); its category
    // gains bottleneck pressure and wins the walk's first pick deterministically.
    const eventLog: KnowledgeEventLog = {
      [grammarEvidenceKey('ja', 'ば', 'grammar-recognition')]: [
        grammarRecognitionEvidence('ja', 'ば', { t: 1, kind: 'rating', quality: 'missed', easeAfter: 1.3 }),
      ],
    };
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const container = mount(vi.fn(), categorizedLanguageData, categorizedSummary, eventLog).container;
      await startPass(container, 2);
      const prompt = container.querySelector('.grammar-coverage__session-prompt');
      expect(prompt?.getAttribute('data-pattern')).toBe('のに');
      container.remove();
    } finally {
      randomSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Contrast pass (R12 validated question pipeline): package item sources,
// seeded MCQ assembly, submit-time grading with item provenance.
// ---------------------------------------------------------------------------

describe('GrammarCoverage contrast pass (R12 validated question pipeline)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Same Web Locks stub as the first describe (see its comment).
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
      configurable: true,
    });
  });
  afterEach(() => {
    const lockStubHost = globalThis.navigator as { locks?: unknown };
    delete lockStubHost.locks;
  });

  /**
   * Fixture semantic record: a test stand-in for an ACTUALLY-EXECUTED
   * independent validation (bound to the real item content). Production
   * packages carry no records until an authorized validator runs; the app
   * never fabricates one (R12). Unreviewed fixture data (no records) drives
   * the honest-availability test below.
   */
  const semanticFor = (source: GrammarPracticeItemSource): GrammarItemSemanticValidation => ({
    status: 'passed',
    validator: 'fixture-independent-validator@1',
    at: '2026-09-19T00:00:00Z',
    contentHash: itemContentVersion(source),
  });
  const withRecord = (source: GrammarPracticeItemSource): GrammarPracticeItemSource => {
    // Bind the record to the EXACT source shape the component assembles —
    // declared formats are part of the item content version, so the record
    // hash must see them too (item-v3).
    const declared: GrammarPracticeItemSource = { ...source, formats: ['mcq', 'typed'] };
    return { ...declared, validation: { semantic: semanticFor(declared) } };
  };
  const noniA: GrammarPracticeItemSource = {
    id: 'ja-test-noni-1',
    context: 'もう11時なのに、田中さんはまだ働いています。',
    answerSpan: 'のに',
    conditions: ['contrary-to-expectation'],
    distractors: [
      { span: 'から', violates: ['contrary-to-expectation'], rationale: 'reason must support the result' },
      { span: 'ので', violates: ['contrary-to-expectation'], rationale: 'soft reason contradicts まだ' },
    ],
    register: 'polite speech; a situation the speaker finds unexpected',
  };
  const noniB: GrammarPracticeItemSource = {
    id: 'ja-test-noni-2',
    context: '三時間も勉強したのに、テストは全然できませんでした。',
    answerSpan: 'のに',
    conditions: ['contrary-to-expectation'],
    distractors: [
      { span: 'から', violates: ['contrary-to-expectation'], rationale: 'causal reading contradicts the outcome' },
      { span: 'ので', violates: ['contrary-to-expectation'], rationale: 'soft causal reading contradicts the outcome' },
    ],
  };
  const ba: GrammarPracticeItemSource = {
    id: 'ja-test-ba-1',
    context: '安ければ、もっと買います。',
    answerSpan: 'ば',
    conditions: ['hypothetical-condition'],
    distractors: [
      { span: 'たら', violates: ['hypothetical-condition'], rationale: 'たら attaches to the past form and marks a realized condition' },
      { span: 'のに', violates: ['hypothetical-condition'], rationale: 'のに marks a concession, not a condition' },
    ],
  };
  const contrastData = {
    ...languageData,
    grammar: [
      {
        pattern: 'のに', meaning: 'even though', meanings: { de: 'obwohl (trotzdem)' }, level: 2,
        items: [withRecord(noniA), withRecord(noniB)],
      },
      {
        pattern: 'ば', meaning: 'conditional "if"', level: 2,
        items: [withRecord(ba)],
      },
      { pattern: 'たびに', meaning: 'every time', meanings: { de: 'jedes Mal' }, level: 3 },
    ],
  } as unknown as LanguageData;
  it('preserves Home recall admission when a validated contrast item is also available', async () => {
    const handoff = { id: 'saved-home-recall', at: 1, policyVersion: 'home-test', selected: {
      key: 'grammar:ば', action: 'grammar', targets: [{ kind: 'grammar-pattern', id: 'ja:grammar:ば', capability: 'grammar-recognition' }],
      task: { taskTemplateId: 'grammar-self-assess', inputModality: 'activity-handoff', responseModality: 'none', supplied: [], requested: ['grammar-recognition'], fluencyRequired: false, ratingMode: 'profile' as const },
    }, baseline: null, detail: {} };
    const onProbe = vi.fn();
    const mounted = mount(onProbe, contrastData, undefined, undefined, undefined,
      () => ({ level: 2, requestedAt: 0, patterns: ['ば'], handoffDecision: handoff }), undefined, passThroughLocks, false, ['ば']);
    await tick();
    expect(mounted.container.querySelector('.grammar-contrast')).toBeNull();
    expect(promptedPattern(mounted.container, 2)).toBe('ば');
    const stored = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    expect(stored.queue[0].decision.detail.handoffRef).toEqual({ id: handoff.id });
    revealCurrent(mounted.container, 2);
    (mounted.container.querySelector('.study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await tick();
    expect(onProbe.mock.calls[0][4]).toMatchObject({ taskType: 'grammar-self-assess', method: 'recall',
      decision: { detail: { handoffRef: { id: handoff.id } } } });
    mounted.dispose(); mounted.container.remove();
  });

  /** Unreviewed variant of the SAME package: no semantic records anywhere. */
  const unreviewedData = {
    ...languageData,
    grammar: [
      { pattern: 'のに', meaning: 'even though', level: 2, items: [noniA, noniB] },
      { pattern: 'ば', meaning: 'conditional "if"', level: 2, items: [ba] },
      { pattern: 'たびに', meaning: 'every time', level: 3 },
    ],
  } as unknown as LanguageData;
  const fixtureVersion = (itemId: string): string => itemContentVersion(
    { ...[noniA, noniB, ba].find((source) => source.id === itemId)!, formats: ['mcq', 'typed'] },
  );
  /** Version of the RAW unreviewed fixtures (no declared formats). */
  const rawFixtureVersion = (itemId: string): string => itemContentVersion(
    [noniA, noniB, ba].find((source) => source.id === itemId)!,
  );

  const contrastSummary: CurriculumComponentSummary = {
    component: 'grammar',
    buckets: [
      { level: 2, total: 2, known: 0, learning: 0, unknown: 0, unmeasured: 2 },
      { level: 3, total: 1, known: 0, learning: 0, unknown: 0, unmeasured: 1 },
    ],
    total: 3,
    known: 0,
    learning: 0,
    unknown: 0,
    unmeasured: 3,
    complete: false,
  };

  const startContrast = async (container: HTMLElement, level: number) => {
    await expand(container, level);
    const button = levelBlock(container, level).querySelector('.grammar-coverage__contrast-btn') as HTMLButtonElement;
    expect(button, `contrast button at level ${level}`).toBeTruthy();
    expect(button.disabled).toBe(false);
    button.click();
    await tick();
  };

  // The policy pick between two weight-1 candidates is rng-random: read the
  // presented step instead of assuming an order.
  const currentItem = (container: HTMLElement, level: number): { pattern: string; itemId: string; gold: string; version: string } => {
    const context = levelBlock(container, level).querySelector('.grammar-contrast__context') as HTMLElement;
    const pattern = levelBlock(container, level).querySelector('.grammar-contrast')?.getAttribute('data-pattern') as string;
    const itemId = context.getAttribute('data-item-id') as string;
    const gold = pattern === 'のに' ? 'のに' : 'ば';
    return { pattern, itemId, gold, version: fixtureVersion(itemId) };
  };

  it('offers the Contrast pass only where the package declares deliverable items (G04)', async () => {
    const { container, dispose } = mount(vi.fn(), contrastData, contrastSummary);
    await expand(container, 2);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__contrast-btn')).toBeTruthy();
    // Level 3 (たびに) has no item sources: no invented questions, Practise stays.
    await expand(container, 3);
    expect(levelBlock(container, 3).querySelector('.grammar-coverage__contrast-btn')).toBeNull();
    expect(levelBlock(container, 3).querySelector('.grammar-coverage__session-btn')).toBeTruthy();
    dispose();
    container.remove();

    // STRICT gate (R12): the same package WITHOUT an executed independent
    // semantic validation offers NO contrast questions — unreviewed items are
    // never served as established discrimination. The regular Practise walk
    // stays available (G04 fallback to real compatible activities).
    const unreviewed = mount(vi.fn(), unreviewedData, contrastSummary);
    await expand(unreviewed.container, 2);
    expect(levelBlock(unreviewed.container, 2).querySelector('.grammar-coverage__contrast-btn')).toBeNull();
    expect(levelBlock(unreviewed.container, 2).querySelector('.grammar-coverage__session-btn')).toBeTruthy();
    unreviewed.dispose();
    unreviewed.container.remove();
    dispose();
    container.remove();
  });

  it('delivers the seeded MCQ without the gold answer; grades with item provenance (G02)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);

    const current = currentItem(container, 2);
    const context = levelBlock(container, 2).querySelector('.grammar-contrast__context') as HTMLElement;
    expect(context.getAttribute('data-item-id')).toBe(current.itemId);
    expect(context.textContent).not.toContain(current.gold); // span removed
    const options = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    expect(options).toHaveLength(3);
    expect(options.map((option) => option.getAttribute('data-option'))).toContain(current.gold);
    // No correctness marker exists anywhere before the graded submission.
    expect(options.every((option) => option.className === 'grammar-contrast__option')).toBe(true);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback')).toBeNull();

    const goldIndex = options.findIndex((option) => option.getAttribute('data-option') === current.gold);
    options[goldIndex].click();
    await tick();

    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][0]).toBe(current.pattern);
    expect(onProbe.mock.calls[0][1]).toBe('struggled'); // one successful MCQ attempt is not proof of mastery (R13)
    expect(onProbe.mock.calls[0][2]).toBe(2);
    expect(onProbe.mock.calls[0][3]).toBeUndefined();
    expect(onProbe.mock.calls[0][4]).toMatchObject({
      itemRef: { id: current.itemId, version: current.version, seed: expect.any(Number) },
      validationRef: {
        validator: 'fixture-independent-validator@1',
        at: '2026-09-19T00:00:00Z',
        contentHash: current.version,
      },
      taskType: 'contrast-mcq',
      decision: { selected: { task: { taskTemplateId: 'contrast-mcq', responseModality: 'multiple-choice' },
        presentation: { itemRef: { id: current.itemId, version: current.version } } } },
    });
    // Post-answer marking only: gold highlighted, feedback shown, options locked.
    const after = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    expect(after[goldIndex].className).toContain('grammar-contrast__option--gold');
    expect(after.every((option) => option.disabled)).toBe(true);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback--correct')).toBeTruthy();

    // Explicit advance: two item-backed constructions are queued, so the next
    // step (or the done state) appears — never a stuck or restarted pass.
    (levelBlock(container, 2).querySelector('.grammar-contrast__next') as HTMLButtonElement).click();
    await tick();
    expect(
      levelBlock(container, 2).querySelector('.grammar-coverage__session-done')
      || levelBlock(container, 2).querySelector('.grammar-contrast'),
    ).toBeTruthy();
    dispose();
    container.remove();
  });

  it('maps a wrong selection to missed and shows the answer in feedback', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    const current = currentItem(container, 2);
    const options = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    const wrongIndex = options.findIndex((option) => option.getAttribute('data-option') !== current.gold);
    options[wrongIndex].click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][1]).toBe('missed');
    const feedback = levelBlock(container, 2).querySelector('.grammar-contrast__feedback--incorrect');
    // The t() mock echoes keys: the feedback row identifies the incorrect outcome.
    expect(feedback?.textContent).toBe('mlearn.LevelStudy.Grammar.Incorrect');
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback--correct')).toBeNull();
    dispose();
    container.remove();
  });

  it('a rapid second option click never double-grades (G01)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    const options = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    options[0].click();
    options[1].click(); // same-tick second selection
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });

  it('skip advances without recording anything (G04)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    // Two item-backed constructions are queued: skipping walks them all without recording.
    (levelBlock(container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement).click();
    await beat();
    expect(levelBlock(container, 2).querySelector('.grammar-contrast')).toBeTruthy();
    (levelBlock(container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement).click();
    await tick();
    expect(onProbe).not.toHaveBeenCalled();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-done')).toBeTruthy();
    dispose();
    container.remove();
  });

  it('walks every item-backed construction once, in policy order, with no repeats', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    const seen: string[] = [];
    for (let step = 0; step < 2; step += 1) {
      const pattern = levelBlock(container, 2).querySelector('.grammar-contrast')?.getAttribute('data-pattern');
      expect(pattern).toBeTruthy();
      seen.push(pattern as string);
      const options = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
      const goldIndex = options.findIndex((option) => option.getAttribute('data-option') === pattern);
      options[goldIndex].click();
      await beat();
      (levelBlock(container, 2).querySelector('.grammar-contrast__next') as HTMLButtonElement).click();
      await beat();
    }
    expect(seen.sort()).toEqual(['のに', 'ば']);
    expect(onProbe).toHaveBeenCalledTimes(2);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-done')).toBeTruthy();
    dispose();
    container.remove();
  });

  it('a stored contrast pass resumes from its own key; a pass whose item was retired is discarded (G03)', async () => {
    globalThis.localStorage?.setItem(
      'mlearn-study-grammar:ja',
      JSON.stringify(storedGrammarSession('ja', 2, ['のに', 'ば'], 'contrast')),
    );
    const resumed = mount(vi.fn(), contrastData, contrastSummary);
    await expand(resumed.container, 2);
    expect(resumed.container.querySelector('.grammar-contrast__context')).toBeTruthy();
    resumed.dispose();
    resumed.container.remove();

    // The same stored pass under a package without items: retired → discarded.
    const stale = mount(vi.fn());
    await expand(stale.container, 2);
    expect(stale.container.querySelector('.grammar-contrast__context')).toBeNull();
    expect(levelBlock(stale.container, 2).querySelector('.grammar-coverage__session-btn')).toBeTruthy();
    stale.dispose();
    stale.container.remove();
  });

  it('discards a stored contrast pass when its queued item is no longer deliverable', async () => {
    globalThis.localStorage?.setItem(
      'mlearn-study-grammar:ja',
      JSON.stringify(storedGrammarSession('ja', 2, ['のに'], 'contrast')),
    );
    const rejected = {
      ...contrastData,
      grammar: contrastData.grammar?.map((point) => point.pattern === 'のに'
        ? {
            ...point,
            items: point.items?.map((source) => ({
              ...source,
              validation: { semantic: { ...semanticFor(source), status: 'rejected' as const } },
            })),
          }
        : point),
    } as LanguageData;
    const mounted = mount(vi.fn(), rejected, contrastSummary);
    await expand(mounted.container, 2);
    expect(mounted.container.querySelector('.grammar-contrast')).toBeNull();
    expect(levelBlock(mounted.container, 2).querySelector('.grammar-coverage__session-btn')).toBeTruthy();
    mounted.dispose();
    mounted.container.remove();
  });

  it('resumes the deliverable subset when a level also contains unreviewed items', async () => {
    const mixed = {
      ...contrastData,
      grammar: contrastData.grammar?.map((point) => point.pattern === 'ば'
        ? { ...point, items: [ba] }
        : point),
    } as LanguageData;
    globalThis.localStorage?.setItem(
      'mlearn-study-grammar:ja',
      JSON.stringify(storedGrammarSession('ja', 2, ['のに'], 'contrast')),
    );
    const mounted = mount(vi.fn(), mixed, contrastSummary);
    await expand(mounted.container, 2);
    expect(mounted.container.querySelector('.grammar-contrast[data-pattern="のに"]')).toBeTruthy();
    mounted.dispose();
    mounted.container.remove();
  });

  it('keeps one durable pass per language and permits a new kind after completion', async () => {
    localStorage.setItem('mlearn-study-grammar:ja', JSON.stringify(storedGrammarSession('ja', 2, ['のに', 'ば'])));
    const onProbe = vi.fn();
    const first = mount(onProbe, contrastData, contrastSummary);
    await expand(first.container, 2);
    expect(first.container.querySelector('.study-encounter__response')).toBeTruthy();
    expect(first.container.querySelector('.grammar-contrast')).toBeNull();
    const fluent = () => levelBlock(first.container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    revealCurrent(first.container, 2);
    fluent().click();
    await beat();
    revealCurrent(first.container, 2);
    fluent().click();
    await beat();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).index).toBe(2);
    const contrast = levelBlock(first.container, 2).querySelector<HTMLButtonElement>('.grammar-coverage__contrast-btn');
    expect(contrast?.disabled).toBe(false);
    contrast?.click();
    await tick();
    expect(levelBlock(first.container, 2).querySelector('.grammar-contrast')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).meta.kind).toBe('contrast');
    first.dispose();
    first.container.remove();
  });

  it('a live contrast pass survives inspection of another level without blocking its explicit Start', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    // Expanding another level collapses this one (single-expansion UI); the
    // contrast pass must survive and other entries must stay paused.
    await expand(container, 3);
    const level3 = levelBlock(container, 3);
    expect(level3.querySelector<HTMLButtonElement>('.grammar-coverage__session-btn')?.disabled).toBe(false);
    expect(container.querySelectorAll('.grammar-contrast').length).toBe(0); // collapsed, not leaked
    await expand(container, 2);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast')).toBeTruthy();
    dispose();
    container.remove();
  });

  it('offers typing as a declared format and grades with input provenance (R12/G05)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    const current = currentItem(container, 2);
    // The package declares both formats: the toggle exists.
    const typedButton = levelBlock(container, 2).querySelector('.grammar-contrast__mode-btn[data-format="typed"]') as HTMLButtonElement;
    expect(typedButton).toBeTruthy();
    typedButton.click();
    await tick();
    const input = levelBlock(container, 2).querySelector('.grammar-contrast__typed-input') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option').length).toBe(0);
    const contextText = (levelBlock(container, 2).querySelector('.grammar-contrast__context') as HTMLElement).textContent ?? '';
    expect(contextText).not.toContain(current.gold); // the typed surface leaks no answer either
    // Empty input: no submission possible.
    const submit = levelBlock(container, 2).querySelector('.grammar-contrast__submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // A WRONG typed answer (plain keyboard) records the contrast-typed task.
    input.value = 'wrong-form';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(submit.disabled).toBe(false);
    submit.click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][1]).toBe('missed');
    expect(onProbe.mock.calls[0][3]).toBeUndefined(); // keyboard supplied nothing to record
    expect(onProbe.mock.calls[0][4]).toMatchObject({
      itemRef: { id: current.itemId, version: current.version, seed: expect.any(Number) },
      validationRef: {
        validator: 'fixture-independent-validator@1',
        at: '2026-09-19T00:00:00Z',
        contentHash: current.version,
      },
      taskType: 'contrast-typed',
      decision: { selected: { task: { taskTemplateId: 'contrast-typed', responseModality: 'typed' },
        presentation: { itemRef: { id: current.itemId, version: current.version } } } },
    });
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback--incorrect')).toBeTruthy();
    dispose();
    container.remove();
  });

  it('uses typed delivery when it is the only declared format and rejects an empty format declaration', async () => {
    const typedDeclared: GrammarPracticeItemSource = { ...noniA, formats: ['typed'] };
    const typedSource: GrammarPracticeItemSource = {
      ...typedDeclared,
      validation: { semantic: semanticFor(typedDeclared) },
    };
    const typedOnly = {
      ...contrastData,
      grammar: [{ pattern: 'のに', meaning: 'even though', level: 2, items: [typedSource] }],
    } as unknown as LanguageData;
    const typedSummary = {
      ...contrastSummary,
      buckets: [{ level: 2, total: 1, known: 0, learning: 0, unknown: 0, unmeasured: 1 }],
      total: 1,
      unmeasured: 1,
    };
    const typed = mount(vi.fn(), typedOnly, typedSummary);
    await startContrast(typed.container, 2);
    expect(typed.container.querySelector('.grammar-contrast__typed-input')).toBeTruthy();
    expect(typed.container.querySelector('.grammar-contrast__option')).toBeNull();
    typed.dispose();
    typed.container.remove();

    const emptyFormats = {
      ...typedOnly,
      grammar: [{
        pattern: 'のに', meaning: 'even though', level: 2,
        items: [{ ...typedSource, formats: [] }],
      }],
    } as unknown as LanguageData;
    const empty = mount(vi.fn(), emptyFormats, typedSummary);
    await expand(empty.container, 2);
    expect(empty.container.querySelector('.grammar-coverage__contrast-btn')).toBeNull();
    empty.dispose();
    empty.container.remove();
  });

  it('a correct typed answer maps to struggled and IME composition is provenance, never an error (G05)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    const current = currentItem(container, 2);
    (levelBlock(container, 2).querySelector('.grammar-contrast__mode-btn[data-format="typed"]') as HTMLButtonElement).click();
    await tick();
    const input = levelBlock(container, 2).querySelector('.grammar-contrast__typed-input') as HTMLInputElement;
    // The answer arrives through IME composition (normal CJK input).
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    input.value = current.gold;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(composingEnter, 'isComposing', { value: true });
    input.dispatchEvent(composingEnter);
    await tick();
    expect(onProbe).not.toHaveBeenCalled();
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback')).toBeNull();
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    const submit = levelBlock(container, 2).querySelector('.grammar-contrast__submit') as HTMLButtonElement;
    submit.click();
    await tick();
    expect(onProbe.mock.calls[0][1]).toBe('struggled'); // one correct answer is not proof of mastery (R13)
    expect(onProbe.mock.calls[0][3]).toEqual({ 'ime-composition': true });
    expect(onProbe.mock.calls[0][4]).toMatchObject({ taskType: 'contrast-typed' });
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback--correct')).toBeTruthy();
    dispose();
    container.remove();
  });

  it('mode switching stays available before grading and disappears after it (G01)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    // Typed → back to MCQ: the option surface returns, nothing recorded.
    (levelBlock(container, 2).querySelector('.grammar-contrast__mode-btn[data-format="typed"]') as HTMLButtonElement).click();
    await tick();
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__typed-input')).toBeTruthy();
    (levelBlock(container, 2).querySelector('.grammar-contrast__mode-btn[data-format="mcq"]') as HTMLButtonElement).click();
    await tick();
    expect(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option').length).toBe(3);
    expect(onProbe).not.toHaveBeenCalled();
    // After grading, the toggle is gone for the answered question (the
    // format of the RECORDED attempt must not silently change, G01).
    const options = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    options[0].click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__modes')).toBeNull();
    dispose();
    container.remove();
  });

  it('serving alternates items: the least-attempted deliverable item is presented (G02)', async () => {
    const noniKey = grammarEvidenceKey('ja', 'のに', 'grammar-recognition');
    const versionOf = (id: string) => fixtureVersion(id);
    const logWithAttempts = (ids: string[]): KnowledgeEventLog => ({
      [noniKey]: ids.map((id, index) => grammarRecognitionEvidence('ja', 'のに', {
        t: 1000 + index,
        kind: 'rating',
        quality: 'struggled',
        itemRef: { id, version: versionOf(id) },
      })),
    });
    // The journal shows ja-test-noni-1 attempted once: the pass must present
    // the OTHER item for the same construction when it comes up — repeated
    // serving of one memorized item is not fresh practice (G02).
    const primed = mount(vi.fn(), contrastData, contrastSummary, logWithAttempts(['ja-test-noni-1']));
    await startContrast(primed.container, 2);
    for (let step = 0; step < 3; step += 1) {
      const block = primed.container.querySelector('.grammar-contrast');
      if (block === null) break;
      const pattern = block.getAttribute('data-pattern');
      const itemId = (levelBlock(primed.container, 2).querySelector('.grammar-contrast__context') as HTMLElement).getAttribute('data-item-id');
      if (pattern === 'のに') expect(itemId).toBe('ja-test-noni-2');
      const skip = levelBlock(primed.container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement;
      skip.click();
      await beat();
    }
    primed.dispose();
    primed.container.remove();

    // Equal attempt history (both items once): the tie resolves to package
    // order — deterministic across resumes.
    const even = mount(vi.fn(), contrastData, contrastSummary, logWithAttempts(['ja-test-noni-1', 'ja-test-noni-2']));
    await startContrast(even.container, 2);
    for (let step = 0; step < 3; step += 1) {
      const block = even.container.querySelector('.grammar-contrast');
      if (block === null) break;
      const pattern = block.getAttribute('data-pattern');
      const itemId = (levelBlock(even.container, 2).querySelector('.grammar-contrast__context') as HTMLElement).getAttribute('data-item-id');
      if (pattern === 'のに') expect(itemId).toBe('ja-test-noni-1');
      const skip = levelBlock(even.container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement;
      skip.click();
      await beat();
    }
    even.dispose();
    even.container.remove();
  });

  it('pins an answered item across a journal refresh and remount (G01/G03)', async () => {
    const onProbe = vi.fn();
    const first = mount(onProbe, contrastData, contrastSummary);
    await startContrast(first.container, 2);

    // Reach the construction with two deliverable items. With equal history
    // the package-order item is presented first.
    if (currentItem(first.container, 2).pattern !== 'のに') {
      (levelBlock(first.container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement).click();
      await beat();
    }
    const presented = currentItem(first.container, 2);
    expect(presented.pattern).toBe('のに');
    expect(presented.itemId).toBe('ja-test-noni-1');
    const options = Array.from(levelBlock(first.container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    options.find((option) => option.getAttribute('data-option') === presented.gold)!.click();
    await tick();

    const itemRef = onProbe.mock.calls[0][4].itemRef as { id: string; version: string; seed: number };
    expect(itemRef.id).toBe(presented.itemId);
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!);
    expect(stored.answered.itemRef).toEqual(itemRef);
    first.dispose();
    first.container.remove();

    // Recording A makes B the least-attempted item. Resume must nevertheless
    // render the pinned A whose durable marker owns the feedback, not reselect
    // B and consume it without an attempt.
    const refreshedLog: KnowledgeEventLog = {
      [grammarEvidenceKey('ja', 'のに', 'grammar-recognition')]: [
        grammarRecognitionEvidence('ja', 'のに', {
          t: 2000,
          kind: 'rating',
          quality: 'struggled',
          itemRef,
        }),
      ],
    };
    const resumed = mount(vi.fn(), contrastData, contrastSummary, refreshedLog);
    await expand(resumed.container, 2);
    expect(currentItem(resumed.container, 2).itemId).toBe(presented.itemId);
    expect(levelBlock(resumed.container, 2).querySelector('.grammar-contrast__feedback--correct')).toBeTruthy();
    resumed.dispose();
    resumed.container.remove();
  });

  it('pins and automatically reconciles a journal-visible pending contrast item after remount (G01/G03)', async () => {
    const interrupted = vi.fn(() => new Promise<void>(() => {}));
    const first = mount(interrupted, contrastData, contrastSummary);
    await startContrast(first.container, 2);
    if (currentItem(first.container, 2).pattern !== 'のに') {
      (levelBlock(first.container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement).click();
      await beat();
    }
    const presented = currentItem(first.container, 2);
    expect(presented.itemId).toBe('ja-test-noni-1');
    const options = Array.from(levelBlock(first.container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    options.find((option) => option.getAttribute('data-option') === presented.gold)!.click();
    await tick();

    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!);
    const attemptId = stored.pending.attemptId as string;
    const itemRef = stored.pending.answer.itemRef as { id: string; version: string; seed: number };
    first.dispose();
    first.container.remove();

    const refreshedLog: KnowledgeEventLog = {
      [grammarEvidenceKey('ja', 'のに', 'grammar-recognition')]: [
        grammarRecognitionEvidence('ja', 'のに', {
          t: 2000,
          kind: 'rating',
          quality: 'struggled',
          attemptId,
          itemRef,
        }),
      ],
    };
    const resumedProbe = vi.fn().mockResolvedValue(undefined);
    const resumed = mount(resumedProbe, contrastData, contrastSummary, refreshedLog);
    await expand(resumed.container, 2);

    expect(currentItem(resumed.container, 2).itemId).toBe(presented.itemId);
    await beat();
    expect(resumedProbe).toHaveBeenCalledTimes(1);
    expect(resumedProbe.mock.calls[0][4]).toMatchObject({ attemptId, itemRef });
    expect(currentItem(resumed.container, 2).itemId).toBe(presented.itemId);
    expect(levelBlock(resumed.container, 2).querySelector('.grammar-contrast__feedback--correct')).toBeTruthy();
    const settled = JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!);
    expect(settled.pending).toBeUndefined();
    expect(settled.answered.itemRef).toEqual(itemRef);
    resumed.dispose();
    resumed.container.remove();
  });

  // --- Independent validation producer control (R12): the ONLY writer of
  // semantic records in the app — user-triggered, batched off the rating
  // path, honest about failures and named external dependencies. ---

  afterEach(() => {
    llmHarness.handler = null;
    llmHarness.calls = 0;
    settingsLlmProvider = 'builtin';
  });

  const spanForId = (id: string): string => (id.startsWith('ja-test-ba') ? 'ば' : 'のに');
  const fakeValidatorReply = async (messages: readonly unknown[]): Promise<string> => {
    const user = messages[1];
    if (user === null || typeof user !== 'object' || !('content' in user) || typeof user.content !== 'string') {
      throw new Error('fixture validator messages must be chat messages');
    }
    const payload = JSON.parse(user.content.split('\n')[1]) as Array<{ id: string }>;
    return JSON.stringify({
      items: payload.map((entry) => ({
        id: entry.id,
        natural: true,
        objectiveAligned: true,
        legitimateAnswers: [spanForId(entry.id)],
        distractorsMeaningful: true,
        accidentalClues: false,
        reasons: ['fixture: the discrimination holds and exactly one form fits'],
      })),
    });
  };
  const settle = async (condition: () => boolean): Promise<void> => {
    for (let i = 0; i < 200 && !condition(); i += 1) await tick();
  };
  const validateButton = (container: HTMLElement, level: number): HTMLButtonElement =>
    levelBlock(container, level).querySelector('[data-testid="grammar-validate-btn"]') as HTMLButtonElement;
  const validateStatus = (container: HTMLElement, level: number): HTMLElement =>
    levelBlock(container, level).querySelector('[data-testid="grammar-validate-status"]') as HTMLElement;

  it('offers the validate control exactly where declared items still await an executed validation', async () => {
    // Unreviewed package: items exist, no records — validate appears next to
    // the (absent) contrast button, and Practise stays available (G04).
    const pending = mount(vi.fn(), unreviewedData, contrastSummary);
    await expand(pending.container, 2);
    expect(validateButton(pending.container, 2)).toBeTruthy();
    expect(levelBlock(pending.container, 2).querySelector('.grammar-coverage__contrast-btn')).toBeNull();
    // A level without declared items never offers validation.
    await expand(pending.container, 3);
    expect(validateButton(pending.container, 3)).toBeFalsy();
    pending.dispose();
    pending.container.remove();

    // Fully validated package (records attached): nothing awaits validation.
    const settled = mount(vi.fn(), contrastData, contrastSummary);
    await expand(settled.container, 2);
    expect(validateButton(settled.container, 2)).toBeFalsy();
    settled.dispose();
    settled.container.remove();
  });

  it('runs the producer, persists content-bound records, and notifies the owner (single-flight)', async () => {
    const onValidated = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    llmHarness.handler = (messages, callbacks) => {
      void gate.then(async () => callbacks.onDone(await fakeValidatorReply(messages)));
    };
    const { container, dispose } = mount(vi.fn(), unreviewedData, contrastSummary, undefined, onValidated);
    await expand(container, 2);
    validateButton(container, 2).click();
    await tick();
    // Single-flight (G01): the control is locked while the run is live, and a
    // second click cannot start a second batch run.
    expect(validateButton(container, 2).disabled).toBe(true);
    validateButton(container, 2).click();
    await tick();
    expect(llmHarness.calls).toBe(1);
    release();
    await settle(() => onValidated.mock.calls.length > 0);
    expect(onValidated).toHaveBeenCalledTimes(1);
    expect(validateButton(container, 2).disabled).toBe(false);
    const status = validateStatus(container, 2);
    expect(status.getAttribute('data-errors')).toBeNull();
    expect(status.textContent).toBe('mlearn.LevelStudy.Grammar.ValidateDone');

    // Records persist bound to the EXACT item content version (R12/G03).
    const records = loadQuestionValidationRecords('ja');
    expect(records.size).toBe(3);
    const hashes = new Set([...records.keys()].map((key) => key.split('\u0000')[1]));
    expect(hashes).toEqual(new Set([
      rawFixtureVersion('ja-test-noni-1'),
      rawFixtureVersion('ja-test-noni-2'),
      rawFixtureVersion('ja-test-ba-1'),
    ]));
    for (const record of records.values()) {
      expect(record.status).toBe('passed');
      expect(record.validator).toBe('mlearn-llm:builtin');
      expect(record.validatorVersion).toBe('fixture-local-model');
      expect(record.reasons?.length).toBeGreaterThan(0);
    }
    dispose();
    container.remove();
  });

  it('refuses a cloud provider without any paid call and reports the named dependency', async () => {
    settingsLlmProvider = 'cloud';
    const onValidated = vi.fn();
    const { container, dispose } = mount(vi.fn(), unreviewedData, contrastSummary, undefined, onValidated);
    await expand(container, 2);
    validateButton(container, 2).click();
    await settle(() => validateStatus(container, 2) !== null && llmHarness.calls === 0 && onValidated.mock.calls.length > 0);
    const status = validateStatus(container, 2);
    expect(status.getAttribute('data-errors')).toBe('true');
    expect(status.textContent).toBe('mlearn.LevelStudy.Grammar.ValidateFailed');
    expect(llmHarness.calls).toBe(0); // the producer refused before contacting anything
    expect(loadQuestionValidationRecords('ja').size).toBe(0);
    expect(onValidated).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });

  it('reports provider failure honestly and never fabricates a record', async () => {
    // Default harness handler: onError('bridge-unavailable').
    const onValidated = vi.fn();
    const { container, dispose } = mount(vi.fn(), unreviewedData, contrastSummary, undefined, onValidated);
    await expand(container, 2);
    validateButton(container, 2).click();
    await settle(() => validateStatus(container, 2) !== null);
    const status = validateStatus(container, 2);
    expect(status.getAttribute('data-errors')).toBe('true');
    expect(status.textContent).toBe('mlearn.LevelStudy.Grammar.ValidateFailed');
    expect(loadQuestionValidationRecords('ja').size).toBe(0); // nothing invented
    expect(onValidated).toHaveBeenCalledTimes(1); // the owner still re-resolves
    dispose();
    container.remove();
  });

  it('a second window adopting an answered step re-renders the feedback and never re-probes (G01)', async () => {
    const probeA = vi.fn();
    const tabA = mount(probeA, contrastData, contrastSummary);
    await startContrast(tabA.container, 2);
    const stepA = currentItem(tabA.container, 2);
    const optionsA = Array.from(levelBlock(tabA.container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    optionsA[optionsA.findIndex((option) => option.getAttribute('data-option') === stepA.gold)].click();
    await beat();
    expect(probeA).toHaveBeenCalledTimes(1);

    // The window that never answered mounts AFTER the answer: the durable
    // answered marker restores the graded feedback — not a fresh question —
    // and its consumed controls cannot append a second probe.
    const probeB = vi.fn();
    const tabB = mount(probeB, contrastData, contrastSummary);
    await expand(tabB.container, 2);
    expect(levelBlock(tabB.container, 2).querySelector('.grammar-contrast__feedback')).toBeTruthy();
    const optionsB = Array.from(levelBlock(tabB.container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    for (const option of optionsB) expect(option.disabled).toBe(true);
    // Advancing consumes the step exactly once: no evidence, marker cleared.
    (levelBlock(tabB.container, 2).querySelector('.grammar-contrast__next') as HTMLButtonElement).click();
    await beat();
    expect(probeB).not.toHaveBeenCalled();
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!);
    expect(stored.index).toBe(1);
    expect(stored.answered).toBeUndefined();
    tabA.dispose();
    tabB.dispose();
    tabA.container.remove();
    tabB.container.remove();
  });

  it('serializes two windows behind the pass lock: exactly one probe survives one presentation (G01)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Pass-through for the two START claims, then hold the gate so both
    // windows' answers queue and serialize behind the mutual-exclusion lock
    // (MockExam.test convention).
    let claims = 0;
    let tail = gate;
    const gating: StudySessionLocks = {
      request: async (_name: string, callback: () => void | Promise<void>) => {
        claims += 1;
        if (claims <= 2) { await callback(); return; }
        const previous = tail;
        let releaseNext!: () => void;
        tail = new Promise<void>((resolve) => { releaseNext = resolve; });
        await previous;
        try { await callback(); } finally { releaseNext(); }
      },
    };
    const probeA = vi.fn();
    const probeB = vi.fn();
    const tabA = mount(probeA, contrastData, contrastSummary, undefined, undefined, undefined, undefined, gating);
    const tabB = mount(probeB, contrastData, contrastSummary, undefined, undefined, undefined, undefined, gating);

    await startContrast(tabA.container, 2);
    // B's start ADOPTS the live pass A holds instead of starting a second one.
    await startContrast(tabB.container, 2);
    expect(currentItem(tabB.container, 2).pattern).toBe(currentItem(tabA.container, 2).pattern);

    const clickGold = (harness: { container: HTMLElement }): void => {
      const options = Array.from(levelBlock(harness.container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
      const goldIndex = options.findIndex((option) => option.getAttribute('data-option') === currentItem(harness.container, 2).gold);
      options[goldIndex].click();
    };
    clickGold(tabA);
    clickGold(tabB);
    // The gate is held: neither answer has run.
    expect(probeA).not.toHaveBeenCalled();
    expect(probeB).not.toHaveBeenCalled();
    release();
    await tick();
    await tick();
    // Exactly ONE probe survives the mutual exclusion; the stale second
    // answer is dropped with the durable answered state adopted (both
    // windows show the same graded feedback).
    expect(probeA.mock.calls.length + probeB.mock.calls.length).toBe(1);
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!);
    expect(stored.index).toBe(0);
    expect(stored.answered?.index).toBe(0);
    expect(levelBlock(tabA.container, 2).querySelector('.grammar-contrast__feedback')).toBeTruthy();
    expect(levelBlock(tabB.container, 2).querySelector('.grammar-contrast__feedback')).toBeTruthy();

    // The winner advances (after the presentation beat); the loser adopts
    // the advanced presentation through the storage event — one step
    // consumed, zero further probes.
    await beat();
    (levelBlock(tabA.container, 2).querySelector('.grammar-contrast__next') as HTMLButtonElement).click();
    await beat();
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'mlearn-study-grammar:ja',
      newValue: globalThis.localStorage!.getItem('mlearn-study-grammar:ja'),
    }));
    await tick();
    await tick();
    expect(probeA.mock.calls.length + probeB.mock.calls.length).toBe(1);
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!).index).toBe(1);
    expect(levelBlock(tabB.container, 2).querySelector('.grammar-contrast__feedback')).toBeNull();
    tabA.dispose();
    tabB.dispose();
    tabA.container.remove();
    tabB.container.remove();
  });

  it('a durable-write failure refuses the answer: no probe, question retryable, honest note (G01/G04)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    // Quota injection BEFORE the answer: the answered-marker write throws,
    // so no marker exists and the probe must be refused.
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    const options = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    options[0].click();
    await beat();
    expect(onProbe).not.toHaveBeenCalled();
    setItem.mockRestore();

    // The question stays retryable (no feedback consumed it) and the
    // refusal is surfaced; a retry after storage recovers records exactly
    // one probe and writes the marker.
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback')).toBeNull();
    expect(container.querySelector('[data-testid="grammar-storage-unavailable"]')).toBeTruthy();
    const step = currentItem(container, 2);
    const retryOptions = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    retryOptions[retryOptions.findIndex((option) => option.getAttribute('data-option') === step.gold)].click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="grammar-storage-unavailable"]')).toBeNull();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!).answered?.index).toBe(0);
    dispose();
    container.remove();
  });

  it.each(['item', 'validator'] as const)('refuses a saved contrast admission with a changed %s binding', async field => {
    const first = mount(vi.fn(), contrastData, contrastSummary);
    await startContrast(first.container, 2);
    const stored = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    first.dispose(); first.container.remove();
    if (field === 'item') stored.queue[0].contrast.itemRef.version = 'different-version';
    else stored.queue[0].contrast.decisions.mcq.selected.presentation.validationRef.validator = 'different-validator';
    localStorage.setItem('mlearn-study-grammar:ja', JSON.stringify(stored));
    const onProbe = vi.fn();
    const restarted = mount(onProbe, contrastData, contrastSummary);
    await expand(restarted.container, 2);
    expect(restarted.container.querySelector('.grammar-contrast')).toBeNull();
    expect(onProbe).not.toHaveBeenCalled();
    restarted.dispose(); restarted.container.remove();
  });

  it('pins the presented item across new journal counts, format changes and restart', async () => {
    const history: KnowledgeEventLog = {};
    const data = { ...contrastData, grammar: contrastData.grammar!.filter(point => point.pattern === 'のに') };
    const first = mount(vi.fn(), data, undefined, history);
    await startContrast(first.container, 2);
    const shown = currentItem(first.container, 2);
    const stored = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    expect(stored.queue[0].contrast.itemRef.id).toBe(shown.itemId);
    history[grammarEvidenceKey('ja', shown.pattern, 'grammar-recognition')] = [grammarRecognitionEvidence('ja', shown.pattern, {
      t: Date.now(), kind: 'rating', quality: 'struggled', attemptId: 'another-window',
      itemRef: { id: shown.itemId, version: shown.version },
    })];
    (first.container.querySelector('[data-format="typed"]') as HTMLButtonElement).click();
    await tick();
    expect(currentItem(first.container, 2).itemId).toBe(shown.itemId);
    first.dispose(); first.container.remove();
    const onProbe = vi.fn();
    const restarted = mount(onProbe, data, undefined, history);
    await expand(restarted.container, 2);
    expect(currentItem(restarted.container, 2).itemId).toBe(shown.itemId);
    const input = restarted.container.querySelector('.grammar-contrast__typed-input') as HTMLInputElement;
    input.value = 'wrong'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    (restarted.container.querySelector('.grammar-contrast__submit') as HTMLButtonElement).click();
    await tick();
    expect(onProbe.mock.calls[0][4].decision).toEqual(stored.queue[0].contrast.decisions.typed);
    restarted.dispose(); restarted.container.remove();
  });

  it('a journal rejection keeps the stable reservation and the same question retryable (G01)', async () => {
    const onProbe = vi.fn()
      .mockRejectedValueOnce(new Error('journal unavailable'))
      .mockResolvedValue('attempt-after-recovery');
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    const presented = currentItem(container, 2);
    const answer = () => {
      const options = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
      options[options.findIndex((option) => option.getAttribute('data-option') === presented.gold)].click();
    };

    answer();
    await beat();
    const reserved = JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!);
    expect(reserved.index).toBe(0);
    expect(reserved.answered).toBeUndefined();
    expect(reserved.pending?.attemptId).toEqual(expect.any(String));
    expect(reserved.pending.payload.attempt.decision).toEqual(reserved.queue[0].contrast.decisions.mcq);
    expect(currentItem(container, 2).itemId).toBe(presented.itemId);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback')).toBeNull();
    expect(container.querySelector('[data-testid="grammar-storage-unavailable"]')).toBeTruthy();
    const skip = levelBlock(container, 2).querySelector('.grammar-coverage__session-skip, .study-encounter__skip') as HTMLButtonElement;
    skip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await beat();
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!)).toEqual(reserved);
    expect(skip.disabled).toBe(true);

    answer();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(2);
    expect(onProbe.mock.calls[1][4].decision).toEqual(onProbe.mock.calls[0][4].decision);
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-study-grammar:ja')!).answered?.index).toBe(0);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback')).toBeTruthy();
    expect(container.querySelector('[data-testid="grammar-storage-unavailable"]')).toBeNull();
    dispose();
    container.remove();
  });

  it('resumes a nonterminal interrupted pending attempt with the same id (G01)', async () => {
    const interrupted = vi.fn(() => new Promise<void>(() => {}));
    const first = mount(interrupted);
    await startPass(first.container, 2);
    revealCurrent(first.container, 2);
    (levelBlock(first.container, 2).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement).click();
    await tick();
    const stored = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    const attemptId = stored.pending.attemptId as string;
    const decision = stored.queue[0].decision;
    expect(decision.id).toEqual(expect.any(String));
    expect(stored.pending.payload.attempt.decision).toEqual(decision);
    expect(stored.index).toBe(0);
    expect((interrupted.mock.calls[0] as unknown[])[4]).toMatchObject({ attemptId });
    first.dispose();
    first.container.remove();

    const resumed = vi.fn().mockResolvedValue(undefined);
    const second = mount(resumed);
    await expand(second.container, 2);
    await beat();
    expect(resumed.mock.calls[0][4]).toMatchObject({ attemptId, decision });
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).index).toBe(1);
    second.dispose();
    second.container.remove();
  });

  it('keeps a final-step pending attempt durable across remount until acknowledgement (G01)', async () => {
    const interrupted = vi.fn(() => new Promise<void>(() => {}));
    const first = mount(interrupted);
    await startPass(first.container, 3);
    revealCurrent(first.container, 3);
    (levelBlock(first.container, 3).querySelector(
      '.study-encounter__response .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement).click();
    await tick();
    const stored = JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!);
    const attemptId = stored.pending.attemptId as string;
    expect(stored.index).toBe(0);
    expect((interrupted.mock.calls[0] as unknown[])[4]).toMatchObject({ attemptId });
    first.dispose();
    first.container.remove();

    const resumed = vi.fn().mockResolvedValue(undefined);
    const second = mount(resumed);
    await expand(second.container, 3);
    await beat();
    expect(resumed.mock.calls[0][4]).toMatchObject({ attemptId });
    expect(JSON.parse(localStorage.getItem('mlearn-study-grammar:ja')!).index).toBe(1);
    second.dispose();
    second.container.remove();
  });
});
