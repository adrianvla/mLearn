// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';

const mockGetComprehensiveWordStatusWithSourceSync = vi.fn(() => ({
  status: 'unknown',
  source: 'None',
  timesSeen: 0,
}));
const mockWordSyncState = vi.hoisted(() => ({
  settings: {
    language: 'ja',
    uiLanguage: 'en',
    dictionaryTargetLanguages: {} as Record<string, string>,
    use_anki: false,
    wordSyncStaleLearningDays: 30,
  },
  wordFrequency: {
    '赤い': {
      reading: 'あかい',
      raw_level: 5,
      level: 'N5',
    },
  } as Record<string, { reading: string; raw_level: number; level: string }>,
  wordSyncSeen: {} as Record<string, number>,
  knownUntracked: {} as Record<string, unknown>,
  ignoredWords: {} as Record<string, unknown>,
  wordKnowledge: {} as Record<string, unknown>,
  getCanonicalFormForLanguage: vi.fn((_language: string, word: string) => word),
}));

vi.mock('../../context', () => ({
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useLocalization: () => ({ t: (key: string, params?: Record<string, string>) => params?.rated ?? key }),
  useSettings: () => ({
    settings: mockWordSyncState.settings,
  }),
  useLanguage: () => ({
    currentLangData: () => null,
    getFreqLevelNames: () => ({ 5: 'N5' }),
    isLoading: () => false,
    wordFrequency: mockWordSyncState.wordFrequency,
    getWordFrequency: () => mockWordSyncState.wordFrequency,
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getCanonicalFormForLanguage: mockWordSyncState.getCanonicalFormForLanguage,
  }),
  useFlashcards: () => ({
    store: {
      wordKnowledge: mockWordSyncState.wordKnowledge,
      wordSyncSeen: mockWordSyncState.wordSyncSeen,
      knownUntracked: mockWordSyncState.knownUntracked,
      ignoredWords: mockWordSyncState.ignoredWords,
      wordToCardMap: {},
      flashcards: {},
    },
    setWordKnowledgeEase: vi.fn(),
    markWordSyncSeen: vi.fn(),
    getWordKnowledge: vi.fn(() => null),
    getComprehensiveWordStatusWithSourceSync: mockGetComprehensiveWordStatusWithSourceSync,
  }),
}));

vi.mock('../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; class?: string }) => (
    <button class={props.class} onClick={props.onClick}>{props.children}</button>
  ),
  EmptyState: (props: { title?: string }) => <div>{props.title}</div>,
  FilterBuilder: () => <div />,
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  buildWordSyncFields: () => ({ fields: [], paletteItems: [] }),
  buildWordSyncPreset: () => [],
  evaluateAst: () => true,
  parseTokens: () => null,
  validateTokens: () => ({ ok: true }),
}));

vi.mock('../../components/language-specific', () => ({
  WordWithReading: (props: { word: string; reading?: string }) => <span>{props.reading ? `${props.word}:${props.reading}` : props.word}</span>,
}));

vi.mock('../../components/flashcard/FlashcardWordTitle', () => ({
  FlashcardWordTitle: (props: { content: { front: string; reading?: string; prosody?: unknown } }) => (
    <span data-prosody={props.content.prosody ? 'yes' : 'no'}>
      {props.content.reading ? `${props.content.front}:${props.content.reading}` : props.content.front}
    </span>
  ),
}));

vi.mock('../../utils/readingProsody', () => ({
  extractProsodyFromTranslationData: vi.fn(() => undefined),
}));

vi.mock('../../hooks/useTranslation', () => ({
  fetchTranslation: vi.fn(async () => ({ data: [] })),
}));

vi.mock('../../services/ankiWordsCache', () => ({
  fetchAnkiWordsCache: vi.fn(async () => undefined),
  isAnkiCacheFetched: vi.fn(() => true),
}));

vi.mock('../../../shared/languageFeatures', () => ({
  extractStudyCharacters: () => [],
  getCharacterStudyScripts: () => [],
  getFrequencyLevelLabel: (level: number, names?: Record<string, string>) => names?.[String(level)] ?? String(level),
  getFrequencyLevelVisualRank: (level: number) => level,
  getLearningLanguageLevelForLanguage: () => null,
  sortFrequencyLevelsByDifficulty: (levels: number[]) => levels,
}));

vi.mock('../../../shared/languageScriptProfile', () => ({
  hasLettersInAnyScript: () => false,
}));

describe('WordSyncContent', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockGetComprehensiveWordStatusWithSourceSync.mockClear();
    mockWordSyncState.settings.language = 'ja';
    mockWordSyncState.wordFrequency = {
      '赤い': {
        reading: 'あかい',
        raw_level: 5,
        level: 'N5',
      },
    };
    mockWordSyncState.wordSyncSeen = {};
    mockWordSyncState.knownUntracked = {};
    mockWordSyncState.ignoredWords = {};
    mockWordSyncState.wordKnowledge = {};
    mockWordSyncState.getCanonicalFormForLanguage.mockReset();
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((_language: string, word: string) => word);
  });

  afterEach(() => {
    container.remove();
  });

  it('uses keyed local status instead of comprehensive per-row resolution when Anki is off', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();

    expect(mockGetComprehensiveWordStatusWithSourceSync).not.toHaveBeenCalled();
    dispose();
  });

  it('does not rebuild the full candidate pool after a rating button press', async () => {
    mockWordSyncState.wordFrequency = {
      '赤い': {
        reading: 'あかい',
        raw_level: 5,
        level: 'N5',
      },
      '青い': {
        reading: 'あおい',
        raw_level: 5,
        level: 'N5',
      },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    const initialCanonicalizations = mockWordSyncState.getCanonicalFormForLanguage.mock.calls.length;
    const knownButton = container.querySelector<HTMLButtonElement>('.word-sync-btn--known');
    expect(knownButton).not.toBeNull();

    knownButton!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockWordSyncState.getCanonicalFormForLanguage.mock.calls.length).toBe(initialCanonicalizations);
    dispose();
  });

  it('filters seen-recently words by the active language canonical form', async () => {
    const { hashWordSync } = await import('../../services/srsAlgorithm');
    mockWordSyncState.settings.language = 'ar';
    mockWordSyncState.wordFrequency = {
      'يكتب': {
        reading: 'yaktub',
        raw_level: 5,
        level: 'A1',
      },
    };
    mockWordSyncState.wordSyncSeen = {
      [`ar:${hashWordSync('كتب')}`]: Date.now(),
    };
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();

    expect(container.textContent).not.toContain('يكتب');
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    dispose();
  });

  it('filters known-untracked words by the active language canonical form', async () => {
    const { hashWordSync } = await import('../../services/srsAlgorithm');
    mockWordSyncState.settings.language = 'ar';
    mockWordSyncState.wordFrequency = {
      'يكتب': {
        reading: 'yaktub',
        raw_level: 5,
        level: 'A1',
      },
    };
    mockWordSyncState.knownUntracked = {
      [`ar:${hashWordSync('كتب')}`]: { word: 'كتب', language: 'ar', knownAt: Date.now() },
    };
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();

    expect(container.textContent).not.toContain('يكتب');
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    dispose();
  });
});
