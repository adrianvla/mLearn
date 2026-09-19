// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { MockExam } from './MockExam';
import { assembleContrastItem, itemContentVersion, questionBankFromLanguageData } from '../../learning/questionBank';
import type {
  GrammarItemSemanticValidation,
  GrammarPracticeItemSource,
  LanguageData,
} from '../../../shared/types';
import type { AttemptId, KnowledgeEventLog } from '../../../shared/knowledgeEvents';
import type { MockJournalPayload } from '../../learning/mockExam';

let settingsUiLanguage = 'en';

vi.mock('../../context', () => ({
  useLocalization: () => ({
    // Params render deterministically (`key?k=v&k=v`) so DOM text assertions
    // can pin the numbers the surface reports, not just the key presence.
    t: (key: string, params?: Record<string, string>) => (params ? `${key}?${new URLSearchParams(params).toString()}` : key),
  }),
  useSettings: () => ({
    settings: {
      get uiLanguage() { return settingsUiLanguage; },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Fixture — German-like package declaring item sources per pattern. Records
// are produced by the FIXTURE validator (a stand-in for an actually-executed
// independent validation); without them every item is undeliverable and the
// surface must report an honest empty assembly (G04).
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
      { span: 'deshalb', violates: ['causal-reading', 'subordinate-clause-final-verb'], rationale: 'causal adverb, verb-second' },
    ],
  },
  trotzdem: {
    context: 'Es regnet, trotzdem gehen wir spazieren.',
    conditions: ['concessive-reading', 'verb-second-main-clause'],
    distractors: [
      { span: 'deshalb', violates: ['concessive-reading'], rationale: 'concessive reading contradicts the walk' },
      { span: 'obwohl', violates: ['concessive-reading', 'subordinate-clause-final-verb'], rationale: 'subordinate conjunction, verb-final' },
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
const reviewedItem = (pattern: PatternName): GrammarPracticeItemSource => {
  itemCounter += 1;
  const base: GrammarPracticeItemSource = {
    id: `de-${pattern}-${itemCounter}`,
    context: CONTRAST[pattern].context,
    answerSpan: pattern,
    conditions: [...CONTRAST[pattern].conditions],
    distractors: CONTRAST[pattern].distractors.map((d) => ({ ...d, violates: [...d.violates] })),
  };
  return { ...base, validation: { semantic: semanticRecord(base) } };
};
const unreviewedItem = (pattern: PatternName): GrammarPracticeItemSource => {
  itemCounter += 1;
  return {
    id: `de-${pattern}-${itemCounter}`,
    context: CONTRAST[pattern].context,
    answerSpan: pattern,
    conditions: [...CONTRAST[pattern].conditions],
    distractors: CONTRAST[pattern].distractors.map((d) => ({ ...d, violates: [...d.violates] })),
  };
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
    { pattern: 'weil', meaning: 'because', level: 3, category: 'reasons', items: [weilA, weilB] },
    { pattern: 'deshalb', meaning: 'therefore', level: 3, category: 'reasons', items: [deshalbA, deshalbB] },
    { pattern: 'obwohl', meaning: 'although', level: 3, category: 'concession', items: [obwohlA, obwohlB] },
    { pattern: 'trotzdem', meaning: 'nevertheless', level: 2, items: [trotzdemA] },
  ],
  grammarLevels: { names: { '2': 'A2', '3': 'B1' } },
  languageData: { version: '2026.09.19-test' },
} as unknown as LanguageData);

/** Package WITHOUT any executed semantic validation: every item declared but
 *  undeliverable (the strict gate, D-W05-repair). */
const unreviewedLanguageData = (): LanguageData => ({
  grammar: [
    { pattern: 'weil', meaning: 'because', level: 3, category: 'reasons', items: [unreviewedItem('weil')] },
    { pattern: 'obwohl', meaning: 'although', level: 3, category: 'concession', items: [unreviewedItem('obwohl')] },
  ],
  grammarLevels: { names: { '3': 'B1' } },
  languageData: { version: '2026.09.19-test' },
} as unknown as LanguageData);

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** The presentation beat (150 ms lock) before the next prompt accepts input;
 *  gesture truth (click detail / key repeat) is the load-bearing guard. */
const beat = () => new Promise<void>((resolve) => setTimeout(resolve, 170));

// item.id → gold option index, computed from the SAME deterministic assembly
// the component uses (option order is seeded per item version).
const goldIndexById = (languageData: LanguageData): Map<string, number> => {
  const bank = questionBankFromLanguageData('de', languageData);
  const map = new Map<string, number>();
  for (const [pattern, sources] of bank.itemsByPattern) {
    for (const source of sources) {
      const item = assembleContrastItem(source, {
        language: bank.language,
        pattern,
        contentVersion: bank.contentVersion,
      });
      map.set(item.id, item.options.findIndex((option) => option.text === source.answerSpan));
    }
  }
  return map;
};

interface Harness {
  container: HTMLElement;
  dispose: () => void;
  onAttempt: ReturnType<typeof vi.fn>;
  onRepair: ReturnType<typeof vi.fn>;
  onTargetedOutput: ReturnType<typeof vi.fn>;
}

function mount(
  languageData: LanguageData = baseLanguageData(),
  overrides: {
    eventLog?: KnowledgeEventLog;
  } = {},
): Harness {
  const onAttempt = vi.fn((_payload: MockJournalPayload): AttemptId => `attempt-${onAttempt.mock.calls.length}`);
  const onRepair = vi.fn();
  const onTargetedOutput = vi.fn();
  const container = document.createElement('div');
  // Solid attaches delegated listeners on the document; container must be
  // connected for bubbled clicks to reach them (see DECISIONS D10).
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <MockExam
        language="de"
        languageData={languageData}
        eventLog={overrides.eventLog ?? ({} as KnowledgeEventLog)}
        onAttempt={onAttempt}
        onRepair={onRepair}
        onTargetedOutput={onTargetedOutput}
      />
    ),
    container,
  );
  return {
    container,
    dispose,
    onAttempt: onAttempt as unknown as ReturnType<typeof vi.fn>,
    onRepair,
    onTargetedOutput,
  };
}

const startBlueprint = async (container: HTMLElement, level: number) => {
  const start = container.querySelector(`[data-testid="mock-start-${level}"]`) as HTMLButtonElement;
  expect(start).toBeTruthy();
  start.click();
  await tick();
};

/** Answers the presented steps, choosing `pick` options ahead of the gold
 *  index (0 = always gold). Returns after the results view is visible. */
const answerThroughResults = async (container: HTMLElement, gold: Map<string, number>, wrongOffset = 0) => {
  let guard = 0;
  while (container.querySelector('[data-testid="mock-session"]')) {
    guard += 1;
    expect(guard).toBeLessThan(64);
    const itemId = (container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    const goldIndex = gold.get(itemId)!;
    const session = container.querySelector('[data-testid="mock-session"]')!;
    const options = Array.from(session.querySelectorAll('.mock-exam__option')) as HTMLButtonElement[];
    expect(options.length).toBeGreaterThanOrEqual(2);
    const chosen = options[(goldIndex + wrongOffset) % options.length];
    chosen.click();
    await beat();
  }
  expect(container.querySelector('[data-testid="mock-results"]')).toBeTruthy();
};

describe('MockExam surface (R13/R14)', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('declares blueprints with honest mlearn-derived labeling and no score language', async () => {
    const harness = mount();
    const blueprints = harness.container.querySelector('[data-testid="mock-blueprints"]');
    expect(blueprints).toBeTruthy();
    expect(blueprints!.querySelector('[data-blueprint="mlearn-mock:de:2"]')).toBeTruthy();
    expect(blueprints!.querySelector('[data-blueprint="mlearn-mock:de:3"]')).toBeTruthy();
    expect(harness.container.querySelectorAll('[data-testid="mock-results"]').length).toBe(0);
    harness.dispose();
    harness.container.remove();
  });

  it('runs the fixed queue end-to-end: every step writes one canonical attempt, results show provenance', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);

    // No mid-session feedback: the session shows no correctness marking
    // between steps; the presented item advances after each submission.
    const seenIds = new Set<string>();
    while (harness.container.querySelector('[data-testid="mock-session"]')) {
      const itemId = (harness.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
      expect(seenIds.has(itemId)).toBe(false); // fixed queue: no repeats, no reordering
      seenIds.add(itemId);
      const session = harness.container.querySelector('[data-testid="mock-session"]')!;
      (session.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
      await beat();
      // Results appear only when the LAST submission finished the queue;
      // mid-queue there is never a results view.
      if (harness.container.querySelector('[data-testid="mock-session"]')) {
        expect(harness.container.querySelector('[data-testid="mock-results"]')).toBeNull();
      }
    }

    expect(harness.onAttempt).toHaveBeenCalledTimes(seenIds.size);
    for (const call of harness.onAttempt.mock.calls as MockJournalPayload[][]) {
      const payload = call[0];
      expect(payload.taskType).toBe('mock-contrast');
      expect(payload.level).toBe(3);
      expect(seenIds.has(payload.itemRef.id)).toBe(true);
      expect(payload.validationRef).toMatchObject({ validator: 'fixture-independent-validator@1' });
    }

    const results = harness.container.querySelector('[data-testid="mock-results"]')!;
    expect(results.querySelector('[data-testid="mock-disclaimer"]')).toBeTruthy();
    const provenance = results.querySelector('[data-testid="mock-results-provenance"]')!;
    expect(provenance).toBeTruthy();
    const sections = results.querySelectorAll('tbody tr');
    expect(sections.length).toBe(2); // reasons + concession
    // Totals agree with the canonical writes: answered == correct (all gold).
    expect(results.textContent).toContain(`mlearn.LevelStudy.Mock.Answered?count=${seenIds.size}`);
    expect(results.textContent).toContain(`mlearn.LevelStudy.Mock.Correct?count=${seenIds.size}`);
    expect(harness.container.querySelector('[data-testid="mock-results-abandoned"]')).toBeNull();

    // Back to blueprints: the bounded summary list now holds exactly one row.
    (results.querySelector('[data-testid="mock-close-results"]') as HTMLElement).click();
    await tick();
    expect(harness.container.querySelectorAll('[data-testid="mock-summary-row"]').length).toBe(1);
    harness.dispose();
    harness.container.remove();
  });

  it('all-wrong run surfaces missed patterns, repair through the same walk, and targeted output', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    await answerThroughResults(harness.container, gold, 1);

    const rows = Array.from(harness.container.querySelectorAll('.mock-exam__pattern-row')) as HTMLElement[];
    const missed = new Set(rows.map((row) => row.getAttribute('data-pattern')).filter((pattern): pattern is string => pattern !== null));
    expect(missed.size).toBeGreaterThan(0);
    const level3Patterns = new Set(['weil', 'deshalb', 'obwohl']);
    for (const pattern of missed) expect(level3Patterns.has(pattern)).toBe(true);

    const repair = harness.container.querySelector('[data-testid="mock-repair-btn"]') as HTMLButtonElement;
    repair.click();
    await tick();
    expect(harness.onRepair).toHaveBeenCalledWith(3);

    (harness.container.querySelector('[data-testid="mock-output-btn"]') as HTMLButtonElement).click();
    await tick();
    expect(harness.onTargetedOutput).toHaveBeenCalledTimes(1);
    const targets = harness.onTargetedOutput.mock.calls[0][0] as { pattern: string; meaning: string; level: number }[];
    expect(new Set(targets.map((target) => target.pattern))).toEqual(missed);
    for (const target of targets) {
      expect(typeof target.meaning).toBe('string');
      expect(target.meaning.length).toBeGreaterThan(0);
      expect(target.level).toBe(3);
    }
    harness.dispose();
    harness.container.remove();
  });

  it('restores detailed results and their actions after a projection-refresh remount', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const first = mount(languageData);
    await startBlueprint(first.container, 3);
    await answerThroughResults(first.container, gold, 1);
    first.dispose();
    first.container.remove();

    const second = mount(languageData);
    expect(second.container.querySelector('[data-testid="mock-results"]')).toBeTruthy();
    (second.container.querySelector('[data-testid="mock-repair-btn"]') as HTMLButtonElement).click();
    (second.container.querySelector('[data-testid="mock-output-btn"]') as HTMLButtonElement).click();
    expect(second.onRepair).toHaveBeenCalledWith(3);
    expect(second.onTargetedOutput).toHaveBeenCalledTimes(1);

    (second.container.querySelector('[data-testid="mock-close-results"]') as HTMLButtonElement).click();
    second.dispose();
    second.container.remove();
    const third = mount(languageData);
    expect(third.container.querySelector('[data-testid="mock-results"]')).toBeNull();
    expect(third.container.querySelector('[data-testid="mock-blueprints"]')).toBeTruthy();
    third.dispose();
    third.container.remove();
  });

  it('all-correct run shows the honest no-missed state without repair affordances', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    await answerThroughResults(harness.container, gold, 0);

    expect(harness.container.querySelector('[data-testid="mock-results"]')!.querySelector('[data-testid="mock-repair-btn"]')).toBeNull();
    expect(harness.container.querySelector('[data-testid="mock-output-btn"]')).toBeNull();
    harness.dispose();
    harness.container.remove();
  });

  it('declared timing: an ACTIVE overrun auto-times-out unanswered with no journal write', async () => {
    // Date + intervals only: real setTimeout keeps the tick/beat helpers alive.
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] });
    const languageData = baseLanguageData();
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();

    // 92s of declared budget (90s) elapses while the step stays unanswered:
    // the tick submits the declared timeout (unanswered — no evidence).
    vi.advanceTimersByTime(92_000);
    expect(harness.onAttempt).not.toHaveBeenCalled();
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();

    // The remaining steps time out too; the finished results record the
    // honest zeros (nothing answered) with timing provenance.
    vi.advanceTimersByTime(92_000 * 8);
    expect(harness.container.querySelector('[data-testid="mock-results"]')).toBeTruthy();
    expect(harness.onAttempt).not.toHaveBeenCalled();

    (harness.container.querySelector('[data-testid="mock-close-results"]') as HTMLButtonElement).click();
    await startBlueprint(harness.container, 3);
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    harness.dispose();
    harness.container.remove();
  });

  it('declared budget: a click arriving past the budget is late — it commits the declared timeout, never an answer', async () => {
    // Date + intervals faked: setSystemTime advances the clock WITHOUT firing
    // the tick interval (the throttled-tick case), then the backlog click
    // arrives after the 90s ACTIVE budget.
    vi.useFakeTimers({ now: 3_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] });
    const languageData = baseLanguageData();
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    vi.setSystemTime(3_091_000);
    (harness.container.querySelector('.mock-exam__option') as HTMLElement).click();
    // The late click never reached the canonical writer and never recorded
    // an answer; the step is only ever recorded by the declared timeout.
    expect(harness.onAttempt).not.toHaveBeenCalled();
    // The remaining steps time out through the tick cascade; the finished
    // results are the honest all-unanswered set (no fabricated scoring).
    vi.advanceTimersByTime(92_000 * 8);
    expect(harness.container.querySelector('[data-testid="mock-results"]')).toBeTruthy();
    expect(harness.onAttempt).not.toHaveBeenCalled();
    harness.dispose();
    harness.container.remove();
  });

  it('an explicit pause stops the clock: no timeout while paused, and the pause is declared', async () => {
    vi.useFakeTimers({ now: 2_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] });
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    (harness.container.querySelector('[data-testid="mock-pause-btn"]') as HTMLElement).click();
    vi.advanceTimersByTime(120_000);
    expect(harness.container.querySelector('[data-testid="mock-paused-note"]')).toBeTruthy();
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    // Resuming accepts real answers again (pause is not an assessment event).
    (harness.container.querySelector('[data-testid="mock-pause-btn"]') as HTMLElement).click();
    const itemId = (harness.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    (harness.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
    vi.advanceTimersByTime(200);
    expect(harness.onAttempt).toHaveBeenCalledTimes(1);
    harness.dispose();
    harness.container.remove();
  });

  it('resume restores the stored in-progress session (G01), and the finished one never does', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const first = mount(languageData);
    await startBlueprint(first.container, 3);
    const firstItemId = (first.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    (first.container.querySelectorAll('.mock-exam__option')[gold.get(firstItemId)!] as HTMLElement).click();
    await beat();
    first.dispose();
    first.container.remove();

    const second = mount(languageData);
    expect(second.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    expect(second.onAttempt).not.toHaveBeenCalled();
    second.dispose();
    second.container.remove();

    globalThis.localStorage?.clear();
    const third = mount(languageData);
    expect(third.container.querySelector('[data-testid="mock-session"]')).toBeNull();
    third.dispose();
    third.container.remove();
  });

  it('abandoning marks results, records no further evidence, and keeps answered attempts (G04)', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    const itemId = (harness.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    (harness.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
    await beat();
    expect(harness.onAttempt).toHaveBeenCalledTimes(1);

    (harness.container.querySelector('[data-testid="mock-abandon-btn"]') as HTMLElement).click();
    await tick();
    expect(harness.onAttempt).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector('[data-testid="mock-results-abandoned"]')).toBeTruthy();

    (harness.container.querySelector('[data-testid="mock-close-results"]') as HTMLButtonElement).click();
    await startBlueprint(harness.container, 3);
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    harness.dispose();
    harness.container.remove();
  });

  it('undeliverable items assemble honestly to nothing (G04): empty note, no fabricated session', async () => {
    const harness = mount(unreviewedLanguageData());
    await startBlueprint(harness.container, 3);
    expect(harness.container.querySelector('[data-testid="mock-assemble-empty"]')).toBeTruthy();
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeNull();
    expect(harness.onAttempt).not.toHaveBeenCalled();
    harness.dispose();
    harness.container.remove();
  });
});
