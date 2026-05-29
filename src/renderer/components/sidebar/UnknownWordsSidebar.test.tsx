// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import type { TranslationResponse } from '../../../shared/types';

const translationByWord = new Map<string, TranslationResponse | null | undefined>();
const trackedWords = new Set<string>();
const flashcardsByWord = new Map<string, { ease: number }>();
const ankiMatchesByWord = new Map<string, { word: string; cards: Array<{ factor?: number; queue?: number; type?: number }> }>();

vi.mock('../common', () => ({
  Btn: (props: { label?: string; onClick?: () => void; disabled?: boolean }) => (
    <button disabled={props.disabled} onClick={props.onClick}>{props.label}</button>
  ),
  CollapsibleStickyHeader: (props: { children?: JSX.Element; class?: string }) => <div class={props.class}>{props.children}</div>,
  PillBtn: (props: { label?: string; children?: JSX.Element; onClick?: () => void; disabled?: boolean; ['aria-pressed']?: boolean }) => (
    <button
      aria-pressed={props['aria-pressed']}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label ?? props.children}
    </button>
  ),
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  PitchAccentOverlay: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  Select: (props: { value: string; onChange?: (event: Event & { currentTarget: HTMLSelectElement }) => void; options: Array<{ value: string; label: string }> }) => (
    <select value={props.value} onChange={props.onChange}>
      {props.options.map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('../common/Smart', () => ({
  ResourcePill: (props: { word: string }) => <span class="mock-resource-pill">{`resource:${props.word}`}</span>,
  WordStatusPill: (props: { word: string }) => <span class="mock-status-pill">{`status:${props.word}`}</span>,
}));

vi.mock('../../context', () => ({
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      switch (key) {
        case 'mlearn.AITutorSetup.AllLevels':
          return 'All';
        case 'mlearn.ConversationAgent.Stats.FailedWords':
          return 'Failed Words';
        case 'mlearn.ConversationAgent.Stats.NoFailedWords':
          return 'No failed words yet';
        case 'mlearn.Sidebar.AddAll':
          return 'Add All';
        case 'mlearn.Sidebar.AddingAll':
          return 'Adding...';
        case 'mlearn.Sidebar.DictionaryOnly':
          return 'Dictionary only';
        case 'mlearn.Sidebar.Ignore':
          return 'Ignore';
        case 'mlearn.Sidebar.SortBy.Word':
          return 'Word';
        case 'mlearn.Sidebar.UnknownWords':
          return 'Unknown Words';
        case 'mlearn.Sidebar.WordCount':
          return `${params?.count ?? 0} words`;
        default:
          return key;
      }
    },
  }),
  useSettings: () => ({
    settings: {
      use_anki: true,
      enable_flashcard_creation: true,
      show_pos: false,
      showPitchAccent: false,
      ankiLearningThreshold: 1500,
      ankiKnownThreshold: 1800,
      ankiLearningEase: 1500,
      ankiKnownEase: 1800,
      knowledgeSourceOrder: ['srs', 'anki', 'manual'],
      knowledgeResolutionMode: 'highest',
    },
  }),
  useFlashcards: () => ({
    hasWordSync: (word: string) => trackedWords.has(word),
    getCardByWordSync: (word: string) => flashcardsByWord.get(word) ?? null,
    getComprehensiveWordStatusSync: () => 'unknown',
    isWordIgnoredSync: () => false,
  }),
  useLanguage: () => ({
    getFrequency: () => null,
    getLevelName: (level: number) => `Level ${level}`,
    getLanguageFeatures: () => ({ supportsPitchAccent: false }),
    getCanonicalForm: (word: string) => word,
  }),
}));

vi.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({
    translateWord: vi.fn(async (word: string) => translationByWord.get(word) ?? null),
  }),
  getCachedTranslation: (word: string) => translationByWord.get(word),
}));

vi.mock('../subtitle/wordHoverHelpers', () => ({
  extractPitchAccentFromTranslationData: () => undefined,
  extractReadingFromEntries: () => '',
  getAnkiWordKnowledgeStatus: (cards: Array<{ factor?: number }> | null | undefined) => cards && cards.length > 0 ? 'learning' : null,
  numericToWordStatus: (status: number) => {
    if (status === 1) return 'learning';
    if (status === 2) return 'known';
    return 'unknown';
  },
  resolveWordKnowledge: (card: { ease?: number } | null, manualStatus: string, ankiStatus: string | null) => ({
    status: ankiStatus ?? (card ? 'learning' : manualStatus),
    activeSources: [],
    dataSources: [],
  }),
}));

vi.mock('../../services/statsService', () => ({
  getWordStatus: () => 0,
}));

vi.mock('../../services/ankiWordsCache', () => ({
  fetchAnkiWordsCache: vi.fn(async () => undefined),
  findAnkiWordMatchInCache: (words: readonly string[]) => {
    for (const word of words) {
      const match = ankiMatchesByWord.get(word);
      if (match) {
        return match;
      }
    }
    return null;
  },
  isAnkiCacheFetched: () => true,
}));

vi.mock('../../utils/wordForms', () => ({
  getWordFormCandidates: (word: string) => [word],
}));

describe('UnknownWordsSidebar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    translationByWord.clear();
    trackedWords.clear();
    flashcardsByWord.clear();
    ankiMatchesByWord.clear();

    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('filters the list by failed words and scopes add-all to the active category', async () => {
    translationByWord.set('apple', {
      data: [{ definitions: ['fruit'], reading: 'apple' }],
    } as TranslationResponse);
    translationByWord.set('banana', null);

    const onAddAllClick = vi.fn();
    const words = [
      {
        key: 'word-1',
        word: 'apple',
        token: { word: 'apple', actual_word: 'apple', partOfSpeech: 'noun', type: 'word' },
        contextPhrase: 'apple context',
      },
      {
        key: 'word-2',
        word: 'banana',
        token: { word: 'banana', actual_word: 'banana', partOfSpeech: 'noun', type: 'word' },
        contextPhrase: 'banana context',
      },
    ];

    const { UnknownWordsSidebar } = await import('./UnknownWordsSidebar');

    const dispose = render(() => (
      <UnknownWordsSidebar
        words={() => words}
        addingWordKeys={() => new Set<string>()}
        isAddingAll={() => false}
        failedWordSet={() => new Set<string>(['banana'])}
        failedEmptyMessage="No failed words yet"
        onAddWord={() => undefined}
        onIgnoreWord={() => undefined}
        sortOptions={() => [{ value: 'word', label: 'Word' }]}
        defaultSort="word"
        emptyMessage="No unknown words"
        onAddAllClick={onAddAllClick}
      />
    ), container);

    await Promise.resolve();

    expect(container.textContent).toContain('apple');
    expect(container.textContent).toContain('banana');

    const failedButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Failed Words');
    failedButton?.click();

    expect(container.textContent).not.toContain('apple context');
    expect(container.textContent).toContain('banana');
    expect(container.textContent).toContain('1 words');

    const addAllButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Add All');
    addAllButton?.click();

    expect(onAddAllClick).toHaveBeenCalledTimes(1);
    expect(onAddAllClick.mock.calls[0][0]).toEqual([
      expect.objectContaining({ word: 'banana' }),
    ]);
    expect(onAddAllClick.mock.calls[0][1]).toEqual([]);

    dispose();
  });
});