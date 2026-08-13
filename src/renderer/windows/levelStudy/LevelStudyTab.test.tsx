// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const refreshLanguageDataMock = vi.fn();
const addLevelStudyFlashcardsMock = vi.fn();
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

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    window: { openWindow: openWindowMock },
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
      wordKnowledge: {},
      knownUntracked: {},
      ignoredWords: {},
      wordCandidates: {},
    },
    isLoading: () => false,
    getComprehensiveWordStatusSync: getComprehensiveWordStatusSyncMock,
    hasWordSync: hasWordSyncMock,
    addLevelStudyFlashcards: addLevelStudyFlashcardsMock,
  }),
  useSettings: () => ({
    settings: {
      language: settingsLanguageMock,
      known_ease_threshold: 3500,
      srsLearningThreshold: 1500,
      learningLanguageLevels: learningLanguageLevelsMock,
    },
  }),
  useLanguage: () => ({
    langData: installedLangDataMock,
    supportedLanguages: () => supportedLanguagesMock,
    currentLangData: () => currentLangDataMock,
    getWordFrequency: () => wordFrequencyMock,
    getFreqLevelNames: () => ({ '5': 'STALE CONTEXT LEVEL' }),
    isLoading: () => false,
    refreshLanguageData: refreshLanguageDataMock,
  }),
}));

vi.mock('../../components/common', () => ({
  ProgressBar: (props: { value: number }) => <div data-testid="progress">{props.value}</div>,
  EmptyState: (props: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <span>{props.title}</span>
      <span>{props.description}</span>
    </div>
  ),
  TargetIcon: (props: { size?: number }) => <span data-testid="target-icon">{props.size}</span>,
  Btn: (props: { children?: JSX.Element; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={props.disabled} onClick={props.onClick}>{props.children}</button>
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
    openWindowMock.mockClear();
    bulkAddModalPropsMock = null;
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
    container.remove();
  });

  it('requests a one-time language data refresh when loaded metadata has no frequency rows', async () => {
    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);

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

  it('shows the coverage bar scoped to the user learning level as a pill linking to settings', async () => {
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

    expect(container.textContent).toContain('mlearn.LevelStudy.Coverage.UpTo');
    const pill = container.querySelector('[data-testid="level-pill"]');
    expect(pill?.textContent).toBe('N5');
    expect(container.querySelector('.level-study-coverage-progress')).not.toBeNull();

    (pill as HTMLElement).click();
    expect(openWindowMock).toHaveBeenCalledWith({ type: 'settings', context: { section: 'behaviour' } });

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

    expect(container.textContent).toContain('mlearn.LevelStudy.Coverage.AllLevels');
    const hint = container.querySelector('.level-study-set-level-link');
    expect(hint?.textContent).toBe('mlearn.LevelStudy.Coverage.SetLevelHint');

    (hint as HTMLElement).click();
    expect(openWindowMock).toHaveBeenCalledWith({ type: 'settings', context: { section: 'behaviour' } });

    dispose();
  });
});
