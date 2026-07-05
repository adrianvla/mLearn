// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const refreshLanguageDataMock = vi.fn();
const addLevelStudyFlashcardsMock = vi.fn();
const getComprehensiveWordStatusSyncMock = vi.fn(() => 'unknown');
const hasWordSyncMock = vi.fn(() => false);
let currentLangDataMock: Record<string, unknown> | null = null;
let installedLangDataMock: Record<string, Record<string, unknown>> = {};
let supportedLanguagesMock: string[] = [];
let wordFrequencyMock: Record<string, unknown> = {};
let settingsLanguageMock = 'ja';

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string) => key,
  }),
  useFlashcards: () => ({
    store: {
      flashcards: {},
      wordToCardMap: {},
      wordKnowledge: {},
      knownUntracked: {},
      ignoredWords: {},
      wordCandidates: {},
    },
    getComprehensiveWordStatusSync: getComprehensiveWordStatusSyncMock,
    hasWordSync: hasWordSyncMock,
    addLevelStudyFlashcards: addLevelStudyFlashcardsMock,
  }),
  useSettings: () => ({
    settings: {
      language: settingsLanguageMock,
      known_ease_threshold: 3500,
      srsLearningThreshold: 1500,
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

  it('does not render a fake level card when installed frequency rows have no declared level system', async () => {
    currentLangDataMock = {
      name: 'Unlevelled Language',
      freq: [
        ['alpha', 'alpha'],
        ['beta', 'beta'],
      ],
    };

    const { LevelStudyTab } = await import('./LevelStudyTab');
    const dispose = render(() => <LevelStudyTab />, container);

    expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="level-card"]')).toBeNull();
    expect(container.textContent).not.toContain('Level -1');

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

  it('uses the resolved installed language when bulk-adding from a stale language setting', async () => {
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

    const buttons = Array.from(container.querySelectorAll('button'));
    buttons.find((button) => button.textContent === 'mlearn.LevelStudy.BulkAdd.Button')?.click();
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'mlearn.LevelStudy.BulkAdd.Confirm')
      ?.click();
    await Promise.resolve();

    expect(getComprehensiveWordStatusSyncMock).toHaveBeenCalledWith('猫', 'ja');
    expect(hasWordSyncMock).toHaveBeenCalledWith('猫', 'ja');
    expect(addLevelStudyFlashcardsMock).toHaveBeenCalledWith(['猫', '犬'], 'learning', 'ja');

    dispose();
  });
});
