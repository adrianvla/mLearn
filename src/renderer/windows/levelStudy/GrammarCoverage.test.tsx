// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { GrammarCoverage } from './GrammarCoverage';
import { itemContentVersion } from '../../learning/questionBank';
import { loadQuestionValidationRecords } from '../../learning/questionValidation';
import type { PlacementLocks } from './PlacementSession';
import type { GrammarItemSemanticValidation, GrammarPracticeItemSource } from '../../../shared/types';
import type { CurriculumComponentSummary } from '../../../shared/curriculum';
import type { AttemptScaffolds, KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import { grammarEvidenceKey, grammarRecognitionEvidence } from '../../../shared/grammar/evidence';
import type { LanguageData } from '../../../shared/types';
import type { AttemptQuality } from '../../../shared/constants';

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

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** The presentation beat (GrammarCoverage rate lock) before the next prompt
 *  accepts input; the gesture guards (click detail / key repeat) are the
 *  load-bearing duplicate-submission protection, the beat is secondary. */
const beat = () => new Promise<void>((resolve) => setTimeout(resolve, 170));

/** Pass-through fake lock (PlacementSession.test convention): single-window
 *  tests exercise the serialized path without changing timing. Tests that
 *  need a lock-less environment pass `null` explicitly. */
const passThroughLocks: PlacementLocks = {
  request: async (_name: string, callback: () => void) => { await callback(); },
};

function mount(
  onProbe: (p: string, q: AttemptQuality, l: number, scaffolds?: AttemptScaffolds, attempt?: unknown) => unknown,
  languageDataOverride?: LanguageData,
  summaryOverride?: CurriculumComponentSummary,
  eventLogOverride?: KnowledgeEventLog,
  onValidated?: () => void,
  repairRequest?: () => { level: number; requestedAt: number } | null,
  onRepairRequestHandled?: (requestedAt: number) => void,
  locks: PlacementLocks | null = passThroughLocks,
) {
  const container = document.createElement('div');
  // Solid attaches delegated listeners on the document; container must be
  // connected for bubbled clicks to reach them (see DECISIONS D10).
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <GrammarCoverage
        language="ja"
        languageData={languageDataOverride ?? languageData}
        eventLog={eventLogOverride ?? ({} as KnowledgeEventLog)}
        summary={summaryOverride ?? summary}
        onProbe={async (...args) => {
          await onProbe(...args);
          return 'fixture-grammar-attempt';
        }}
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

describe('GrammarCoverage policy-selected practice session', () => {
  // Durable-pass storage is cleared at the shared boundary: tests that dispose
  // mid-pass would otherwise leak `mlearn-grammar-pass:ja` into later mounts
  // and restore unexpectedly.
  beforeEach(() => {
    localStorage.clear();
    // Passes serialize their durable mutations with the Web Locks API;
    // happy-dom reports navigator.locks as null, which DISABLES the pass
    // surfaces (G04). These tests drive the serialized paths (including
    // direct createComponent renders that bypass the mount helper's lock
    // prop), so inject a pass-through lock (the PlacementSession.test
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
      levelBlock(container, 2).querySelectorAll('.grammar-coverage__session-probe .rating-matrix__quality'),
    ) as HTMLButtonElement[];
    const seen = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      const pattern = levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern');
      expect(['のに', 'ば']).toContain(pattern);
      seen.add(pattern as string);
      expect(probeBtns().length).toBeGreaterThanOrEqual(3);
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

  it('uses the shared knowledge matrix for the live construction probe', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);

    const live = levelBlock(container, 2).querySelector('.grammar-coverage__session-probe') as HTMLElement;
    expect(live.querySelector('.rating-matrix')).not.toBeNull();
    (live.querySelector('.rating-matrix__adjust') as HTMLButtonElement).click();
    expect(live.textContent).toContain('mlearn.Knowledge.Capability.grammar-recognition');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', bubbles: true }));
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
    const fluent = () => levelBlock(container, 2).querySelector<HTMLButtonElement>('.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)')!;
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
        '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
      ) as HTMLButtonElement;
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
        '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
      ) as HTMLButtonElement;
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
    (levelBlock(container, 2).querySelector('.grammar-coverage__session-skip') as HTMLElement).click();
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
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
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
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    expect(nextFluent.disabled).toBe(false);
    nextFluent.dispatchEvent(new MouseEvent('click', { detail: 2, bubbles: true }));
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);

    // A genuinely fresh activation (detail <= 1) rates the next prompt once.
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
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    fluent.click();
    await beat();

    // The prompt advanced, so the controls were re-created: re-query before
    // simulating the held key against the live element.
    const second = levelBlock(container, 2).querySelector(
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    // Holding Enter/Space auto-repeats keydown; the control must cancel the
    // default activation so the held key cannot rate the following prompt.
    second.focus();
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(repeat, 'repeat', { value: true });
    const prevent = vi.spyOn(repeat, 'preventDefault');
    second.dispatchEvent(repeat);
    expect(prevent).toHaveBeenCalled();
    expect(onProbe).toHaveBeenCalledTimes(1);

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
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    (fluent()).click();
    await beat();
    (fluent()).click();
    await beat();
    expect(container.querySelector('.grammar-coverage__session-done')).toBeTruthy();

    // Start a fresh pass over the same level: the first rating must register.
    const practise = levelBlock(container, 2).querySelector('.grammar-coverage__session-btn') as HTMLButtonElement;
    practise.click();
    await tick();
    (fluent()).click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(3);

    dispose();
    container.remove();
  });

  it('row probes are restored and declare visible-meaning provenance', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    // Expand level 2; rows render probe buttons when no live pass is running.
    const row = container.querySelector('.grammar-coverage__level-row[data-level="2"]') as HTMLElement;
    row.click();
    await tick();
    const rowProbes = Array.from(container.querySelectorAll('[data-level="2"] .grammar-coverage__construction .grammar-coverage__probe-btn'));
    expect(rowProbes.length).toBe(6);
    expect(onProbe).not.toHaveBeenCalled();
    // A visible meaning (のに localized to en under default en UI) is declared.
    (rowProbes[2] as HTMLElement).click(); // fluent
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][3]).toEqual({ translation: true });
    dispose();
    container.remove();
  });

  it('session (cue-free) probes record no scaffold while meaning leaks none', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2); // level 2 pass running
    // No meaning cue is rendered anywhere while the pass is live.
    expect(container.querySelectorAll('.grammar-coverage__meaning').length).toBe(0);
    const fluent = container.querySelector('.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)') as HTMLElement;
    fluent.click();
    await tick();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(onProbe.mock.calls[0][3]).toBeUndefined();
    dispose();
    container.remove();
  });

  it('a live pass on one level never leaks into another level and pauses other Practise entries', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2); // level 2 pass running

    await expand(container, 3);
    const level3 = levelBlock(container, 3);
    expect(level3.querySelector('.grammar-coverage__session-prompt')).toBeNull();
    expect(level3.querySelector('.grammar-coverage__session-probe')).toBeNull();
    const level3Practise = level3.querySelector('.grammar-coverage__session-btn') as HTMLButtonElement;
    expect(level3Practise).toBeTruthy();
    expect(level3Practise.disabled).toBe(true); // no silent replan while a pass is live
    expect(level3.textContent).toContain('mlearn.LevelStudy.Grammar.FinishCurrentPass');

    // Single-expansion collapsed level 2; reopening shows the pass intact.
    await expand(container, 2);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')).toBeTruthy();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-probe')).toBeTruthy();

    dispose();
    container.remove();
  });

  it('the active task shows no meaning cues; coverage meanings return after the pass', async () => {
    settingsUiLanguage = 'en';
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    expect(container.querySelectorAll('.grammar-coverage__meaning').length).toBe(0);
    expect(container.querySelectorAll('.grammar-coverage__construction').length).toBe(0);

    const fluent = () => levelBlock(container, 2).querySelector(
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    (fluent()).click();
    await beat();
    (fluent()).click();
    await beat();

    // Rows (with meanings) return once no pass is live.
    expect(container.querySelectorAll('.grammar-coverage__construction').length).toBe(2);
    expect(container.querySelectorAll('.grammar-coverage__meaning').length).toBe(2);
    expect(onProbe).toHaveBeenCalledTimes(2);

    dispose();
    container.remove();
  });

  it('localized meanings render per UI language; untranslated points show nothing under a non-English UI', async () => {
    settingsUiLanguage = 'de';
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await expand(container, 2);
    const meanings = Array.from(levelBlock(container, 2).querySelectorAll('.grammar-coverage__meaning'))
      .map((node) => node.textContent);
    expect(meanings).toEqual(['obwohl (trotzdem)']); // のには de variant; ば untranslated → withheld

    settingsUiLanguage = 'en';
    const { container: enContainer, dispose: disposeEn } = mount(onProbe);
    await expand(enContainer, 2);
    const enMeanings = Array.from(levelBlock(enContainer, 2).querySelectorAll('.grammar-coverage__meaning'))
      .map((node) => node.textContent);
    expect(enMeanings).toEqual(['even though', 'conditional "if"']);

    dispose();
    container.remove();
    disposeEn();
    enContainer.remove();
  });

  it('a stored pass survives a de→ja→de language round trip without being clobbered', async () => {
    // Seed a VALID de pass so the de cursor is genuinely ACTIVE on load — this
    // exercises a real de→ja reload (not stale-entry rejection).
    globalThis.localStorage?.setItem('mlearn-grammar-pass:de', JSON.stringify({ level: 2, queue: ['weil', 'trotzdem'], index: 0, "denominator": "trotzdem\u0000weil" }));
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
      onProbe: async () => 'fixture-grammar-attempt',
    }), container);

    // The stored de cursor is ACTIVE on load (cursor 0 restored).
    await expand(container, 2);
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern')).toBe('weil');

    // Flip de → ja: the ja view has no stored pass, and the persistence effect
    // must NOT clobber the stored de cursor with the (different) ja context.
    setActiveLanguage('ja');
    await tick();
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:de')).toBe(JSON.stringify({ level: 2, queue: ['weil', 'trotzdem'], index: 0, "denominator": "trotzdem\u0000weil" }));
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:ja')).toBeNull();

    // Flip back: the de cursor resumes exactly where it was.
    setActiveLanguage('de');
    await tick();
    await vi.waitFor(() => expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')?.getAttribute('data-pattern')).toBe('weil'));

    dispose();
    container.remove();
    globalThis.localStorage?.removeItem('mlearn-grammar-pass:de');
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
    await expand(container, 2);
    // Canonical German under an en UI: withheld (package declares German).
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__meaning')).toBeNull();

    settingsUiLanguage = 'de';
    const { container: deContainer, dispose: disposeDe } = mount(onProbe, germanCanonical, germanSummary);
    await expand(deContainer, 2);
    // Under the package's declared meaning language the canonical text shows.
    expect(levelBlock(deContainer, 2).querySelector('.grammar-coverage__meaning')?.textContent).toBe('kausaler Nebensatz');

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
    (first.container.querySelector('[data-level="2"] .grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(1);
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:ja')).toBeTruthy(); // in-progress pass persisted
    first.dispose();
    first.container.remove();

    // A fresh mount must restore the interrupted pass at the next cursor — no
    // Practise click needed, and the resumed item is the not-yet-seen one.
    const second = mount(onProbe);
    expect((levelBlock(second.container, 2).querySelector('.grammar-coverage__level-row') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('true');
    const resumedPattern = second.container.querySelector('[data-level="2"] [data-pattern]')?.getAttribute('data-pattern');
    expect(resumedPattern).toBeTruthy();
    expect(resumedPattern).not.toBe(firstPresented);
    expect(levelBlock(second.container, 2).querySelector('.grammar-coverage__session-btn')).toBeNull();

    (second.container.querySelector('[data-level="2"] .grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)') as HTMLButtonElement).click();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(2);
    // Level 2 has exactly two constructions: after the resumed rating the pass
    // is complete, which must clear the stored cursor (no phantom resume).
    expect(second.container.querySelector('.grammar-coverage__session-done')).toBeTruthy();
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:ja')).toBeNull();

    second.dispose();
    second.container.remove();
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
      globalThis.localStorage?.setItem('mlearn-grammar-pass:ja', value);
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
    globalThis.localStorage?.setItem('mlearn-grammar-pass:de', JSON.stringify({ level: 2, queue: ['weil', 'trotzdem'], index: 0, "denominator": "trotzdem\u0000weil" }));
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
      'mlearn-grammar-pass:ja',
      JSON.stringify({ level: 2, queue: ['のに', 'ば'], index: 0, denominator: 'のに\u0000ば' }),
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
      onProbe: async () => 'fixture-grammar-attempt',
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
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:ja')).not.toBeNull();

    dispose();
    container.remove();
    localStorage.clear();
  });

  it('persists the pass cursor synchronously inside the handler, before any effect flush (G01)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe);
    await startPass(container, 2);
    expect(JSON.parse(localStorage.getItem('mlearn-grammar-pass:ja')!)).toMatchObject({ index: 0 });

    // The rating handler synchronously persists a stable pending attempt at
    // the presented cursor before invoking the journal writer.
    const setItem = vi.spyOn(localStorage, 'setItem');
    (levelBlock(container, 2).querySelector(
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLElement).click();
    const persistedWrite = setItem.mock.calls.find(([key]) => key === 'mlearn-grammar-pass:ja');
    expect(persistedWrite).toBeTruthy(); // persisted synchronously IN the handler
    expect(JSON.parse(persistedWrite![1]!).index).toBe(0);
    expect(JSON.parse(persistedWrite![1]!).pending?.index).toBe(0);
    expect(JSON.parse(persistedWrite![1]!).pending?.attemptId).toEqual(expect.any(String));
    expect(onProbe).toHaveBeenCalledTimes(1);
    setItem.mockRestore();

    // Completing the walk removes the stored entry (index past the end).
    await beat();
    (levelBlock(container, 2).querySelector(
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLElement).click();
    await beat();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-done')).toBeTruthy();
    expect(localStorage.getItem('mlearn-grammar-pass:ja')).toBeNull();
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
        onProbe={onProbe}
      />
    ), container);

    await startPass(container, 2);
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:ja')).not.toBeNull();

    // Switch to German while the Japanese pass is live: the stored Japanese
    // entry stays under its own key untouched, German's key stays empty, and
    // the in-memory pass swaps to German's durable state (none) — never
    // cross-filed through a reactive persist (R19/G01).
    setLanguage('de');
    setData(germanData);
    await tick();
    await tick();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-pass:ja')!).level).toBe(2);
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:de')).toBeNull();
    expect(levelBlock(container, 2).querySelector('.grammar-coverage__session-prompt')).toBeNull();

    dispose();
    container.remove();
    localStorage.clear();
  });

  it('disables the pass surfaces without a Web Lock (G04): honest note, no starts, nothing restored to act on', async () => {
    // A stored live pass exists, but without a lock primitive nothing may
    // act on it: the honest note replaces the start affordances — never an
    // unserialized multi-window pass (the MockExam G04 convention).
    globalThis.localStorage?.setItem('mlearn-grammar-pass:ja', JSON.stringify({ level: 2, queue: ['のに', 'ば'], index: 0, denominator: 'のに\u0000ば' }));
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
    globalThis.localStorage?.removeItem('mlearn-grammar-pass:ja');
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

  it('a measured-insecure category is planned first through the SAME pass walk', async () => {
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
      expect(prompt?.getAttribute('data-pattern')).toBe('ば');
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
    (levelBlock(container, 2).querySelector('.grammar-coverage__session-skip') as HTMLButtonElement).click();
    await beat();
    expect(levelBlock(container, 2).querySelector('.grammar-contrast')).toBeTruthy();
    (levelBlock(container, 2).querySelector('.grammar-coverage__session-skip') as HTMLButtonElement).click();
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
      'mlearn-grammar-contrast-pass:ja',
      JSON.stringify({ level: 2, kind: 'contrast', queue: ['のに', 'ば'], index: 0, denominator: 'のに\u0000ば' }),
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
      'mlearn-grammar-contrast-pass:ja',
      JSON.stringify({ level: 2, kind: 'contrast', queue: ['のに'], index: 0, denominator: 'のに' }),
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
      'mlearn-grammar-contrast-pass:ja',
      JSON.stringify({ level: 2, kind: 'contrast', queue: ['のに'], index: 0, denominator: 'のに' }),
    );
    const mounted = mount(vi.fn(), mixed, contrastSummary);
    await expand(mounted.container, 2);
    expect(mounted.container.querySelector('.grammar-contrast[data-pattern="のに"]')).toBeTruthy();
    mounted.dispose();
    mounted.container.remove();
  });

  it('two stored pass kinds coexist: load picks one, completing it surfaces the other (G01)', async () => {
    // Both kinds have in-progress cursors; neither load nor a pass may
    // destroy the other kind's stored entry.
    globalThis.localStorage?.setItem(
      'mlearn-grammar-pass:ja',
      JSON.stringify({ level: 2, queue: ['のに', 'ば'], index: 0, denominator: 'のに\u0000ば' }),
    );
    globalThis.localStorage?.setItem(
      'mlearn-grammar-contrast-pass:ja',
      JSON.stringify({ level: 2, kind: 'contrast', queue: ['のに', 'ば'], index: 0, denominator: 'のに\u0000ば' }),
    );
    const onProbe = vi.fn();
    const first = mount(onProbe, contrastData, contrastSummary);
    await expand(first.container, 2);
    // Deterministic resume priority: the self-assessment walk wins.
    expect(first.container.querySelector('.grammar-coverage__session-probe')).toBeTruthy();
    expect(first.container.querySelector('.grammar-contrast')).toBeNull();
    // Loading did not destroy the contrast cursor.
    expect(globalThis.localStorage?.getItem('mlearn-grammar-contrast-pass:ja')).toBeTruthy();

    // Complete the self-assessment walk: its own entry clears, the contrast
    // cursor stays stored.
    const fluent = () => levelBlock(first.container, 2).querySelector(
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement;
    fluent().click();
    await beat();
    fluent().click();
    await beat();
    expect(globalThis.localStorage?.getItem('mlearn-grammar-pass:ja')).toBeNull();
    expect(globalThis.localStorage?.getItem('mlearn-grammar-contrast-pass:ja')).toBeTruthy();
    first.dispose();
    first.container.remove();

    // Remount: the surviving contrast cursor resumes.
    const second = mount(onProbe, contrastData, contrastSummary);
    await expand(second.container, 2);
    expect(second.container.querySelector('.grammar-contrast__context')).toBeTruthy();
    second.dispose();
    second.container.remove();
  });

  it('a live contrast pass pauses other Practise and Contrast entries (G01)', async () => {
    const onProbe = vi.fn();
    const { container, dispose } = mount(onProbe, contrastData, contrastSummary);
    await startContrast(container, 2);
    // Expanding another level collapses this one (single-expansion UI); the
    // contrast pass must survive and other entries must stay paused.
    await expand(container, 3);
    const level3 = levelBlock(container, 3);
    expect(level3.querySelector('.grammar-coverage__session-btn')?.getAttribute('disabled')).toBe('');
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
      const skip = levelBlock(primed.container, 2).querySelector('.grammar-coverage__session-skip') as HTMLButtonElement;
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
      const skip = levelBlock(even.container, 2).querySelector('.grammar-coverage__session-skip') as HTMLButtonElement;
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
      (levelBlock(first.container, 2).querySelector('.grammar-coverage__session-skip') as HTMLButtonElement).click();
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
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!);
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
      (levelBlock(first.container, 2).querySelector('.grammar-coverage__session-skip') as HTMLButtonElement).click();
      await beat();
    }
    const presented = currentItem(first.container, 2);
    expect(presented.itemId).toBe('ja-test-noni-1');
    const options = Array.from(levelBlock(first.container, 2).querySelectorAll('.grammar-contrast__option')) as HTMLButtonElement[];
    options.find((option) => option.getAttribute('data-option') === presented.gold)!.click();
    await tick();

    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!);
    const attemptId = stored.pending.attemptId as string;
    const itemRef = stored.pending.answered.itemRef as { id: string; version: string; seed: number };
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
    const settled = JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!);
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
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!);
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
    const gating: PlacementLocks = {
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
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!);
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
      key: 'mlearn-grammar-contrast-pass:ja',
      newValue: globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja'),
    }));
    await tick();
    await tick();
    expect(probeA.mock.calls.length + probeB.mock.calls.length).toBe(1);
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!).index).toBe(1);
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
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!).answered?.index).toBe(0);
    dispose();
    container.remove();
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
    const reserved = JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!);
    expect(reserved.index).toBe(0);
    expect(reserved.answered).toBeUndefined();
    expect(reserved.pending?.attemptId).toEqual(expect.any(String));
    expect(currentItem(container, 2).itemId).toBe(presented.itemId);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback')).toBeNull();
    expect(container.querySelector('[data-testid="grammar-storage-unavailable"]')).toBeTruthy();

    answer();
    await beat();
    expect(onProbe).toHaveBeenCalledTimes(2);
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-grammar-contrast-pass:ja')!).answered?.index).toBe(0);
    expect(levelBlock(container, 2).querySelector('.grammar-contrast__feedback')).toBeTruthy();
    expect(container.querySelector('[data-testid="grammar-storage-unavailable"]')).toBeNull();
    dispose();
    container.remove();
  });

  it('resumes a nonterminal interrupted pending attempt with the same id (G01)', async () => {
    const interrupted = vi.fn(() => new Promise<void>(() => {}));
    const first = mount(interrupted);
    await startPass(first.container, 2);
    (levelBlock(first.container, 2).querySelector(
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement).click();
    await tick();
    const stored = JSON.parse(localStorage.getItem('mlearn-grammar-pass:ja')!);
    const attemptId = stored.pending.attemptId as string;
    expect(stored.index).toBe(0);
    expect((interrupted.mock.calls[0] as unknown[])[4]).toMatchObject({ attemptId });
    first.dispose();
    first.container.remove();

    const resumed = vi.fn().mockResolvedValue(undefined);
    const second = mount(resumed);
    await expand(second.container, 2);
    await beat();
    expect(resumed.mock.calls[0][4]).toMatchObject({ attemptId });
    expect(JSON.parse(localStorage.getItem('mlearn-grammar-pass:ja')!).index).toBe(1);
    second.dispose();
    second.container.remove();
  });

  it('keeps a final-step pending attempt durable across remount until acknowledgement (G01)', async () => {
    const interrupted = vi.fn(() => new Promise<void>(() => {}));
    const first = mount(interrupted);
    await startPass(first.container, 3);
    (levelBlock(first.container, 3).querySelector(
      '.grammar-coverage__session-probe .rating-matrix__quality:nth-child(3)',
    ) as HTMLButtonElement).click();
    await tick();
    const stored = JSON.parse(localStorage.getItem('mlearn-grammar-pass:ja')!);
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
    expect(localStorage.getItem('mlearn-grammar-pass:ja')).toBeNull();
    second.dispose();
    second.container.remove();
  });
});
