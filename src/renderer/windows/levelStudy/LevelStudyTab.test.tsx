// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { assembleContrastItem, itemContentVersion, questionBankFromLanguageData } from '../../learning/questionBank';
import type { GrammarItemSemanticValidation, GrammarPracticeItemSource, LanguageData } from '../../../shared/types';

const refreshLanguageDataMock = vi.fn();
const addLevelStudyFlashcardsMock = vi.fn();
const reconcileGrammarItemsMock = vi.fn(async () => 0);
const getComprehensiveWordStatusSyncMock = vi.fn(() => 'unknown');
const hasWordSyncMock = vi.fn(() => false);
const openWindowMock = vi.fn();
let currentLangDataMock: Record<string, unknown> | null = null;
let installedLangDataMock: Record<string, Record<string, unknown>> = {};
let supportedLanguagesMock: string[] = [];
let wordFrequencyMock: Record<string, unknown> = {};
let settingsLanguageMock = 'ja';
let learningLanguageLevelsMock: Record<string, number> | undefined;
let bulkAddModalPropsMock: Record<string, unknown> | null = null;
const updateSettingsMock = vi.fn();
let learningBackgroundMock: { records: Array<Record<string, unknown>> } = { records: [] };
const updateSettingMock = vi.fn((key: string, value: unknown) => {
  if (key === 'learningBackground') learningBackgroundMock = value as { records: Array<Record<string, unknown>> };
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Canonical grammar/mock writer through the tab's recordGrammarAttempt /
// GrammarCoverage onProbe / MockExam onAttempt paths. Mock attempts carry
// `mock-*` task provenance; the mock writer flips the projections to loading
// for exactly those appends — the production append → eventsVersion →
// projection-reload chain. The loaded GrammarCoverage/MockExam subtree must
// remain mounted through that refresh. Grammar/contrast probes do not flip
// (their appends are exercised by the dedicated suites).
let fixtureAttemptCounter = 0;
const recordGrammarAttemptMock = vi.fn<(pattern: string, quality: string, options?: Record<string, unknown>) => Promise<string>>(
  async () => `fixture-attempt-${fixtureAttemptCounter += 1}`,
);

// Reactive loading state for the useKnowledgeProjections stub (bottom of
// this file): flipping it live reproduces the evidence-driven refresh.
const [projectionLoading, setProjectionLoading] = createSignal(false);

let settingsUiLanguage = 'en';
let llmReadyMock = true;

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: { openWindow: openWindowMock },
    // Grammar-coverage journal queries + the F-N1 journal-key snapshot: the
    // level-study tab mounts the same resource, so the stub must
    // answer language-key queries and the change-listener contract.
    knowledgeEvents: {
      queryLanguageKeys: () => Promise.resolve(journalKeysMock),
      queryKnowledgeEvents: () => Promise.resolve({}),
      queryKnowledgeItemEvents: () => Promise.resolve({}),
      getGrammarProjections: () => Promise.resolve({}),
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
    getComprehensiveWordStatusSync: getComprehensiveWordStatusSyncMock,
    hasWordSync: hasWordSyncMock,
    addLevelStudyFlashcards: addLevelStudyFlashcardsMock,
    // Package-update item reconcile (G03): fire-and-forget from the tab effect.
    reconcileGrammarItems: reconcileGrammarItemsMock,
    // Canonical knowledge writer (LevelStudyTab recordMockAttempt /
    // GrammarCoverage onProbe): the mock/mocks integration drives it.
    recordGrammarAttemptAcknowledged: recordGrammarAttemptMock,
    // Grammar-coverage Undo lifecycle: the tab hands these to the drill as
    // one object, so the stub answers all four members even though this
    // suite never drives a retraction.
    recordPendingRetraction: async () => true,
    completePendingRetraction: async () => 'completed' as const,
    recoverPendingRetraction: async () => {},
    registerRetractionProjection: () => {},
  }),
  useSettings: () => ({
    settings: {
      language: settingsLanguageMock,
      easeThresholdKnown: 3.5,
      easeThresholdLearning: 1.5,
      learningLanguageLevels: learningLanguageLevelsMock,
      get learningBackground() { return learningBackgroundMock; },
      get uiLanguage() { return settingsUiLanguage; },
      llmProvider: 'builtin',
      ratingKeyboardMode: 'mnemonic',
      builtinModel: 'fixture-local-model',
      ollamaModel: '',
    },
    updateSetting: updateSettingMock,
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

vi.mock('../../components/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/common')>()),
  RatingMatrix: (props: { armed: boolean; capabilities: readonly string[]; onSubmit: (observations: readonly { capability: string; quality: 'missed' | 'struggled' | 'fluent' }[], options?: { easy?: boolean }) => void }) => (
    <div class="rating-matrix">
      {(['missed', 'struggled', 'fluent', 'easy'] as const).map((action) => (
        <button type="button" class="rating-matrix__quality" disabled={!props.armed} onClick={() => props.onSubmit(
          props.capabilities.map((capability) => ({ capability, quality: action === 'easy' ? 'fluent' : action })),
          action === 'easy' ? { easy: true } : undefined,
        )}>{action}</button>
      ))}
    </div>
  ),
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
  Button: (props: { children?: JSX.Element; label?: string; buttonType?: string; onClick?: () => void; disabled?: boolean; class?: string }) => (
    <button type="button" class={props.class} data-testid={props.buttonType === 'pill' ? 'level-pill' : undefined} disabled={props.disabled} onClick={props.onClick}>{props.label ?? props.children}</button>
  ),
  Panel: (props: { children?: JSX.Element; class?: string }) => <div class={props.class}>{props.children}</div>,
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
    openWindowMock.mockClear();
    bulkAddModalPropsMock = null;
    updateSettingsMock.mockClear();
    updateSettingMock.mockClear();
    learningBackgroundMock = { records: [] };
    // Mock/GrammarCoverage durability is localStorage-backed (pending
    // results, stored walk cursors, validation records): clear it so no
    // fixture leaks into the next mount (G01 isolation).
    globalThis.localStorage?.clear();
    // MockExam serializes its durable session mutations with the Web Locks
    // API; happy-dom reports navigator.locks as null, which DISABLES the
    // mock surface (G04). These integration tests drive the REAL child's
    // serialized paths, so inject a pass-through lock (the
    // study-session test convention) instead of a no-op fallback.
    Object.defineProperty(globalThis.navigator, 'locks', {
      value: { request: (_name: string, callback: () => void) => { callback(); return Promise.resolve(); } },
      configurable: true,
    });
    recordGrammarAttemptMock.mockReset();
    setProjectionLoading(false);
    settingsUiLanguage = 'en';
    llmReadyMock = true;
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
  }, 10000);

  it('keeps historical background results editable in Level Study and preserves stored metadata', async () => {
    learningBackgroundMock = {
      records: [{ id: 'old-result', language: 'de', kind: 'exam', label: 'B2 certificate', recordedAt: 12, providerMetadata: { source: 'learner' } }],
    };
    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    const panel = container.querySelector('.learning-background-panel')!;
    (panel.querySelector('summary') as HTMLElement).click();
    const addButton = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent?.includes('mlearn.LevelStudy.Placement.AddRecord'))!;
    addButton.click();
    const fill = (key: string, value: string) => {
      const input = panel.querySelector<HTMLInputElement>(`[aria-label="${key}"]`)!;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill('mlearn.LevelStudy.Placement.ResultLabel', 'Goethe-Zertifikat B2');
    fill('mlearn.LevelStudy.Placement.LevelLabel', 'B2');
    fill('mlearn.LevelStudy.Placement.DateLabel', '2025-05-03');
    fill('mlearn.LevelStudy.Placement.SkillsLabel', 'reading, listening');
    fill('mlearn.LevelStudy.Placement.ScoreOverallLabel', '80/100');
    const saveButton = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent?.includes('mlearn.LevelStudy.Placement.SaveRecord'))!;
    saveButton.click();

    expect(updateSettingMock).toHaveBeenCalledOnce();
    const [settingKey, updatedValue] = updateSettingMock.mock.calls[0]!;
    const updated = updatedValue as { records: Array<Record<string, unknown>> };
    expect(settingKey).toBe('learningBackground');
    expect(updated.records[0]).toMatchObject({ providerMetadata: { source: 'learner' } });
    expect(updated.records[1]).toMatchObject({
      language: 'ja',
      kind: 'exam',
      label: 'Goethe-Zertifikat B2',
      level: 'B2',
      completedAt: '2025-05-03',
      skillScope: ['reading', 'listening'],
      score: { overall: '80/100' },
    });
    dispose();
  });

  it('removes only the selected historical result and retains the other saved records', async () => {
    learningBackgroundMock = {
      records: [
        { id: 'remove-me', language: 'ja', kind: 'exam', label: 'Old result', recordedAt: 12 },
        { id: 'keep-me', language: 'ja', kind: 'school', label: 'School', recordedAt: 13, customScale: 'x' },
        { id: 'other-language', language: 'de', kind: 'exam', label: 'Deutsch', recordedAt: 14 },
      ],
    };
    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);
    await tick();

    const panel = container.querySelector('.learning-background-panel')!;
    (panel.querySelector('summary') as HTMLElement).click();
    const removeButton = Array.from(panel.querySelectorAll('button')).find((button) => button.textContent?.includes('mlearn.LevelStudy.Placement.RemoveRecord'))!;
    removeButton.click();

    const [settingKey, updatedValue] = updateSettingMock.mock.calls[0]!;
    const updated = updatedValue as { records: Array<Record<string, unknown>> };
    expect(settingKey).toBe('learningBackground');
    expect(updated.records).toEqual([
      { id: 'keep-me', language: 'ja', kind: 'school', label: 'School', recordedAt: 13, customScale: 'x' },
      { id: 'other-language', language: 'de', kind: 'exam', label: 'Deutsch', recordedAt: 14 },
    ]);
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
    expect(openWindowMock).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'plan' } });

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
    expect(openWindowMock).toHaveBeenCalledWith({ type: 'level-study', context: { activity: 'plan' } });

    dispose();
  });

  // ─── Checkpoints & mocks lifecycle (R13/R14) — the review majors ──────
  // The component-alone suites prove MockExam's pending-results storage and
  // GrammarCoverage's owner-held repair handling. These two cases mount the
  // REAL children inside the REAL tab and drive the evidence-driven
  // refresh through the tab's projection gate — the LevelStudyTab lifecycle
  // that must keep loaded assessment content usable.

  it('keeps detailed mock results and their actions mounted across projection refresh', async () => {
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

    // The terminal append's projection reload preserves the completed view.
    setProjectionLoading(true);
    await tick();
    expect(container.querySelector('[data-testid="mock-results"]')).not.toBeNull();
    expect(container.querySelector('.level-study-boot')).toBeNull();

    // The detailed results and provenance remain after the refresh settles.
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

  it('starts an owner-held mock repair after projection refresh ends the live walk', async () => {
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
    const walkProbe = () => levelBlock(container, 3).querySelector('.study-encounter__response .rating-matrix__quality:nth-child(3)') as HTMLButtonElement;
    (levelBlock(container, 3).querySelector('.study-encounter__reveal') as HTMLButtonElement).click();
    walkProbe().click();
    await beat();
    const admittedWrite = recordGrammarAttemptMock.mock.calls.find(([, , options]) =>
      (options as { taskType?: string } | undefined)?.taskType === 'grammar-self-assess');
    expect(admittedWrite).toBeDefined();
    const [pattern, , options] = admittedWrite!;
    expect(options).toMatchObject({ language: 'de', taskType: 'grammar-self-assess', method: 'recall',
      decision: { id: expect.any(String), selected: {
        targets: [{ kind: 'grammar-pattern', id: `de:grammar:${pattern}`, capability: 'grammar-recognition' }],
        task: { taskTemplateId: 'grammar-self-assess', responseModality: 'recall' },
      } } });
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt[data-pattern]') !== null);

    await runMockThroughResults(container, goldIndexFor(currentLangDataMock as unknown as LanguageData), 3);
    await waitFor(() => container.querySelector('[data-testid="mock-repair-btn"]') !== null);

    // Repair requested while the walk is live: queued at the owner, never
    // started, never hidden.
    (container.querySelector('[data-testid="mock-repair-btn"]') as HTMLButtonElement).click();
    await tick();
    expect(levelBlock(container, 3).querySelector('.grammar-contrast')).toBeNull();

    // A probe append's projection reload leaves the walk and queued repair
    // mounted, retaining their durable cursor and current prompt.
    setProjectionLoading(true);
    await tick();
    expect(container.querySelector('.level-study-boot')).toBeNull();
    expect(levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt')).not.toBeNull();
    setProjectionLoading(false);
    await tick();
    // The coverage retains the active level and durable cursor.
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt') !== null);
    expect(levelBlock(container, 3).querySelector('.grammar-contrast')).toBeNull();

    // Completing the resumed walk starts the queued repair as the
    // item-backed contrast pass for the missed level — the request
    // survived the refresh because the owner held it.
    (levelBlock(container, 3).querySelector('.study-encounter__reveal') as HTMLButtonElement).click();
    walkProbe().click();
    await beat();
    await waitFor(() => levelBlock(container, 3).querySelector('.grammar-coverage__session-prompt') !== null);
    (levelBlock(container, 3).querySelector('.study-encounter__reveal') as HTMLButtonElement).click();
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
 *  (production: appendEvents → eventsVersion → projection resource). Loaded
 *  GrammarCoverage/MockExam content stays mounted. Walk probes carry no
 *  `mock-*` provenance and do not flip. */
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
 *  loading; the test lets the refresh settle while the queue stays mounted. */
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
    // snapshot settles without replacing the assessment subtree.
    setProjectionLoading(false);
    await tick();
  }
};

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
    useKnowledgeProjections: (query: () => { language: string; surfaces: string[]; evidenceKeys?: string[] } | undefined) => {
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
