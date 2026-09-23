// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import type { HistoricalBackgroundRecord } from '../../../shared/learningBackground';
import { assembleContrastItem, itemContentVersion, questionBankFromLanguageData } from '../../learning/questionBank';
import { wordStorageKey } from '../../utils/wordLevelStats';
import type { GrammarItemSemanticValidation, GrammarPracticeItemSource, LanguageData } from '../../../shared/types';

const refreshLanguageDataMock = vi.fn();
const addLevelStudyFlashcardsMock = vi.fn();
const reconcileGrammarItemsMock = vi.fn(async () => 0);
const getComprehensiveWordStatusSyncMock = vi.fn(() => 'unknown');
const hasWordSyncMock = vi.fn(() => false);
const isWordIgnoredSyncMock = vi.fn<(word: string, language?: string) => boolean>(() => false);
const openWindowMock = vi.fn();
let currentLangDataMock: Record<string, unknown> | null = null;
let installedLangDataMock: Record<string, Record<string, unknown>> = {};
let supportedLanguagesMock: string[] = [];
let wordFrequencyMock: Record<string, unknown> = {};
let settingsLanguageMock = 'ja';
let learningLanguageLevelsMock: Record<string, number> | undefined;
let bulkAddModalPropsMock: Record<string, unknown> | null = null;
let placementPropsMock: Record<string, unknown> | null = null;
let learningBackgroundRecordsMock: unknown[] | undefined;
const updateSettingsMock = vi.fn();
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Canonical grammar/mock writer through the tab's recordGrammarAttempt /
// GrammarCoverage onProbe / MockExam onAttempt paths. Mock attempts carry
// `mock-*` task provenance; the mock writer flips the projections to loading
// for exactly those appends — the production append → eventsVersion →
// projection-reload chain, which unmounts the GrammarCoverage/MockExam
// subtree through the tab's boot gate. Grammar/contrast probes do not flip
// (their appends are exercised by the dedicated suites).
let fixtureAttemptCounter = 0;
const recordGrammarAttemptMock = vi.fn<(pattern: string, quality: string, options?: Record<string, unknown>) => Promise<string>>(
  async () => `fixture-attempt-${fixtureAttemptCounter += 1}`,
);

// Reactive loading state for the useKnowledgeProjections stub (bottom of
// this file): flipping it live is what reproduces the evidence-driven
// unmount/remount cycle inside the mounted tab.
const [projectionLoading, setProjectionLoading] = createSignal(false);

let settingsUiLanguage = 'en';
let llmReadyMock = true;

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: { openWindow: openWindowMock },
    // Grammar-coverage journal queries + the F-N1 journal-key snapshot: the
    // returning-learner tab mounts the same resource, so the stub must
    // answer language-key queries and the change-listener contract.
    knowledgeEvents: {
      queryLanguageKeys: () => Promise.resolve(journalKeysMock),
      queryKnowledgeEvents: () => Promise.resolve({}),
      onKnowledgeEventsChanged: () => () => {},
    },
  }),
}));

vi.mock('./BulkAddModal', () => ({
  BulkAddModal: (props: Record<string, unknown>) => {
    bulkAddModalPropsMock = props;
    return <div data-testid="bulk-add-modal" />;
  },
}));

vi.mock('./PlacementSession', async (importOriginal) => {
  // Module-loading boundary: vitest factory imports the real module while
  // stubbing only the component render.
  const actual = (await importOriginal()) as {
    backgroundRecordsForLanguage: (raw: unknown, language: string) => HistoricalBackgroundRecord[];
  };
  return {
    // Keep the REAL background parser: the tab must unwrap `.records` and
    // the parser must drop foreign/malformed rows — only the render is stubbed.
    backgroundRecordsForLanguage: actual.backgroundRecordsForLanguage,
    default: (props: Record<string, unknown>) => {
      placementPropsMock = props;
      return <div data-testid="placement-session" />;
    },
  };
});

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
  useFlashcards: () => ({
    getWordTrackingSync: () => ({ tracker: 'nothing' as const }),
    store: {
      flashcards: {},
      wordToCardMap: {},
      wordKnowledge: storeWordKnowledgeMock,
      knownUntracked: {},
      ignoredWords: {},
      wordCandidates: {},
    },
    isLoading: () => false,
    isKnowledgeReady: () => true,
    isWordIgnoredSync: isWordIgnoredSyncMock,
    getComprehensiveWordStatusSync: getComprehensiveWordStatusSyncMock,
    hasWordSync: hasWordSyncMock,
    addLevelStudyFlashcards: addLevelStudyFlashcardsMock,
    // Package-update item reconcile (G03): fire-and-forget from the tab effect.
    reconcileGrammarItems: reconcileGrammarItemsMock,
    // Canonical knowledge writer (LevelStudyTab recordMockAttempt /
    // GrammarCoverage onProbe): the mock/mocks integration drives it.
    recordGrammarAttemptAcknowledged: recordGrammarAttemptMock,
  }),
  useSettings: () => ({
    settings: {
      language: settingsLanguageMock,
      easeThresholdKnown: 3.5,
      easeThresholdLearning: 1.5,
      learningLanguageLevels: learningLanguageLevelsMock,
      get uiLanguage() { return settingsUiLanguage; },
      llmProvider: 'builtin',
      builtinModel: 'fixture-local-model',
      ollamaModel: '',
      ...(learningBackgroundRecordsMock === undefined ? {} : { learningBackground: { records: learningBackgroundRecordsMock } }),
    },
    updateSettings: updateSettingsMock,
  }),
  useLanguage: () => ({
    langData: installedLangDataMock,
    supportedLanguages: () => supportedLanguagesMock,
    currentLangData: () => currentLangDataMock,
    getWordFrequency: () => wordFrequencyMock,
    getFreqLevelNames: () => ({ '5': 'STALE CONTEXT LEVEL' }),
    getCanonicalFormForLanguage: (_language: string, word: string) => (word === 'ねこ' ? '猫' : word),
    getWordVariantsForLanguage: (_language: string, word: string) => wordVariantsForWordMock(word),
    isLoading: () => false,
    refreshLanguageData: refreshLanguageDataMock,
  }),
}));

vi.mock('../../components/common', () => ({
  ProgressBar: (props: { value: number }) => <div data-testid="progress">{props.value}</div>,
  SkeletonCard: (props: { lines?: number }) => <div data-testid="skeleton-card" data-lines={props.lines} />,
  SkeletonRows: (props: { rows?: number }) => <div data-testid="skeleton-rows" data-rows={props.rows} />,
  EmptyState: (props: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <span>{props.title}</span>
      <span>{props.description}</span>
    </div>
  ),
  TargetIcon: (props: { size?: number }) => <span data-testid="target-icon">{props.size}</span>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean; class?: string }) => (
    <button type="button" class={props.class} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
  ),
  PillBtn: (props: { label?: string; onClick?: () => void }) => (
    <button type="button" data-testid="level-pill" onClick={props.onClick}>{props.label}</button>
  ),
  Card: (props: { children?: JSX.Element; title?: string; subtitle?: string; footer?: JSX.Element; onClick?: () => void }) => (
    <button type="button" onClick={props.onClick} data-testid="level-card">
      <span>{props.title}</span>
      <span>{props.subtitle}</span>
      {props.children}
      {props.footer}
    </button>
  ),
}));

describe('LevelStudyTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    refreshLanguageDataMock.mockClear();
    addLevelStudyFlashcardsMock.mockReset();
    getComprehensiveWordStatusSyncMock.mockClear();
    hasWordSyncMock.mockClear();
    isWordIgnoredSyncMock.mockReturnValue(false);
    openWindowMock.mockClear();
    bulkAddModalPropsMock = null;
    placementPropsMock = null;
    learningBackgroundRecordsMock = undefined;
    updateSettingsMock.mockClear();
    // Mock/GrammarCoverage durability is localStorage-backed (pending
    // results, stored walk cursors, validation records): clear it so no
    // fixture leaks into the next mount (G01 isolation).
    globalThis.localStorage?.clear();
    // MockExam serializes its durable session mutations with the Web Locks
    // API; happy-dom reports navigator.locks as null, which DISABLES the
    // mock surface (G04). These integration tests drive the REAL child's
    // serialized paths, so inject a pass-through lock (the
    // PlacementSession.test convention) instead of a no-op fallback.
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
      configurable: true,
    });
    recordGrammarAttemptMock.mockReset();
    setProjectionLoading(false);
    settingsUiLanguage = 'en';
    llmReadyMock = true;
    projectionQueryAccessor = undefined;
    storeWordKnowledgeMock = {};
    journalKeysMock = [];
    wordVariantsForWordMock = (word) => [word];
    learningLanguageLevelsMock = undefined;
    getComprehensiveWordStatusSyncMock.mockReturnValue('unknown');
    hasWordSyncMock.mockReturnValue(false);
    currentLangDataMock = {
      name: 'Japanese',
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };
    installedLangDataMock = {};
    supportedLanguagesMock = [];
    wordFrequencyMock = {};
    settingsLanguageMock = 'ja';
  });

  afterEach(() => {
    // happy-dom's Navigator type predates the LockManager global; the stub
    // above installs an own configurable property that shadows it.
    const lockStubHost = globalThis.navigator as { locks?: unknown };
    delete lockStubHost.locks;
    container.remove();
  });

  it('requests a one-time language data refresh when loaded metadata has no frequency rows', async () => {
    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    expect(refreshLanguageDataMock).toHaveBeenCalledOnce();

    dispose();
  });

  it('renders level cards from installed language rows when the derived frequency map is stale', async () => {
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'Package N5' },
      },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(container.textContent).toContain('Package N5');
    expect(container.textContent).not.toContain('STALE CONTEXT LEVEL');
    expect(container.textContent).toContain('2');

    dispose();
  });

  it('renders the beyond-exam card when installed frequency rows have no declared level system', async () => {
    currentLangDataMock = {
      name: 'Unlevelled Language',
      freq: [
        ['alpha', 'alpha'],
        ['beta', 'beta'],
      ],
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    const cards = container.querySelectorAll('[data-testid="level-card"]');
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain('mlearn.LevelStudy.LevelCard.BeyondExam');
    expect(container.textContent).not.toContain('Level -1');
    expect(container.querySelector('.level-study-coverage-bar')).toBeNull();

    dispose();
  });

  it('appends the beyond-exam card after real level cards', async () => {
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
        ['馬', 'うま', -1],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    const cards = container.querySelectorAll('[data-testid="level-card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('N5');
    expect(cards[1].textContent).toContain('mlearn.LevelStudy.LevelCard.BeyondExam');

    dispose();
  });

  it('renders the single installed language package when the selected language setting is missing', async () => {
    settingsLanguageMock = '';
    currentLangDataMock = null;
    supportedLanguagesMock = ['ja'];
    installedLangDataMock = {
      ja: {
        name: 'Japanese',
        freq: [
          ['猫', 'ねこ', 5],
          ['犬', 'いぬ', 5],
        ],
        frequencyLevels: {
          rowLevelIndex: 2,
          names: { '5': 'N5' },
        },
      },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.querySelector('[data-testid="empty-state"]')).toBeNull();
    expect(container.textContent).toContain('N5');
    expect(container.textContent).toContain('2');

    dispose();
  });

  it('opens the bulk add modal with the resolved installed language when the setting is stale', async () => {
    settingsLanguageMock = '';
    currentLangDataMock = null;
    supportedLanguagesMock = ['ja'];
    installedLangDataMock = {
      ja: {
        name: 'Japanese',
        freq: [
          ['猫', 'ねこ', 5],
          ['犬', 'いぬ', 5],
        ],
        frequencyLevels: {
          rowLevelIndex: 2,
          names: { '5': 'N5' },
        },
      },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.querySelector('[data-testid="bulk-add-modal"]')).toBeNull();
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'mlearn.LevelStudy.BulkAdd.Button')
      ?.click();

    expect(container.querySelector('[data-testid="bulk-add-modal"]')).not.toBeNull();
    expect(bulkAddModalPropsMock).not.toBeNull();
    expect(bulkAddModalPropsMock?.language).toBe('ja');
    expect(Object.keys(bulkAddModalPropsMock?.frequency as Record<string, unknown>)).toEqual(['猫', '犬']);

    dispose();
  });

  it('passes language-scoped dated background records into the returning-learner flow', async () => {
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };
    // Wrapper object as stored in settings: the tab must unwrap `.records`
    // and scope to the learning language, dropping foreign/malformed rows.
    learningBackgroundRecordsMock = [
      { id: 'ja-1', language: 'ja', kind: 'exam', label: 'Old N3', level: 'N3', completedAt: '2024-12-01', recordedAt: 1 },
      { id: 'de-1', language: 'de', kind: 'school', label: 'B2 Kurs', recordedAt: 2 },
      { id: 'bad', language: 'ja', kind: 'nope', label: 'x', recordedAt: 3 },
    ];

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.querySelector('[data-testid="placement-session"]')).not.toBeNull();
    expect(placementPropsMock).not.toBeNull();
    expect(placementPropsMock?.language).toBe('ja');
    const background = placementPropsMock?.background as Array<{ id: string }>;
    expect(background.map((record) => record.id)).toEqual(['ja-1']);

    dispose();
  });

  it('never offers an ignored word as a placement candidate (G04 ignore policy)', async () => {
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
        ['虫', 'むし', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };
    // The learner "ignored" いぬ: it stays unmeasured but must never be
    // selected, taught or tested by the placement probe.
    isWordIgnoredSyncMock.mockImplementation((word: string) => word === 'いぬ');

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(placementPropsMock).not.toBeNull();
    const words = (placementPropsMock?.pools as Array<{ words: string[] }>)[0]?.words ?? [];
    expect(words).toContain('猫');
    expect(words).toContain('虫');
    expect(words).not.toContain('いぬ');

    dispose();
  });

  it('offers every declared band even when an easy-band prefix fills the scan (R09 balance)', async () => {
    // 210 frequency-ordered easy-band rows followed by harder bands: the old
    // global scan cap stopped collecting before the harder bands were ever
    // discovered, so an underconfident learner could never be probed above
    // the easiest band.
    const easy = Array.from({ length: 210 }, (_, i) => [`易${i}`, `やさ${i}`, 5]);
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ...easy,
        ['難1', 'むずか1', 2],
        ['難2', 'むずか2', 2],
        ['難3', 'むずか3', 3],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '2': 'N2', '3': 'N3', '5': 'N5' },
      },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(placementPropsMock).not.toBeNull();
    const pools = placementPropsMock?.pools as Array<{ level: number; label: string; words: string[] }>;
    const byLevel = new Map(pools.map((pool) => [pool.level, pool]));
    // Every declared band is offered, not just the easiest one.
    expect(byLevel.get(5)?.words.length).toBe(6); // capped per band
    expect(byLevel.get(2)?.words).toEqual(['難1', '難2']);
    expect(byLevel.get(3)?.words).toEqual(['難3']);
    expect(pools.map((pool) => pool.level).sort((a, b) => a - b)).toEqual([2, 3, 5]);

    dispose();
  });

  it('bounds projection requests to evidence-bearing surfaces only (F-N1)', async () => {
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };
    // Only 猫 has stored state: the 49k-row untracked tail of a real package
    // must never reach the projection materialization path (F-N1 lead).
    storeWordKnowledgeMock = {
      [wordStorageKey('ja', '猫')]: { ease: 2.2, timesSeen: 1 },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    // The journal-key snapshot settles asynchronously before the bounded
    // projection request is issued; poll rather than assuming tick counts.
    for (let i = 0; i < 100 && projectionQueryAccessor?.()?.surfaces === undefined; i += 1) await tick();

    expect(projectionQueryAccessor?.()).not.toBeNull();
    expect(projectionQueryAccessor?.()?.surfaces).toEqual(['猫']);

    dispose();
  });

  it('includes JOURNAL-ONLY evidence in the bounded surfaces (F-N1 source-of-truth path)', async () => {
    // Store cache empty, but the journal holds a key for one surface: the
    // journal snapshot is the evidence authority, so that surface is still
    // requested — while the unmeasured tail stays out of the fan-out.
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };
    journalKeysMock = [wordStorageKey('ja', '犬')];

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    for (let i = 0; i < 100 && projectionQueryAccessor?.()?.surfaces === undefined; i += 1) await tick();

    expect(projectionQueryAccessor?.()).not.toBeNull();
    expect(projectionQueryAccessor?.()?.surfaces).toEqual(['犬']);

    dispose();
  });
  it('matches surfaces whose evidence is stored under a VARIANT form key (F-N1 candidate keys)', async () => {
    // The writer derives storage keys from getWordFormCandidates(...)[0];
    // when a package declares variants, evidence may live under a variant
    // form's key rather than the raw surface. The reader must test every
    // candidate form or the surface looks untracked (W04 follow-up landed).
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };
    wordVariantsForWordMock = (word) => (word === '猫' ? ['ねこ'] : [word]);
    journalKeysMock = [wordStorageKey('ja', 'ねこ')];

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    for (let i = 0; i < 100 && projectionQueryAccessor?.()?.surfaces === undefined; i += 1) await tick();

    expect(projectionQueryAccessor?.()).not.toBeNull();
    expect(projectionQueryAccessor?.()?.surfaces).toEqual(['猫']);

    dispose();
  });

  it('keeps the returning-learner flow mounted while projections reload (integration blocker regression)', async () => {
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };
    // A placement rating bumps eventsVersion and flips the projections to
    // loading; the placement flow must NOT sit inside that loading gate.
    setProjectionLoading(true);

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.querySelector('[data-testid="placement-session"]')).not.toBeNull();
    expect(placementPropsMock).not.toBeNull();
    expect(placementPropsMock?.booting).toBe(true);

    dispose();
  });

  it('shows the coverage bar scoped to the user learning level as a pill linking to Learning Plan', async () => {
    learningLanguageLevelsMock = { ja: 5 };
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.textContent).toContain('mlearn.LevelStudy.Coverage.UpTo');
    const pill = container.querySelector('[data-testid="level-pill"]');
    expect(pill?.textContent).toBe('N5');
    expect(container.querySelector('.level-study-coverage-progress')).not.toBeNull();

    (pill as HTMLElement).click();
    expect(openWindowMock).toHaveBeenCalledWith({ type: 'level-study' });

    dispose();
  });

  it('shows an all-levels coverage bar with a set-level hint when no learning level is set', async () => {
    currentLangDataMock = {
      name: 'Japanese',
      freq: [
        ['猫', 'ねこ', 5],
        ['犬', 'いぬ', 5],
      ],
      frequencyLevels: {
        rowLevelIndex: 2,
        names: { '5': 'N5' },
      },
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    expect(container.textContent).toContain('mlearn.LevelStudy.Coverage.AllLevels');
    const hint = container.querySelector('.level-study-set-level-link');
    expect(hint?.textContent).toBe('mlearn.LevelStudy.Coverage.SetLevelHint');

    (hint as HTMLElement).click();
    expect(openWindowMock).toHaveBeenCalledWith({ type: 'level-study' });

    dispose();
  });

  // ─── Checkpoints & mocks lifecycle (R13/R14) — the review majors ──────
  // The component-alone suites prove MockExam's pending-results storage and
  // GrammarCoverage's owner-held repair handling. These two cases mount the
  // REAL children inside the REAL tab and drive the evidence-driven
  // unmount/remount cycle through the tab's boot gate — the LevelStudyTab
  // lifecycle the review flagged as untested.

  it('restores detailed mock results and their actions across the projection-refresh unmount (integration regression)', async () => {
    currentLangDataMock = deFixture() as unknown as Record<string, unknown>;
    settingsLanguageMock = 'de';
    recordGrammarAttemptMock.mockImplementation(mockWriterFlippingProjections);

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();
    await waitFor(() => container.querySelector('[data-testid="mock-blueprints"]') !== null);

    await runMockThroughResults(container, goldIndexFor(currentLangDataMock as unknown as LanguageData), 3);

    // Every answer went through the canonical writer with mock provenance
    // and the versioned item reference (G03) — not a side channel.
    const mockWrites = recordGrammarAttemptMock.mock.calls.filter(([, , options]) => isMockTaskType(options));
    expect(mockWrites.length).toBeGreaterThan(0);
    for (const [, , options] of mockWrites) {
      expect(options).toEqual(expect.objectContaining({
        language: 'de',
        level: 3,
        itemRef: expect.objectContaining({ id: expect.any(String) }),
        validationRef: expect.anything(),
      }));
    }

    // The terminal append's projection reload unmounts the subtree…
    setProjectionLoading(true);
    await tick();
    expect(container.querySelector('[data-testid="mock-results"]')).toBeNull();
    expect(container.querySelector('.level-study-boot')).not.toBeNull();

    // …and the remount restores the DETAILED results (per-section rows and
    // provenance), not the compact saved summary.
    setProjectionLoading(false);
    await waitFor(() => container.querySelector('[data-testid="mock-results"]') !== null);
    expect(container.querySelector('[data-testid="mock-results-sections"]')).not.toBeNull();

    // Targeted output opens the SAME conversation-agent experience (R14).
    const outputBtn = container.querySelector('[data-testid="mock-output-btn"]') as HTMLButtonElement | null;
    expect(outputBtn).toBeTruthy();
    outputBtn!.click();
    const agentCall = openWindowMock.mock.calls.find(([arg]) => (arg as { type?: string } | undefined)?.type === 'conversation-agent');
    expect(agentCall).toBeTruthy();
    const agentContext = (agentCall![0] as { context?: { tutorConfig?: { selectedGrammar?: unknown[] } } }).context;
    expect((agentContext?.tutorConfig?.selectedGrammar ?? []).length).toBeGreaterThan(0);

    // The same action routes an unconfigured learner to the AI setup, not
    // the unrelated Behaviour settings tab.
    openWindowMock.mockClear();
    llmReadyMock = false;
    outputBtn!.click();
    expect(openWindowMock).toHaveBeenCalledWith({
      type: 'settings',
      context: { section: 'ai' },
    });

    // Repair re-enters the SAME policy walk for the missed level (R13).
    const repairBtn = container.querySelector('[data-testid="mock-repair-btn"]') as HTMLButtonElement | null;
    expect(repairBtn).toBeTruthy();
    repairBtn!.click();
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt') !== null);

    // Closing results clears the pending view for good: the next reload
    // returns to blueprints, never back to stale results.
    (container.querySelector('[data-testid="mock-close-results"]') as HTMLButtonElement).click();
    setProjectionLoading(true);
    await tick();
    setProjectionLoading(false);
    await tick();
    expect(container.querySelector('[data-testid="mock-results"]')).toBeNull();
    expect(container.querySelector('[data-testid="mock-blueprints"]')).not.toBeNull();

    dispose();
  });

  it('starts an owner-held mock repair after the projection-refresh remount ends the live walk (integration regression)', async () => {
    currentLangDataMock = deFixture() as unknown as Record<string, unknown>;
    settingsLanguageMock = 'de';
    recordGrammarAttemptMock.mockImplementation(mockWriterFlippingProjections);

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();
    await waitFor(() => container.querySelector('[data-testid="mock-blueprints"]') !== null);

    // A live self-assessment walk on level 3 (durable cursor) while the
    // mock runs on the same level's blueprint. One probe persists the
    // cursor so the remount below genuinely RESUMES the walk (start-only
    // sessions are not stored).
    const levelRow = container.querySelector('.grammar-coverage__level-row[data-level="3"]') as HTMLElement | null;
    expect(levelRow).toBeTruthy();
    levelRow!.click();
    await tick();
    const practiseBtn = levelBlock(container, 3).querySelector('.grammar-coverage__session-btn') as HTMLButtonElement | null;
    expect(practiseBtn).toBeTruthy();
    expect(practiseBtn!.disabled).toBe(false);
    practiseBtn!.click();
    await tick();
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt') !== null);
    const walkProbe = () => levelBlock(container, 3).querySelector('.grammar-coverage__session-probe .grammar-coverage__probe-btn:nth-child(3)') as HTMLButtonElement;
    walkProbe().click();
    await beat();
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt[data-pattern]') !== null);

    await runMockThroughResults(container, goldIndexFor(currentLangDataMock as unknown as LanguageData), 3);
    await waitFor(() => container.querySelector('[data-testid="mock-repair-btn"]') !== null);

    // Repair requested while the walk is live: queued at the owner, never
    // started, never hidden.
    (container.querySelector('[data-testid="mock-repair-btn"]') as HTMLButtonElement).click();
    await tick();
    expect(levelBlock(container, 3).querySelector('.grammar-contrast')).toBeNull();

    // A probe append's projection reload unmounts the subtree — the walk's
    // durable cursor resumes and the owner still holds the unhandled
    // request (the disposed component-local queue would have lost it).
    setProjectionLoading(true);
    await tick();
    expect(container.querySelector('.level-study-boot')).not.toBeNull();
    setProjectionLoading(false);
    await tick();
    // expandedLevel is component-local: the remounted coverage collapses its
    // rows, so re-expand level 3 before asserting the resumed walk.
    (container.querySelector('.grammar-coverage__level-row[data-level="3"]') as HTMLElement).click();
    await tick();
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt') !== null);
    expect(levelBlock(container, 3).querySelector('.grammar-contrast')).toBeNull();

    // Completing the resumed walk starts the queued repair as the
    // item-backed contrast pass for the missed level — the request
    // survived the unmount because the OWNER held it.
    walkProbe().click();
    await beat();
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt') !== null);
    walkProbe().click();
    await beat();
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-contrast') !== null);
    expect(levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt[data-pattern]')).toBeNull();

    dispose();
  });
});

// ─── Fixtures + drivers for the mock lifecycle integration tests ─────────

let fixtureItemCounter = 0;

/** German-like package mirror of the MockExam suite fixture: level-3
 *  patterns carry executed independent validation records (deliverable
 *  items), level 2 declares one construction whose walk is the
 *  self-assessment pass. */
const deFixture = (): LanguageData => ({
  name: 'German',
  freq: [['Haus', 'Haus', 5]],
  frequencyLevels: { rowLevelIndex: 2, names: { '5': 'A1' } },
  grammar: [
    { pattern: 'weil', meaning: 'because', level: 3, category: 'reasons', items: [reviewedFixtureItem('weil'), reviewedFixtureItem('weil')] },
    { pattern: 'deshalb', meaning: 'therefore', level: 3, category: 'reasons', items: [reviewedFixtureItem('deshalb'), reviewedFixtureItem('deshalb')] },
    { pattern: 'obwohl', meaning: 'although', level: 3, category: 'concession', items: [reviewedFixtureItem('obwohl'), reviewedFixtureItem('obwohl')] },
    { pattern: 'trotzdem', meaning: 'nevertheless', level: 2, items: [reviewedFixtureItem('trotzdem')] },
  ],
  grammarLevels: { names: { '2': 'A2', '3': 'B1' } },
  languageData: { version: '2026.09.19-test' },
} as unknown as LanguageData);

type FixturePattern = 'weil' | 'deshalb' | 'obwohl' | 'trotzdem';
type FixtureDistractor = { span: string; violates: string[]; rationale: string };

const FIXTURE_CONTEXTS: Record<FixturePattern, string> = {
  weil: 'Ich bleibe heute im Bett, weil ich Fieber habe.',
  deshalb: 'Ich habe Fieber, deshalb bleibe ich heute im Bett.',
  obwohl: 'Wir gehen spazieren, obwohl es regnet.',
  trotzdem: 'Es regnet, trotzdem gehen wir spazieren.',
};

const FIXTURE_CONDITIONS: Record<FixturePattern, string[]> = {
  weil: ['causal-reading', 'subordinate-clause-final-verb'],
  deshalb: ['causal-reading', 'verb-second-main-clause'],
  obwohl: ['concessive-reading', 'subordinate-clause-final-verb'],
  trotzdem: ['causal-reading', 'verb-second-main-clause'],
};

const FIXTURE_DISTRACTORS: Record<FixturePattern, readonly FixtureDistractor[]> = {
  weil: [
    { span: 'obwohl', violates: ['causal-reading'], rationale: 'concessive reading contradicts staying in bed' },
    { span: 'deshalb', violates: ['causal-reading', 'subordinate-clause-final-verb'], rationale: 'causal adverb, verb-second' },
  ],
  deshalb: [
    { span: 'weil', violates: ['verb-second-main-clause'], rationale: 'subordinate conjunction, verb-final' },
    { span: 'trotzdem', violates: ['causal-reading', 'verb-second-main-clause'], rationale: 'concessive reading contradicts the fever' },
  ],
  obwohl: [
    { span: 'weil', violates: ['concessive-reading'], rationale: 'causal reading contradicts the walk' },
    { span: 'deshalb', violates: ['causal-reading', 'subordinate-clause-final-verb'], rationale: 'causal adverb, verb-second' },
  ],
  trotzdem: [
    { span: 'deshalb', violates: ['causal-reading', 'verb-second-main-clause'], rationale: 'causal adverb, verb-second' },
    { span: 'obwohl', violates: ['concessive-reading', 'subordinate-clause-final-verb'], rationale: 'subordinate conjunction, verb-final' },
  ],
};

const reviewedFixtureItem = (pattern: FixturePattern): GrammarPracticeItemSource => {
  const base: GrammarPracticeItemSource = {
    id: `de-${pattern}-${fixtureItemCounter += 1}`,
    context: FIXTURE_CONTEXTS[pattern],
    answerSpan: pattern,
    conditions: FIXTURE_CONDITIONS[pattern],
    distractors: FIXTURE_DISTRACTORS[pattern].map((distractor) => ({ ...distractor, violates: [...distractor.violates] })),
  };
  const semantic: GrammarItemSemanticValidation = {
    status: 'passed',
    validator: 'fixture-independent-validator@1',
    at: '2026-09-19T00:00:00Z',
    contentHash: itemContentVersion(base),
    reasons: ['fixture record'],
  };
  return { ...base, validation: { semantic } };
};

const isMockTaskType = (options: unknown): boolean => {
  const taskType = (options as { taskType?: string } | undefined)?.taskType;
  return typeof taskType === 'string' && taskType.startsWith('mock-');
};

/** The canonical append of a MOCK answer flips the projections to loading
 *  (production: appendEvents → eventsVersion → projection resource), which
 *  unmounts the GrammarCoverage/MockExam subtree through the tab's boot
 *  gate. Walk probes carry no `mock-*` provenance and do not flip. */
const mockWriterFlippingProjections = async (_pattern: string, _quality: string, options?: Record<string, unknown>): Promise<string> => {
  if (isMockTaskType(options)) setProjectionLoading(true);
  return `fixture-attempt-${fixtureAttemptCounter += 1}`;
};

/** item.id → gold option index, computed from the SAME deterministic
 *  assembly the surfaces use (option order is seeded per item version). */
const goldIndexFor = (languageData: LanguageData): Map<string, number> => {
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

/** The presentation beat (150 ms submission lock) before the next prompt
 *  accepts input; gesture truth (click detail / key repeat) is the
 *  load-bearing duplicate-submission guard. */
const beat = () => new Promise<void>((resolve) => setTimeout(resolve, 170));

const waitFor = async (predicate: () => boolean, limit = 300) => {
  for (let i = 0; i < limit; i += 1) {
    if (predicate()) return;
    await tick();
  }
  expect(predicate(), 'waitFor condition never became true').toBe(true);
};

const levelBlock = (container: HTMLElement, level: number): HTMLElement => {
  const block = container.querySelector(`[data-level="${level}"]`) as HTMLElement | null;
  expect(block, `grammar level block ${level} missing`).toBeTruthy();
  return block as HTMLElement;
};

/** Drives the tab's REAL MockExam child through a fixed blueprint run,
 *  deliberately missing every answer (missed patterns drive the repair
 *  request). Each answer's canonical append flips the projections to
 *  loading; the test lets the reload settle, exactly the production
 *  append → reload → remount chain, with the queue resuming from storage. */
const runMockThroughResults = async (container: HTMLElement, gold: Map<string, number>, level: number) => {
  const start = container.querySelector(`[data-testid="mock-start-${level}"]`) as HTMLButtonElement | null;
  expect(start, `mock blueprint start button ${level} missing`).toBeTruthy();
  start!.click();
  let guard = 0;
  while (container.querySelector('[data-testid="mock-results"]') === null) {
    guard += 1;
    expect(guard).toBeLessThan(48);
    await waitFor(() => container.querySelector('[data-testid="mock-session"]') !== null);
    const context = container.querySelector('.mock-exam__context') as HTMLElement;
    const itemId = context.getAttribute('data-item-id')!;
    const goldIndex = gold.get(itemId)!;
    const options = Array.from(container.querySelectorAll('[data-testid="mock-session"] .mock-exam__option')) as HTMLButtonElement[];
    expect(options.length).toBeGreaterThanOrEqual(2);
    options[(goldIndex + 1) % options.length].click();
    await beat();
    // The append's eventsVersion bump reloads the projections; the journal
    // snapshot settles and the tab remounts the subtree.
    setProjectionLoading(false);
    await tick();
  }
};

let projectionQueryAccessor: (() => { language: string; surfaces: string[] } | undefined) | undefined = undefined;
let storeWordKnowledgeMock: Record<string, unknown> = {};
let journalKeysMock: string[] = [];
let wordVariantsForWordMock: (word: string) => string[] = (word) => [word];

vi.mock('../../services/llmProvider', () => ({
  // Targeted-output gate (R14): ready in the fixture so the Discuss action
  // opens the conversation agent instead of routing to Settings.
  isLLMReady: () => llmReadyMock,
  streamChat: () => ({ abort: () => {} }),
}));

vi.mock('../../hooks/useKnowledgeProjections', async () => {
  const { useFlashcards } = await import('../../context');
  const { projectionFixture } = await import('../../../../test/projectionFixture');
  return {
    useKnowledgeProjections: (query: () => { language: string; surfaces: string[] } | undefined) => {
      // Capture the accessor: the underlying journal-key resource settles
    // asynchronously, so tests poll the accessor instead of one snapshot.
    projectionQueryAccessor = query;
      return {
        loading: () => projectionLoading(),
        ready: () => !projectionLoading(),
        failed: () => false,
        retry: vi.fn(),
        projections: () => new Map((query()?.surfaces ?? []).map(word => {
          const ctx = useFlashcards();
          const state = ctx.getComprehensiveWordStatusWithSourceSync?.(word, query()!.language);
          return [word, projectionFixture(state?.status ?? ctx.getComprehensiveWordStatusSync?.(word) ?? 'unknown', state?.basis ?? 'unmeasured')];
        })),
      };
    },
  };
});
