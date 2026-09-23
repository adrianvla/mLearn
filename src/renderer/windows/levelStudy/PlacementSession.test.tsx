// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';
import PlacementSession, { backgroundRecordsForLanguage, nextBackgroundId, type PlacementLocks } from './PlacementSession';
import type { PlacementPool } from './PlacementSession';
import type { AttemptQuality } from '../../../shared/constants';
import type { AttemptTiming } from '../../../shared/encounterTiming';
import type { HistoricalBackgroundRecord } from '../../../shared/learningBackground';

vi.mock('../../context', () => ({
  useSettings: () => ({ settings: { ratingKeyboardMode: 'mnemonic' } }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      if (!params) return key;
      // Emulate the real lookup+interpolation: expose the resolved params so
      // tests can assert the values the component actually renders.
      return `${key}:${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')}`;
    },
  }),
}));

// Package-owned scale fixture, difficulty-ascending: level 1 easier than 2.
const pools: PlacementPool[] = [
  { level: 1, label: 'Basic', words: ['w1', 'w2', 'w3', 'w4'] },
  { level: 2, label: 'Advanced', words: ['x1', 'x2', 'x3', 'x4'] },
];

const isWordAtLevel = (word: string, level: number): boolean =>
  pools.some((pool) => pool.level === level && pool.words.includes(word));

const denominatorFor = (sl: readonly PlacementPool[]): string =>
  sl.flatMap((pool) => pool.words.map((w) => `${w}\u0000${pool.level}`)).sort().join('\u0001');

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const beat = () => new Promise<void>((resolve) => setTimeout(resolve, 170));

type RateCall = { word: string; level: number; quality: AttemptQuality; timing: AttemptTiming | null };

function mount(overrides?: {
  onRate?: (word: string, level: number, quality: AttemptQuality, timing: AttemptTiming | null) => void;
  pools?: PlacementPool[];
  background?: HistoricalBackgroundRecord[];
  declaredLevel?: number | null;
  isLevelAtOrEasierThan?: (level: number, target: number) => boolean;
  isWordAtLevel?: (word: string, level: number) => boolean;
  isWordIgnored?: (word: string) => boolean;
  booting?: boolean;
  onAddBackground?: Mock;
  onRemoveBackground?: Mock;
  onApplyPlacement?: Mock;
  /** `null` simulates a lock-less environment (placement disabled, G04);
   *  omitted/default uses a pass-through fake lock for the serialized path. */
  locks?: PlacementLocks | null;
}) {
  const locks = Object.prototype.hasOwnProperty.call(overrides ?? {}, 'locks')
    ? overrides!.locks ?? null
    : { request: (_name: string, cb: () => void) => { cb(); return Promise.resolve(); } };
  const rateCalls: RateCall[] = [];
  const onRate = overrides?.onRate ?? ((word: string, level: number, quality: AttemptQuality, timing: AttemptTiming | null) => {
    rateCalls.push({ word, level, quality, timing });
  });
  const onApplyPlacement: Mock = overrides?.onApplyPlacement ?? vi.fn();
  const onAddBackground: Mock = overrides?.onAddBackground ?? vi.fn();
  const onRemoveBackground: Mock = overrides?.onRemoveBackground ?? vi.fn();
  const [livePools, setLivePools] = createSignal<PlacementPool[]>(overrides?.pools ?? pools);
  const [booting, setBooting] = createSignal(overrides?.booting ?? false);
  const [validator, setValidator] = createSignal(overrides?.isWordAtLevel ?? isWordAtLevel);
  const [language, setLanguage] = createSignal('ja');
  // Non-keyed mount: the SAME component instance survives a language switch,
  // so queued lock callbacks genuinely observe live props — the exact race
  // the G01/R19 finding describes (a keyed <Show> would dispose and mask it).
  const [keyed, setKeyed] = createSignal(true);
  const container = document.createElement('div');
  // Solid attaches delegated listeners on the document; container must be
  // connected for bubbled clicks to reach them (see DECISIONS D10).
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <Show when={language()} keyed={keyed() as false | undefined}>
        {(keyedLanguage) => {
          const currentLanguage = typeof keyedLanguage === 'function'
            ? (keyedLanguage as unknown as () => string)()
            : keyedLanguage as string;
          return (
            <PlacementSession
              language={currentLanguage}
              pools={livePools()}
              booting={booting()}
              isWordAtLevel={(word, level) => validator()(word, level)}
        isWordIgnored={overrides?.isWordIgnored}
              background={overrides?.background ?? []}
              onAddBackground={onAddBackground}
              onRemoveBackground={onRemoveBackground}
              declaredLevel={overrides?.declaredLevel ?? null}
              isLevelAtOrEasierThan={overrides?.isLevelAtOrEasierThan ?? ((level: number, target: number) => level <= target)}
              onRate={onRate}
              onApplyPlacement={onApplyPlacement}
              locks={locks}
            />
          );
        }}
      </Show>
    ),
    container,
  );
  const expand = async () => {
    (container.querySelector('.placement-session__header') as HTMLElement).click();
    await tick();
  };
  const start = async () => {
    (container.querySelector('.placement-session__start') as HTMLElement).click();
    await tick();
  };
  const promptWord = () => container.querySelector('.placement-session__prompt')?.getAttribute('data-word');
  const clickRate = async (index: number) => {
    const buttons = Array.from(container.querySelectorAll('.placement-session__probe .rating-matrix__quality')) as HTMLElement[];
    buttons[index]!.click();
    await beat();
  };
  return { container, dispose, rateCalls, setKeyed, onApplyPlacement, onAddBackground, onRemoveBackground, expand, start, promptWord, clickRate, setLivePools, setBooting, setValidator, setLanguage };
}

describe('nextBackgroundId (background record identity)', () => {
  it('never reuses an ID across windows within the same millisecond (Codex POST_REVIEW minor)', () => {
    // Two renderer windows are separate module instances: a module-scoped
    // counter cannot disambiguate them, so the fallback must mix independent
    // random draws into the same wall-clock stamp. Force the fallback path
    // deterministically (no crypto) and freeze both the clock and the draws.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let draw = 0;
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      draw += 1;
      return draw === 1 ? 0.5 : 0.75;
    });
    try {
      vi.stubGlobal('crypto', undefined); // force the no-UUID fallback path
      const first = nextBackgroundId();
      const second = nextBackgroundId();
      expect(first).not.toBe(second);
      expect(first).toMatch(/^bg-0-/); // wall-clock stamp present, random suffix differs
    } finally {
      vi.unstubAllGlobals();
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('PlacementSession (R09 returning-learner placement)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('rates the sampled surface through the shared matrix with digits and Adjust', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    expect(harness.container.querySelector('.rating-matrix')).not.toBeNull();
    const first = harness.promptWord();
    (harness.container.querySelector('.rating-matrix__adjust') as HTMLButtonElement).click();
    expect(harness.container.textContent).toContain('mlearn.Knowledge.Capability.surface-recognition');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4' }));
    await beat();
    expect(harness.rateCalls[0]).toMatchObject({ word: first, quality: 'fluent' });
    expect(harness.promptWord()).not.toBe(first);
    harness.dispose();
  });

  it('never starts by itself: Start is the only entry into the probe', async () => {
    const harness = mount();
    await harness.expand();
    expect(harness.container.querySelector('.placement-session__start')).toBeTruthy();
    expect(harness.promptWord()).toBeUndefined();
    expect(harness.container.querySelector('.placement-session__live')).toBeNull();
    await harness.start();
    expect(harness.promptWord()).toBe('x1'); // hardest band probed first
    // Start is durably recorded immediately (zero-draw state included).
    expect(JSON.parse(localStorage.getItem('mlearn-placement:ja')!).draws).toEqual([]);
    harness.dispose();
  });

  it('resumes a session interrupted right after Start into the waiting first prompt', async () => {
    const first = mount();
    await first.expand();
    await first.start();
    first.dispose(); // crash before any draw
    const second = mount();
    await second.expand();
    expect(second.container.querySelector('.placement-session__start')).toBeNull(); // resumed, not restarted
    expect(second.promptWord()).toBe('x1');
    second.dispose();
  });

  it('persists the draw cursor before writing evidence, so a crash can never re-present a rated word', async () => {
    let storageAtEvidence: string | null = null;
    const evidenceSpy = vi.fn(() => {
      // Runs INSIDE the evidence write: the cursor must already be durable.
      storageAtEvidence = localStorage.getItem('mlearn-placement:ja');
    });
    const harness = mount({ onRate: evidenceSpy });
    await harness.expand();
    await harness.start();
    await harness.clickRate(2); // fluent x1
    expect(evidenceSpy).toHaveBeenCalledTimes(1);
    expect(storageAtEvidence).not.toBeNull();
    const persisted = JSON.parse(storageAtEvidence!) as { draws: Array<{ key: string; outcome: string }> };
    expect(persisted.draws).toEqual([{ key: 'x1', level: 2, outcome: 'fluent' }]);
    // And the evidence exists exactly once for the consumed word.
    expect(harness.rateCalls).toHaveLength(0); // the override replaced the default recorder
    expect(evidenceSpy).toHaveBeenCalledWith('x1', 2, 'fluent', expect.anything());
    harness.dispose();
  });

  it('labels every background-form field for assistive technology', async () => {
    const harness = mount();
    await harness.expand();
    (harness.container.querySelector('.placement-session__add') as HTMLElement).click();
    await tick();
    for (const selector of [
      '.placement-session__form-kind',
      '.placement-session__form-label',
      '.placement-session__form-level',
      '.placement-session__form-date',
      '.placement-session__form-note',
      '.placement-session__form-skills',
      '.placement-session__form-score',
    ]) {
      const field = harness.container.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
      expect(field, selector).toBeTruthy();
      expect(field.getAttribute('aria-label'), selector).toBeTruthy();
    }
    // Per-skill score inputs appear per parsed skill token and are labelled
    // with that skill's own name.
    const set = (selector: string, value: string) => {
      const field = harness.container.querySelector(selector) as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('.placement-session__form-skills', 'reading, listening');
    await tick();
    const skillScores = Array.from(harness.container.querySelectorAll('.placement-session__form-skill-score')) as HTMLInputElement[];
    expect(skillScores).toHaveLength(2);
    expect(skillScores[0]!.getAttribute('aria-label')).toContain('reading');
    expect(skillScores[1]!.getAttribute('aria-label')).toContain('listening');
    harness.dispose();
  });

  it('samples a balanced cross-section, records real attempts with clean timing, and recommends with a trace', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    // Round robin: x1, w1, x2, w2, then x3 completes the Advanced streak.
    for (let i = 0; i < 5; i += 1) await harness.clickRate(2); // fluent
    expect(harness.rateCalls).toHaveLength(5);
    expect(harness.rateCalls.map((call) => call.word)).toEqual(['x1', 'w1', 'x2', 'w2', 'x3']);
    for (const call of harness.rateCalls) {
      expect(call.quality).toBe('fluent'); // the clicked rating, never a timing-derived conversion
      expect(call.timing).not.toBeNull();
      expect(call.timing!.wallLatencyMs).toBeGreaterThanOrEqual(call.timing!.activeLatencyMs);
    }
    const summary = harness.container.querySelector('[data-testid="placement-summary"]');
    expect(summary).toBeTruthy();
    expect(summary!.textContent).toContain('mlearn.LevelStudy.Placement.Placement');
    const rows = Array.from(harness.container.querySelectorAll('.placement-session__trace-row'));
    expect(rows.map((row) => row.getAttribute('data-category'))).toEqual(['1', '2']);
    // The applied level is an explicit learner action.
    (harness.container.querySelector('.placement-session__apply') as HTMLElement).click();
    await tick();
    expect(harness.onApplyPlacement).toHaveBeenCalledWith(2);
    harness.dispose();
  });

  it('tells an underconfident learner they can move ahead above the declared level', async () => {
    const harness = mount({ declaredLevel: 1 });
    await harness.expand();
    await harness.start();
    for (let i = 0; i < 5; i += 1) await harness.clickRate(2); // fluent
    expect(harness.container.querySelector('.placement-session__move-ahead')).toBeTruthy();
    harness.dispose();
  });

  it('keeps the move-ahead signal honest on package scales where raw numbers order inversely (R19)', async () => {
    // JLPT-like: raw 5 is EASIER than raw 1; pools stay difficulty-ascending.
    const reversedPools: PlacementPool[] = [
      { level: 5, label: 'N5', words: ['e1', 'e2', 'e3', 'e4'] },
      { level: 1, label: 'N1', words: ['h1', 'h2', 'h3', 'h4'] },
    ];
    const harness = mount({
      pools: reversedPools,
      declaredLevel: 5, // learner declared N5
      isLevelAtOrEasierThan: (level, target) => level >= target, // higher raw = easier
      isWordAtLevel: (word, level) => reversedPools.some((pool) => pool.level === level && pool.words.includes(word)),
    });
    await harness.expand();
    await harness.start();
    for (let i = 0; i < 5; i += 1) await harness.clickRate(2); // fluent everywhere
    // Placement lands on N1 (raw 1): numerically BELOW the declared 5, but
    // harder on the package's scale — move-ahead must still fire.
    expect(harness.container.querySelector('.placement-session__move-ahead')).toBeTruthy();
    harness.dispose();
  });

  it('flags an alt-tab attempt as interrupted and keeps only clean samples in the baseline (R11)', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    await harness.clickRate(2); // clean sample
    // Alt-tab mid-prompt: the timer pauses and the attempt must carry the
    // interruption flag — its active time is audit, not a clean baseline sample.
    window.dispatchEvent(new Event('blur'));
    await harness.clickRate(2);
    expect(harness.rateCalls[1]!.timing?.interrupted).toBe(true);
    for (let i = 0; i < 3; i += 1) await harness.clickRate(2);
    expect(harness.rateCalls).toHaveLength(5);
    // Summary reached with enough clean samples for a baseline at all.
    expect(harness.container.querySelector('[data-testid="placement-summary"]')).toBeTruthy();
    expect(harness.container.querySelector('.placement-session__latency')).toBeTruthy();
    harness.dispose();
  });

  it('keeps the live session mounted through a projection boot flip (integration blocker regression)', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    expect(harness.promptWord()).toBe('x1');
    // A rating bumps eventsVersion -> projections reload -> the hosting tab
    // flips booting true. The panel must stay STATEFUL: DOM hides, then the
    // SAME pending prompt returns — no restart, no lost cursor.
    harness.setBooting(true);
    await tick();
    expect(harness.container.querySelector('.placement-session__live')).toBeNull();
    harness.setBooting(false);
    await tick();
    expect(harness.promptWord()).toBe('x1');
    await harness.clickRate(2);
    expect(harness.rateCalls.map((call) => call.word)).toEqual(['x1']);
    harness.dispose();
  });

  it('keeps an active session operable when live pools empty mid-session (G04)', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    // Another surface consumed the remaining untracked words: the live pools
    // empty, but the session runs on its own stored snapshot.
    harness.setLivePools([]);
    await tick();
    expect(harness.container.querySelector('.placement-session__no-pool')).toBeNull(); // not stuck behind EmptyPools
    expect(harness.promptWord()).toBe('x1');
    await harness.clickRate(2);
    expect(harness.rateCalls.map((call) => call.word)).toEqual(['x1']);
    harness.dispose();
  });

  it('requires the achieved date for exam and school records but keeps self-assessments flexible', async () => {
    const harness = mount();
    await harness.expand();
    (harness.container.querySelector('.placement-session__add') as HTMLElement).click();
    await tick();
    const save = () => harness.container.querySelector('.placement-session__form-save') as HTMLButtonElement;
    const set = (selector: string, value: string) => {
      const field = harness.container.querySelector(selector) as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('.placement-session__form-label', 'Goethe B2');
    await tick();
    expect(save().disabled).toBe(true); // exam without a date
    expect(harness.container.querySelector('.placement-session__date-required')).toBeTruthy();
    set('.placement-session__form-date', '2025-06-30');
    await tick();
    expect(save().disabled).toBe(false);
    save().click();
    await tick();
    expect(harness.onAddBackground.mock.calls[0]![0]).toMatchObject({ kind: 'exam', label: 'Goethe B2', completedAt: '2025-06-30' });

    (harness.onAddBackground as Mock).mockClear();
    (harness.container.querySelector('.placement-session__add') as HTMLElement).click();
    await tick();
    const kind = harness.container.querySelector('.placement-session__form-kind') as HTMLSelectElement;
    kind.value = 'self-assessment';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    set('.placement-session__form-label', 'self estimate');
    await tick();
    expect(save().disabled).toBe(false); // self-assessment stays undated
    save().click();
    await tick();
    expect((harness.onAddBackground.mock.calls[0]![0] as HistoricalBackgroundRecord).completedAt).toBeUndefined();
    harness.dispose();
  });

  it('captures supplied scores as structured provenance, dropping scores whose skill token is gone (R09)', async () => {
    const harness = mount();
    await harness.expand();
    (harness.container.querySelector('.placement-session__add') as HTMLElement).click();
    await tick();
    const set = (selector: string, value: string) => {
      const field = harness.container.querySelector(selector) as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('.placement-session__form-label', 'Goethe B2');
    set('.placement-session__form-date', '2025-06-30');
    set('.placement-session__form-skills', 'reading, listening');
    await tick();
    set('.placement-session__form-score', '72/100');
    const skillInputs = Array.from(harness.container.querySelectorAll('.placement-session__form-skill-score')) as HTMLInputElement[];
    expect(skillInputs).toHaveLength(2);
    skillInputs[0]!.value = '24/30';
    skillInputs[0]!.dispatchEvent(new Event('input', { bubbles: true }));
    skillInputs[1]!.value = '21/25';
    skillInputs[1]!.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    // The learner drops the listening token: its typed score must not become
    // an orphan provenance entry.
    set('.placement-session__form-skills', 'reading');
    await tick();
    (harness.container.querySelector('.placement-session__form-save') as HTMLElement).click();
    await tick();
    expect(harness.onAddBackground).toHaveBeenCalledTimes(1);
    const added = harness.onAddBackground.mock.calls[0]![0] as HistoricalBackgroundRecord;
    expect(added.skillScope).toEqual(['reading']);
    expect(added.score).toEqual({ overall: '72/100', skills: { reading: '24/30' } });
    // An entry with no score content carries no score field at all.
    (harness.onAddBackground as Mock).mockClear();
    (harness.container.querySelector('.placement-session__add') as HTMLElement).click();
    await tick();
    // Undated kind, so the save is enabled without a date.
    const kind = harness.container.querySelector('.placement-session__form-kind') as HTMLSelectElement;
    kind.value = 'self-assessment';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    set('.placement-session__form-label', 'self estimate');
    set('.placement-session__form-score', '   ');
    (harness.container.querySelector('.placement-session__form-save') as HTMLElement).click();
    await tick();
    expect((harness.onAddBackground.mock.calls[0]![0] as HistoricalBackgroundRecord).score).toBeUndefined();
    harness.dispose();
  });

  it('shows a stored record’s supplied score as verbatim provenance (R09)', async () => {
    const background: HistoricalBackgroundRecord[] = [{
      id: 'bg-1',
      language: 'ja',
      kind: 'exam',
      label: 'Old JLPT N3',
      level: 'N3',
      recordedAt: 1_733_000_000_000,
      score: { overall: '86', skills: { reading: '30' } },
    }];
    const harness = mount({ background });
    await harness.expand();
    const record = harness.container.querySelector('.placement-session__record');
    expect(record?.textContent).toContain('86 · reading 30');
    harness.dispose();
  });

  it('restores a durable session only once package data is ready (boot-window mount)', async () => {
    // Tab-root mounting means the panel can be created while the package
    // data is still absent: a validator over an empty frequency map must not
    // discard the durable session before the data arrives.
    let packageReady = false;
    const denominatorEntries: string[] = [];
    for (const pool of pools) {
      for (const word of pool.words) denominatorEntries.push(`${word}\u0000${pool.level}`);
    }
    localStorage.setItem('mlearn-placement:ja', JSON.stringify({
      language: 'ja',
      sessionId: 'seed-boot-window',
      denominator: denominatorEntries.sort().join('\u0001'),
      pools,
      draws: [{ key: 'x1', level: 2, outcome: 'fluent' }],
    }));

    const harness = mount({
      booting: true,
      isWordAtLevel: (word, level) => packageReady && isWordAtLevel(word, level),
    });
    await harness.expand();
    await tick();
    // While booting, restore waits — and storage is left untouched.
    expect(harness.promptWord()).toBeUndefined();
    expect(localStorage.getItem('mlearn-placement:ja')).not.toBeNull();

    packageReady = true; // package data arrives
    // Only the booting flip drives restore (no validator-signal flips here):
    // the pre-fix restore effect lacked the booting dependency, so this test
    // fails unless restore actually waits for (and reacts to) the ready flip.
    harness.setBooting(false);
    await tick();
    // The durable session is restored, replaying the recorded draw.
    expect(harness.container.querySelector('.placement-session__start')).toBeNull();
    expect(harness.promptWord()).toBe('w1');
    expect(localStorage.getItem('mlearn-placement:ja')).not.toBeNull();
    await harness.clickRate(2);
    expect(harness.rateCalls.map((call) => call.word)).toEqual(['w1']);
    harness.dispose();
  });

  it('skip is non-epistemic and persists across a remount (G01/G04)', async () => {
    const first = mount();
    await first.expand();
    await first.start();
    const skipButton = first.container.querySelector('.placement-session__skip') as HTMLElement;
    skipButton.click();
    await beat();
    expect(first.rateCalls).toHaveLength(0); // a skip records nothing
    expect(first.promptWord()).toBe('w1'); // balance moves to the untouched band
    first.dispose();

    const second = mount();
    await second.expand();
    expect(second.container.querySelector('.placement-session__start')).toBeNull(); // resumed, not restarted
    expect(second.promptWord()).toBe('w1'); // the skipped draw is not re-presented
    await second.clickRate(2);
    expect(second.rateCalls.map((call) => call.word)).toEqual(['w1']);
    second.dispose();
  });

  it('discards corrupt or stale stored sessions instead of resuming them', async () => {
    localStorage.setItem('mlearn-placement:ja', '{not json');
    const corrupt = mount();
    await corrupt.expand();
    expect(corrupt.container.querySelector('.placement-session__start')).toBeTruthy();
    corrupt.dispose();

    localStorage.setItem('mlearn-placement:ja', JSON.stringify({
      language: 'ja',
      denominator: 'x',
      pools: [{ level: 1, label: 'Ghost', words: ['ghost-word'] }],
      draws: [],
    }));
    const stale = mount();
    await stale.expand();
    expect(stale.container.querySelector('.placement-session__start')).toBeTruthy();
    stale.dispose();
  });

  it('discards a stored session whose draw list no longer replays in deterministic order', async () => {
    // Valid keys, valid pool membership — but the WRONG order: the sampler's
    // first draw is the harder band (x1), so [w1, x1] cannot replay (G01).
    const entries: string[] = [];
    for (const pool of pools) {
      for (const word of pool.words) entries.push(`${word}\u0000${pool.level}`);
    }
    const denominator = entries.sort().join('\u0001');
    localStorage.setItem('mlearn-placement:ja', JSON.stringify({
      language: 'ja',
      sessionId: 'replay-order-corrupt',
      denominator,
      pools,
      draws: [
        { key: 'w1', level: 1, outcome: 'fluent' },
        { key: 'x1', level: 2, outcome: 'fluent' },
      ],
    }));
    const harness = mount();
    await harness.expand();
    expect(harness.container.querySelector('.placement-session__start')).toBeTruthy();
    expect(harness.promptWord()).toBeUndefined();
    // The corrupt entry is cleared, not left behind for the next mount.
    expect(localStorage.getItem('mlearn-placement:ja')).toBeNull();
    harness.dispose();
  });

  it('restarts timing from a fresh prompt after the panel is collapsed mid-session', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    (harness.container.querySelector('.placement-session__header') as HTMLElement).click(); // collapse
    await tick();
    (harness.container.querySelector('.placement-session__header') as HTMLElement).click(); // re-expand
    await tick();
    expect(harness.promptWord()).toBe('x1'); // same pending prompt, no silent advance
    await harness.clickRate(2);
    expect(harness.rateCalls).toHaveLength(1);
    expect(harness.rateCalls[0]!.timing).not.toBeNull(); // a fresh timer measured this prompt
    harness.dispose();
  });

  it('degrades honestly when no unmeasured words exist (G04)', async () => {
    const harness = mount({ pools: [] });
    await harness.expand();
    expect(harness.container.querySelector('.placement-session__no-pool')?.textContent).toContain('mlearn.LevelStudy.Placement.EmptyPools');
    expect(harness.container.querySelector('.placement-session__start')).toBeNull();
    harness.dispose();
  });

  it('records dated background as data only, without touching knowledge', async () => {
    const background: HistoricalBackgroundRecord[] = [{
      id: 'bg-1',
      language: 'ja',
      kind: 'exam',
      label: 'Old JLPT N3',
      level: 'N3',
      completedAt: '2024-12-01',
      recordedAt: 1_733_000_000_000,
    }];
    const harness = mount({ background });
    await harness.expand();
    const record = harness.container.querySelector('.placement-session__record');
    expect(record?.textContent).toContain('Old JLPT N3');
    (harness.container.querySelector('.placement-session__record-remove') as HTMLElement).click();
    await tick();
    expect(harness.onRemoveBackground).toHaveBeenCalledWith('bg-1');

    // Adding a new dated record goes through the language-scoped callback.
    (harness.container.querySelector('.placement-session__add') as HTMLElement).click();
    await tick();
    const labelInput = harness.container.querySelector('.placement-session__form-label') as HTMLInputElement;
    labelInput.value = 'Goethe B2 2025';
    labelInput.dispatchEvent(new Event('input', { bubbles: true }));
    const dateInput = harness.container.querySelector('.placement-session__form-date') as HTMLInputElement;
    dateInput.value = '2025-06-30';
    dateInput.dispatchEvent(new Event('input', { bubbles: true }));
    const skillsInput = harness.container.querySelector('.placement-session__form-skills') as HTMLInputElement;
    skillsInput.value = 'reading, listening';
    skillsInput.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    (harness.container.querySelector('.placement-session__form-save') as HTMLElement).click();
    await tick();
    expect(harness.onAddBackground).toHaveBeenCalledTimes(1);
    const added = harness.onAddBackground.mock.calls[0]![0] as HistoricalBackgroundRecord;
    expect(added).toMatchObject({ language: 'ja', kind: 'exam', label: 'Goethe B2 2025', skillScope: ['reading', 'listening'] });
    expect(typeof added.recordedAt).toBe('number');
    harness.dispose();
  });

  it('scopes stored background to the record language and drops malformed rows', () => {
    const records = backgroundRecordsForLanguage([
      { id: 'a', language: 'ja', kind: 'exam', label: 'N3', recordedAt: 1 },
      { id: 'b', language: 'de', kind: 'exam', label: 'B2', recordedAt: 2 },
      { id: 'c', language: 'ja', kind: 'bogus', label: 'x', recordedAt: 3 },
      'junk',
    ], 'ja');
    expect(records.map((record) => record.id)).toEqual(['a']);
  });

  it('drops a finished Japanese summary and never applies its level after switching to German (R19/G01)', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    for (let i = 0; i < 5; i += 1) await harness.clickRate(2); // fluent everywhere -> L2 secure
    expect(harness.container.querySelector('[data-testid="placement-summary"]')).toBeTruthy();
    expect(harness.container.querySelector('.placement-session__apply')).toBeTruthy();

    harness.setLanguage('de');
    await tick();
    // The completed summary and its UseLevel are gone; the switch also
    // collapsed the panel (nothing from Japanese can carry over). Re-opening
    // shows only the idle Start — no stale level can be applied to German.
    expect(harness.container.querySelector('[data-testid="placement-summary"]')).toBeNull();
    expect(harness.container.querySelector('.placement-session__apply')).toBeNull();
    await harness.expand();
    expect(harness.container.querySelector('.placement-session__start')).toBeTruthy();
    harness.dispose();
  });

  it('never writes a pre-switch Japanese snapshot under the German storage key mid-session', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    await harness.clickRate(2); // one Japanese rating, persisted under ja
    expect(JSON.parse(localStorage.getItem('mlearn-placement:ja')!)).toMatchObject({ draws: [{ key: 'x1', level: 2, outcome: 'fluent' }] });
    expect(localStorage.getItem('mlearn-placement:de')).toBeNull();

    harness.setLanguage('de');
    await tick();
    // The German key stays empty (no stale ja snapshot lands there) ...
    expect(localStorage.getItem('mlearn-placement:de')).toBeNull();
    // ... while the Japanese session remains intact under its own key.
    expect(localStorage.getItem('mlearn-placement:ja')).not.toBeNull();
    harness.dispose();
  });

  it('restores a pre-existing destination session instead of clobbering it on language switch', async () => {
    localStorage.setItem('mlearn-placement:de', JSON.stringify({
      language: 'de',
      sessionId: 'preexisting-destination',
      denominator: denominatorFor(pools),
      pools,
      draws: [{ key: 'x1', level: 2, outcome: 'fluent' }],
    }));
    const harness = mount();
    await harness.expand();
    await harness.start();
    await harness.clickRate(2); // ja session: x1 fluent

    harness.setLanguage('de');
    await tick();
    await harness.expand();
    // The pre-existing German session is restored (x1 consumed -> w1), not
    // overwritten by the Japanese snapshot.
    expect(harness.promptWord()).toBe('w1');
    expect(JSON.parse(localStorage.getItem('mlearn-placement:de')!)).toMatchObject({ draws: [{ key: 'x1', level: 2, outcome: 'fluent' }] });
    harness.dispose();
  });

  it('arbitrates cross-tab duplicate submissions: a second tab cannot re-rate a word the first consumed (G01)', async () => {
    const tabA = mount();
    const tabB = mount();
    await tabA.expand();
    await tabB.expand();
    await tabA.start();
    expect(tabA.promptWord()).toBe('x1');
    await tabB.start(); // B resumes the same zero-draw session
    expect(tabB.promptWord()).toBe('x1'); // both tabs present the same pending word

    // Tab A rates x1 and durably persists the draw.
    await tabA.clickRate(2);
    expect(JSON.parse(localStorage.getItem('mlearn-placement:ja')!)).toMatchObject({ draws: [{ key: 'x1', level: 2, outcome: 'fluent' }] });

    // Tab B receives the cross-tab storage write and reloads+replays: its
    // pending word advances past the now-consumed x1.
    const ev = new Event('storage') as StorageEvent;
    Object.defineProperty(ev, 'key', { value: 'mlearn-placement:ja' });
    Object.defineProperty(ev, 'newValue', { value: localStorage.getItem('mlearn-placement:ja') });
    globalThis.dispatchEvent(ev);
    await tick();

    expect(tabB.promptWord()).toBe('w1');
    expect(tabB.rateCalls).toHaveLength(0); // B never rated the shared word
    tabA.dispose();
    tabB.dispose();
  });

  it('adopts another surface\'s advanced cursor instead of duplicating evidence (G01)', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    // Another surface (or tab) rated x1 and persisted first.
    const entry = JSON.parse(localStorage.getItem('mlearn-placement:ja')!) as { language: string; denominator: string; pools: PlacementPool[]; draws: unknown[] };
    entry.draws = [{ key: 'x1', level: 2, outcome: 'fluent' }];
    localStorage.setItem('mlearn-placement:ja', JSON.stringify(entry));

    await harness.clickRate(2); // our stale rating of x1
    // No duplicate evidence: the stale submission is dropped and the cursor
    // adopted — the prompt advances to the word after x1.
    expect(harness.rateCalls).toHaveLength(0);
    expect(harness.promptWord()).toBe('w1');
    const persisted = JSON.parse(localStorage.getItem('mlearn-placement:ja')!);
    expect(persisted.draws).toHaveLength(1); // still exactly the other surface's draw
    harness.dispose();
  });

  it('drops a stale submission against a same-length restarted session (G01 session identity)', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start(); // 0-draw session with its own nonce, durably persisted
    const started = JSON.parse(localStorage.getItem('mlearn-placement:ja')!);
    expect(typeof started.sessionId).toBe('string');
    // Another surface dismissed this session and restarted with the SAME
    // pools: a 0-draw replacement — identical denominator and draw count,
    // different generation. Length-only adoption cannot see it.
    localStorage.setItem('mlearn-placement:ja', JSON.stringify({
      ...started,
      sessionId: 'restarted-generation',
      draws: [],
    }));
    await harness.clickRate(2); // stale rating from the replaced session
    // The stale submission is dropped, never evidenced, and the replacement
    // cursor is adopted intact — no draw is appended to it.
    expect(harness.rateCalls).toHaveLength(0);
    const persisted = JSON.parse(localStorage.getItem('mlearn-placement:ja')!);
    expect(persisted.sessionId).toBe('restarted-generation');
    expect(persisted.draws).toEqual([]);
    expect(harness.promptWord()).toBe('x1'); // the fresh replacement's first pick
    harness.dispose();
  });

  it('a language switch while Start waits for the lock never adopts Japanese state into German (G01/R19)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Hold the FIRST lock claim (the Start); the queued Start callback must
    // run against the captured language when released.
    const gating = {
      request: (_name: string, callback: () => void) => {
        gate.then(() => callback());
        return Promise.resolve();
      },
    };
    const dePools: PlacementPool[] = [
      { level: 1, label: 'Deutsch-Basis', words: ['haus', 'hund', 'katze', 'maus'] },
      { level: 2, label: 'Deutsch-Fort', words: ['baum', 'wasser', 'brot', 'tag'] },
    ];
    const harness = mount({ locks: gating });
    harness.setKeyed(false); // SAME instance across the switch: the queued
    // callback will genuinely observe live German props (Astra race).
    await harness.expand();
    await harness.start(); // queued behind the held ja lock
    harness.setLanguage('de'); // switch while the Start is still queued
    harness.setLivePools(dePools); // German now has DIFFERENT pools
    await tick();
    release(); // lock resolves under German with German pools live
    await tick();
    await tick();
    // The Japanese entry stays under its own key with Japanese pools only;
    // nothing Japanese is adopted into German state or storage.
    const ja = JSON.parse(localStorage.getItem('mlearn-placement:ja')!);
    expect(ja.language).toBe('ja');
    expect(ja.pools).toEqual(pools);
    expect(localStorage.getItem('mlearn-placement:de')).toBeNull();
    expect(harness.promptWord()).toBeUndefined();
    harness.dispose();
  });

  it('serializes concurrent submissions behind the placement Web Lock (G01)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // The lock is pass-through for START, then gates the subsequent rating so
    // the serialization is observable: while the claim is held, the cursor
    // and evidence must not advance until the lock releases.
    let first = true;
    const gating = {
      request: (_name: string, callback: () => void) => {
        if (first) { first = false; callback(); return Promise.resolve(); }
        gate.then(() => callback());
        return Promise.resolve();
      },
    };
    const harness = mount({ locks: gating });
    await harness.expand();
    await harness.start(); // pass-through claim -> live prompt
    await harness.clickRate(2); // rating queued behind the held lock
    // While the lock is held, neither the cursor nor evidence advances.
    expect(harness.rateCalls).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem('mlearn-placement:ja')!)).toMatchObject({ draws: [] });
    release();
    await tick();
    await tick();
    expect(harness.rateCalls).toHaveLength(1); // released -> exactly one evidence write
    expect(JSON.parse(localStorage.getItem('mlearn-placement:ja')!)).toMatchObject({ draws: [{ key: 'x1', level: 2, outcome: 'fluent' }] });
    harness.dispose();
  });

  it('buckets the task-response median by word length class (R11)', async () => {
    // Two bands with words of clearly different lengths; short bucket gets
    // enough samples, long bucket does not.
    const staged = [
      { level: 1, label: 'Basic', words: ['ab', 'cd', 'ef', 'gh'] },
      { level: 2, label: 'Advanced', words: ['longword1', 'longword2', 'longword3', 'longword4'] },
    ];
    const validator = (word: string, level: number): boolean =>
      staged.some((pool) => pool.level === level && pool.words.includes(word));
    const harness = mount({ pools: staged, isWordAtLevel: validator });
    await harness.expand();
    await harness.start();
    // The Advanced band secures first (3 fluent long words); continue until
    // the session completes (no more rate buttons).
    for (let i = 0; i < 8 && harness.container.querySelector('.rating-matrix__quality'); i += 1) {
      await harness.clickRate(2);
    }
    // The dominant bucket is the long-word class (range 8-99), shown on the
    // summary — proving samples are bucketed by the presented word's length
    // rather than blended into one aggregate.
    const latency = harness.container.querySelector('.placement-session__latency');
    expect(latency).toBeTruthy();
    expect(latency?.textContent).toContain('8+'); // the dominant long-word bucket range
    harness.dispose();
  });

  it('keeps exactly one evidence write when two tabs submit the same pending word under mutual exclusion (G01)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Pass-through for the two START claims, then hold the gate so both tabs'
    // ratings queue and serialize behind the mutual-exclusion lock.
    let calls = 0;
    const gating = {
      request: (_name: string, callback: () => void) => {
        calls += 1;
        if (calls <= 2) { callback(); return Promise.resolve(); }
        gate.then(() => callback());
        return Promise.resolve();
      },
    };
    const tabA = mount({ locks: gating });
    const tabB = mount({ locks: gating }); // shares the same lock + localStorage
    await tabA.expand();
    await tabB.expand();
    await tabA.start();
    await tabB.start();
    expect(tabA.promptWord()).toBe('x1');
    expect(tabB.promptWord()).toBe('x1'); // both tabs present the SAME pending word

    await tabA.clickRate(2); // queued behind the held gate
    await tabB.clickRate(2); // queued
    // The gate is held: nothing has run yet.
    expect(tabA.rateCalls.filter((call) => call.word === 'x1')).toHaveLength(0);
    expect(tabB.rateCalls.filter((call) => call.word === 'x1')).toHaveLength(0);

    release();
    await tick();
    await tick();
    // Exactly one evidence write survives the mutual exclusion; the second
    // tab's stale submission (word already consumed) is dropped.
    expect(tabA.rateCalls.length + tabB.rateCalls.length).toBe(1);
    expect(JSON.parse(localStorage.getItem('mlearn-placement:ja')!)).toMatchObject({ draws: [{ key: 'x1', level: 2, outcome: 'fluent' }] });
    tabA.dispose();
    tabB.dispose();
  });

  it('refuses a rating whose cursor cannot be persisted: no evidence, retryable (G01)', async () => {
    const harness = mount();
    await harness.expand();
    await harness.start();
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    await harness.clickRate(2);
    // The durable cursor write failed, so the evidence write is REFUSED: the
    // pending word stays presented (retryable), nothing was recorded.
    expect(harness.rateCalls).toHaveLength(0);
    expect(harness.promptWord()).toBe('x1');
    const persisted = JSON.parse(localStorage.getItem('mlearn-placement:ja')!);
    expect(persisted.draws).toEqual([]); // cursor never moved
    await harness.clickRate(2); // a second failed write must remain retryable too
    expect(harness.rateCalls).toHaveLength(0);
    setItem.mockRestore();
    // Storage healthy again: the same prompt is rateable exactly once.
    await harness.clickRate(2);
    expect(harness.rateCalls.map((call) => call.word)).toEqual(['x1']);
    harness.dispose();
  });

  it('refuses to start and says so when the session cannot be persisted (G04)', async () => {
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const harness = mount();
    await harness.expand();
    await harness.start();
    // Start without a durable write is refused: no prompt, honest message,
    // and the Start affordance STAYS retryable (attempts are harmless).
    expect(harness.promptWord()).toBeUndefined();
    expect(harness.container.textContent).toContain('mlearn.LevelStudy.Placement.NoStorage');
    expect(harness.container.querySelector('.placement-session__start')).not.toBeNull();
    setItem.mockRestore();
    await harness.start(); // storage healthy again: the retry now starts
    expect(harness.promptWord()).toBe('x1');
    expect(harness.container.querySelector('.placement-session__start')).toBeNull();
    harness.dispose();
  });

  it('shows an explicit unknown-date marker for undated exam records and never records without a date (R09)', async () => {
    const background: HistoricalBackgroundRecord[] = [
      { id: 'bg-undated', language: 'ja', kind: 'exam', label: 'Old certificate', recordedAt: 1 },
    ];
    const harness = mount({ background });
    await harness.expand();
    const record = harness.container.querySelector('.placement-session__record');
    expect(record?.textContent).toContain('mlearn.LevelStudy.Placement.DateUnknown');
    harness.dispose();
  });

  it('auto-skips a pending word that becomes ignored mid-session, without evidence (G04)', async () => {
    const harness = mount({ isWordIgnored: (word) => word === 'x1' });
    await harness.expand();
    await harness.start();
    // The ignored word is auto-skipped before it can ever be rated.
    expect(harness.promptWord()).toBe('w1');
    expect(harness.rateCalls).toHaveLength(0);
    await harness.clickRate(2); // rate the next non-ignored word
    expect(harness.rateCalls.map((call) => call.word)).toEqual(['w1']);
    harness.dispose();
  });

  it('degrades honestly without a lock primitive (G04): start hidden, NoLocks shown', async () => {
    const harness = mount({ locks: null });
    await harness.expand();
    // No Web Lock -> placement is DISABLED with an explicit message, never a
    // silently unserialized multi-tab session.
    expect(harness.container.querySelector('.placement-session__start')).toBeNull();
    expect(harness.container.querySelector('.placement-session__no-pool')).toBeTruthy();
    harness.dispose();
  });
});
