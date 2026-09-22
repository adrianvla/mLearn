// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { MockExam } from './MockExam';
import type { PlacementLocks } from './PlacementSession';
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
    /** `null` simulates a lock-less environment (the session surface is
     *  DISABLED with the G04 note); omitted/default uses a pass-through fake
     *  lock so single-window tests exercise the serialized path
     *  (PlacementSession.test convention). */
    locks?: PlacementLocks | null;
  } = {},
): Harness {
  const locks = Object.prototype.hasOwnProperty.call(overrides, 'locks')
    ? overrides.locks ?? null
    : { request: async (_name: string, callback: () => void) => { await callback(); } };
  const onAttempt = vi.fn(async (_payload: MockJournalPayload): Promise<AttemptId> => `attempt-${onAttempt.mock.calls.length}`);
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
        locks={locks}
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

  it('does not advertise an unfinished checkpoint when the package declares none', () => {
    const harness = mount({ ...baseLanguageData(), grammar: [], grammarLevels: { names: {} } });
    expect(harness.container.querySelector('[data-testid="mock-exam"]')).toBeNull();
    harness.dispose();
    harness.container.remove();
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

  it('resume preserves active time across repeated interruptions instead of granting or consuming extra budget', async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] });
    const languageData = baseLanguageData();
    const first = mount(languageData);
    await startBlueprint(first.container, 3);
    const firstItemId = (first.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;

    // No answer/pause handler runs during these 80 active seconds; the live
    // clock must still persist the boundary used by interruption restore.
    vi.advanceTimersByTime(80_000);
    first.dispose();
    first.container.remove();

    // Twenty seconds away is an interruption pause, but the preceding 80
    // active seconds still count against the original 90-second budget.
    vi.setSystemTime(1_100_000);
    const restored = mount(languageData);
    vi.advanceTimersByTime(500);
    expect(restored.container.querySelector('[data-testid="mock-timer"]')?.textContent).toContain('seconds=10');

    // Spend another five active seconds, then interrupt and restore again.
    // The first inferred interruption pause must survive this second reload.
    vi.advanceTimersByTime(4_500);
    restored.dispose();
    restored.container.remove();

    vi.setSystemTime(1_125_000);
    const restoredAgain = mount(languageData);
    vi.advanceTimersByTime(500);
    expect(restoredAgain.container.querySelector('[data-testid="mock-timer"]')?.textContent).toContain('seconds=5');
    expect((restoredAgain.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')).toBe(firstItemId);

    vi.advanceTimersByTime(5_000);
    expect(restoredAgain.onAttempt).not.toHaveBeenCalled();
    expect((restoredAgain.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')).not.toBe(firstItemId);
    restoredAgain.dispose();
    restoredAgain.container.remove();
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

  it('disables the session surface without a Web Lock (G04): honest note, no Start, nothing restored to act on', async () => {
    // A stored live session exists, but without a lock primitive nothing may
    // act on it: the surface shows the honest disabled note instead of an
    // unserialized session.
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const first = mount(languageData);
    await startBlueprint(first.container, 3);
    const firstItemId = (first.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    (first.container.querySelectorAll('.mock-exam__option')[gold.get(firstItemId)!] as HTMLElement).click();
    await beat();
    expect(globalThis.localStorage!.getItem('mlearn-mock-session:de')).not.toBeNull();
    first.dispose();
    first.container.remove();

    const second = mount(languageData, { locks: null });
    expect(second.container.querySelector('[data-testid="mock-no-locks"]')).toBeTruthy();
    expect(second.container.querySelector('[data-testid="mock-start-3"]')).toBeNull();
    expect(second.container.querySelector('[data-testid="mock-session"]')).toBeNull();
    expect(second.onAttempt).not.toHaveBeenCalled();
    second.dispose();
    second.container.remove();
  });

  it('a second window adopts the live session another window persisted, without write-back (G01)', async () => {
    const languageData = baseLanguageData();
    // The second window mounts BEFORE any session exists: it stays idle
    // until the first window's write reaches it through the storage event.
    const second = mount(languageData);
    expect(second.container.querySelector('[data-testid="mock-session"]')).toBeNull();
    const first = mount(languageData);
    await startBlueprint(first.container, 3);
    expect(first.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    expect(second.container.querySelector('[data-testid="mock-session"]')).toBeNull();

    const stored = globalThis.localStorage!.getItem('mlearn-mock-session:de')!;
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem');
    // The first window's own start-write, replayed as the browser would
    // deliver it: both windows receive it (the writer suppresses its own
    // fingerprint; the idle window adopts raw — which never writes).
    window.dispatchEvent(new StorageEvent('storage', { key: 'mlearn-mock-session:de', newValue: stored }));
    await tick();
    await tick();
    expect(second.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    expect(first.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    expect(second.onAttempt).not.toHaveBeenCalled();
    expect(first.onAttempt).not.toHaveBeenCalled();
    // Adoption is a raw rebuild: NO session-key write-back, so two windows
    // reacting to each other's writes cannot ping-pong.
    expect(setItem.mock.calls.filter(([key]) => key === 'mlearn-mock-session:de')).toHaveLength(0);
    // A repeated delivery of the same write is still a no-op write.
    window.dispatchEvent(new StorageEvent('storage', { key: 'mlearn-mock-session:de', newValue: stored }));
    await tick();
    expect(setItem.mock.calls.filter(([key]) => key === 'mlearn-mock-session:de')).toHaveLength(0);
    setItem.mockRestore();
    first.dispose();
    second.dispose();
    first.container.remove();
    second.container.remove();
  });

  it('serializes two windows behind the mock lock: exactly one journal write survives (G01)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Pass-through for the two START claims, then hold the gate so both
    // windows' submissions queue and serialize behind the mutual-exclusion
    // lock (PlacementSession.test convention).
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
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const tabA = mount(languageData, { locks: gating });
    const tabB = mount(languageData, { locks: gating }); // shares the same lock + localStorage

    await startBlueprint(tabA.container, 3);
    // B's start ADOPTS the live session A holds instead of starting a
    // clobbering second one.
    await startBlueprint(tabB.container, 3);
    expect(tabB.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!).cursor).toBe(0);

    const itemIdA = (tabA.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    const itemIdB = (tabB.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    expect(itemIdB).toBe(itemIdA); // both windows present the SAME step

    (tabA.container.querySelectorAll('.mock-exam__option')[gold.get(itemIdA)!] as HTMLElement).click();
    (tabB.container.querySelectorAll('.mock-exam__option')[gold.get(itemIdB)!] as HTMLElement).click();
    // The gate is held: neither submission has run.
    expect(tabA.onAttempt).not.toHaveBeenCalled();
    expect(tabB.onAttempt).not.toHaveBeenCalled();
    release();
    await tick();
    await tick();
    // Exactly ONE canonical attempt survives the mutual exclusion; the
    // stale second submission is dropped and the durable state adopted.
    expect(tabA.onAttempt.mock.calls.length + tabB.onAttempt.mock.calls.length).toBe(1);
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!).cursor).toBe(1);
    // Both windows converge on the SAME next step (the loser adopted).
    const nextA = (tabA.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id');
    const nextB = (tabB.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id');
    expect(nextB).toBe(nextA);
    tabA.dispose();
    tabB.dispose();
    tabA.container.remove();
    tabB.container.remove();
  });

  it('a stale window cannot submit into a session another window paused (G01/R13)', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const tabB = mount(languageData); // idle first
    const tabA = mount(languageData);
    await startBlueprint(tabA.container, 3);
    const itemId = (tabA.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    // The session's start reaches B through the storage event (raw
    // adoption): B presents the same step with the same durable content.
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'mlearn-mock-session:de',
      newValue: globalThis.localStorage!.getItem('mlearn-mock-session:de')!,
    }));
    await tick();
    expect((tabB.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')).toBe(itemId);

    // A pauses (persisted). B has not received a storage event yet: its copy
    // is stale (unpaused, same cursor).
    (tabA.container.querySelector('[data-testid="mock-pause-btn"]') as HTMLElement).click();
    await tick();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!).pauses).toHaveLength(1);

    // B's stale unpaused submit queues for the lock, finds the durable
    // fingerprint changed (pause history), and is DROPPED with the paused
    // durable state adopted — no evidence, and A's pause is never clobbered.
    (tabB.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
    await tick();
    await tick();
    expect(tabB.onAttempt).not.toHaveBeenCalled();
    expect(tabA.onAttempt).not.toHaveBeenCalled();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!).pauses).toHaveLength(1);
    expect(tabB.container.querySelector('[data-testid="mock-paused-note"]')).toBeTruthy();
    tabA.dispose();
    tabB.dispose();
    tabA.container.remove();
    tabB.container.remove();
  });

  it('a durable-write failure refuses the submission: no evidence, prompt retryable, honest note (G01/G04)', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    const itemId = (harness.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;

    // Quota injection BEFORE the answer: the staged cursor write throws, so
    // the durable cursor still points at the presented step.
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    (harness.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
    await beat();
    // The canonical writer was NEVER invoked: no evidence without a cursor
    // (previously the journal write happened before the swallowed persist).
    expect(harness.onAttempt).not.toHaveBeenCalled();
    const storedDuring = globalThis.localStorage!.getItem('mlearn-mock-session:de')!;
    expect(JSON.parse(storedDuring).cursor).toBe(0);
    setItem.mockRestore();

    // The presented prompt stays retryable: same step, honest note, and a
    // retry after storage recovers records exactly one attempt and advances
    // the durable cursor exactly once.
    expect((harness.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')).toBe(itemId);
    expect(harness.container.querySelector('[data-testid="mock-storage-unavailable"]')).toBeTruthy();
    (harness.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
    await beat();
    expect(harness.onAttempt).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector('[data-testid="mock-storage-unavailable"]')).toBeNull();
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!).cursor).toBe(1);
    harness.dispose();
    harness.container.remove();
  });

  it('a journal rejection keeps the stable reservation and the same mock step retryable (G01)', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const harness = mount(languageData);
    await startBlueprint(harness.container, 3);
    const itemId = (harness.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    harness.onAttempt.mockRejectedValueOnce(new Error('journal unavailable'));

    (harness.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
    await beat();
    const pending = JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!);
    expect(pending.cursor).toBe(1);
    expect(pending.answers[0].pendingAttemptId).toEqual(expect.any(String));
    expect((harness.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')).toBe(itemId);
    expect(harness.container.querySelector('[data-testid="mock-storage-unavailable"]')).toBeTruthy();

    (harness.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLElement).click();
    await beat();
    expect(harness.onAttempt).toHaveBeenCalledTimes(2);
    expect(JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!).cursor).toBe(1);
    expect(harness.container.querySelector('[data-testid="mock-storage-unavailable"]')).toBeNull();
    harness.dispose();
    harness.container.remove();
  });

  it('reconciles a nonterminal interrupted submission with the same pending id after remount (G01)', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const first = mount(languageData);
    await startBlueprint(first.container, 3);
    first.onAttempt.mockImplementation(() => new Promise<AttemptId>(() => {}));
    const itemId = (first.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    (first.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLButtonElement).click();
    await beat();
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!);
    const attemptId = stored.answers[0].pendingAttemptId as string;
    expect(stored.cursor).toBe(1);
    expect(first.onAttempt.mock.calls[0][1]).toBe(attemptId);
    first.dispose();
    first.container.remove();

    const second = mount(languageData);
    await tick();
    await tick();
    expect(second.onAttempt.mock.calls[0][1]).toBe(attemptId);
    const resumed = JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!);
    expect(resumed.cursor).toBe(1);
    expect(resumed.answers[0]).toMatchObject({ attemptId });
    expect(resumed.answers[0].pendingAttemptId).toBeUndefined();
    second.dispose();
    second.container.remove();
  });

  it('keeps a final-step pending submission resumable until remount reconciliation (G01)', async () => {
    const languageData = baseLanguageData();
    const gold = goldIndexById(languageData);
    const first = mount(languageData);
    await startBlueprint(first.container, 2);
    first.onAttempt.mockImplementation(() => new Promise<AttemptId>(() => {}));
    const itemId = (first.container.querySelector('.mock-exam__context') as HTMLElement).getAttribute('data-item-id')!;
    (first.container.querySelectorAll('.mock-exam__option')[gold.get(itemId)!] as HTMLButtonElement).click();
    await beat();
    const stored = JSON.parse(globalThis.localStorage!.getItem('mlearn-mock-session:de')!);
    const attemptId = stored.answers[0].pendingAttemptId as string;
    expect(stored.finishedAt).toEqual(expect.any(Number));
    expect(first.onAttempt.mock.calls[0][1]).toBe(attemptId);
    first.dispose();
    first.container.remove();

    const second = mount(languageData);
    await tick();
    await tick();
    expect(second.onAttempt.mock.calls[0][1]).toBe(attemptId);
    expect(globalThis.localStorage!.getItem('mlearn-mock-session:de')).toBeNull();
    expect(second.container.querySelector('[data-testid="mock-results"]')).toBeTruthy();
    second.dispose();
    second.container.remove();
  });

  it('a start whose durable write fails never starts a cursorless session (G01/G04)', async () => {
    const languageData = baseLanguageData();
    const harness = mount(languageData);
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    const start = harness.container.querySelector('[data-testid="mock-start-3"]') as HTMLButtonElement;
    start.click();
    await tick();
    setItem.mockRestore();
    // No session was published and nothing durable exists to resume: the
    // honest note replaces a silently broken session, and Start stays
    // retryable once storage recovers.
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeNull();
    expect(globalThis.localStorage!.getItem('mlearn-mock-session:de')).toBeNull();
    expect(harness.container.querySelector('[data-testid="mock-storage-unavailable"]')).toBeTruthy();
    await startBlueprint(harness.container, 3);
    expect(harness.container.querySelector('[data-testid="mock-session"]')).toBeTruthy();
    harness.dispose();
    harness.container.remove();
  });
});
