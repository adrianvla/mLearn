// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createEffect, createSignal, Show } from 'solid-js';
import type { JSX } from 'solid-js';

const mockGetComprehensiveWordStatusWithSourceSync = vi.fn(() => ({
  status: 'unknown',
  source: 'None',
  timesSeen: 0,
}));
const mockClearAllWordSyncSeen = vi.fn();
const mockSetWordKnowledgeEase = vi.fn();
const mockMarkWordSyncSeen = vi.fn();
const mockRestoreWordSyncRating = vi.fn();
const mockFetchTranslation = vi.hoisted(() => vi.fn(async (): Promise<{ data: Array<{ definitions: string[]; reading?: string }> }> => ({ data: [] })));
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

const mockCommonState = vi.hoisted(() => ({
  filterBuilderProps: null as {
    tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>;
    onChange: (tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>) => void;
  } | null,
  defaultPreset: [
    {
      instanceId: 'default-open-status',
      kind: 'paren',
      dir: 'open',
    },
    {
      instanceId: 'default-status-untracked',
      kind: 'operand',
      field: 'status',
      op: 'eq',
      value: 'untracked',
    },
    {
      instanceId: 'default-status-or',
      kind: 'operator',
      op: 'OR',
    },
    {
      instanceId: 'default-status-unknown',
      kind: 'operand',
      field: 'status',
      op: 'eq',
      value: '0',
    },
    {
      instanceId: 'default-close-status',
      kind: 'paren',
      dir: 'close',
    },
  ],
  buildWordSyncPreset: vi.fn(),
}));

mockCommonState.buildWordSyncPreset.mockImplementation(() => (
  mockCommonState.defaultPreset.map((token) => ({ ...token }))
));

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
    getWordTrackingSync: () => ({ tracker: 'nothing' as const }),
    isLoading: () => false,
    store: {
      wordKnowledge: mockWordSyncState.wordKnowledge,
      wordSyncSeen: mockWordSyncState.wordSyncSeen,
      knownUntracked: mockWordSyncState.knownUntracked,
      ignoredWords: mockWordSyncState.ignoredWords,
      wordToCardMap: {},
      flashcards: {},
    },
    setWordKnowledgeEase: mockSetWordKnowledgeEase,
    markWordSyncSeen: mockMarkWordSyncSeen,
    clearAllWordSyncSeen: mockClearAllWordSyncSeen,
    restoreWordSyncRating: mockRestoreWordSyncRating,
    getWordKnowledge: vi.fn(() => null),
    getComprehensiveWordStatusWithSourceSync: mockGetComprehensiveWordStatusWithSourceSync,
  }),
}));

vi.mock('../../components/common', () => ({
  Btn: (props: { children?: JSX.Element; onClick?: () => void; class?: string }) => (
    <button type="button" class={props.class} onClick={props.onClick}>{props.children}</button>
  ),
  EmptyState: (props: { title?: string }) => <div>{props.title}</div>,
  Popover: (props: {
    open?: boolean | (() => boolean);
    children?: JSX.Element;
  }) => {
    const [rendered, setRendered] = createSignal(false);
    createEffect(() => setRendered(Boolean(typeof props.open === 'function' ? props.open() : props.open)));
    return <Show when={rendered()}>{props.children}</Show>;
  },
  FilterBuilder: (props: {
    tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>;
    onChange: (tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>) => void;
  }) => {
    mockCommonState.filterBuilderProps = props;
    return (
      <button
        type="button"
        class="mock-filter-clear"
        data-token-count={String(props.tokens.length)}
        onClick={() => props.onChange([])}
      />
    );
  },
  PillLabel: (props: { children?: JSX.Element }) => <span>{props.children}</span>,
  ToggleSwitch: (props: { checked?: boolean; onChange?: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      checked={props.checked ?? false}
      onChange={(e) => props.onChange?.(e.currentTarget.checked)}
    />
  ),
  ConfirmDialog: (props: {
    isOpen?: boolean;
    onClose?: () => void;
    onConfirm?: () => void;
    confirmText?: string;
  }) => (
    <Show when={props.isOpen}>
      <button type="button" class="mock-confirm-dialog-cancel" onClick={props.onClose}>cancel</button>
      <button type="button" class="mock-confirm-dialog-confirm" onClick={props.onConfirm}>{props.confirmText}</button>
    </Show>
  ),
  WORD_SYNC_STATUS_UNTRACKED: 'untracked',
  buildWordSyncFields: () => ({ fields: [], paletteItems: [] }),
  buildWordSyncPreset: mockCommonState.buildWordSyncPreset,
  evaluateAst: () => true,
  parseTokens: () => null,
  validateTokens: () => ({ ok: true }),
}));

vi.mock('../../components/language-specific', () => ({
  WordWithReading: (props: { word: string; reading?: string }) => <span>{props.reading ? `${props.word}:${props.reading}` : props.word}</span>,
}));

vi.mock('../../utils/readingProsody', () => ({
  extractProsodyFromTranslationData: vi.fn(() => undefined),
}));

vi.mock('../../hooks/useTranslation', () => ({
  fetchTranslation: mockFetchTranslation,
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
    mockWordSyncState.settings.use_anki = false;
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
    mockCommonState.filterBuilderProps = null;
    mockCommonState.buildWordSyncPreset.mockClear();
    mockClearAllWordSyncSeen.mockClear();
    mockSetWordKnowledgeEase.mockClear();
    mockMarkWordSyncSeen.mockClear();
    mockRestoreWordSyncRating.mockClear();
    mockFetchTranslation.mockReset();
    mockFetchTranslation.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    container.remove();
  });

  it('does not treat Anki-only words as tracked for word sync filter eligibility', async () => {
    mockWordSyncState.settings.use_anki = true;
    mockGetComprehensiveWordStatusWithSourceSync.mockReturnValue({
      status: 'known',
      source: 'Anki',
      timesSeen: 1,
    });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();

    // The word stays eligible (shown) even though the Anki-aware resolver would
    // call it 'known' — pool eligibility comes from the store, not that resolver.
    expect(container.textContent).toContain('赤い:あかい');
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

  it('toggles the current word translation with Space', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).not.toContain('red');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
    await Promise.resolve();

    expect(container.textContent).toContain('red');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
    await Promise.resolve();

    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('renders the word as pure text when additional info is part of the answer', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Default (toggle off): full word render with reading.
    expect(container.textContent).toContain('赤い:あかい');
    // Word Sync owns its word display — no flashcard-display classes leak in.
    expect(container.querySelector('.flashcard-word-title')).toBeNull();

    // Toggle on: hidden answer shows the bare word.
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    toggle!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い');
    expect(container.textContent).not.toContain('赤い:あかい');
    expect(container.querySelector('.flashcard-word-title')).toBeNull();

    // Revealing the answer restores the full render.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');
    expect(container.querySelector('.flashcard-word-title')).toBeNull();
    dispose();
  });

  it('displays and stores the dictionary entry reading instead of the freq-list primary', async () => {
    // 赤い has freq primary あかい, but the dictionary's chosen entry reads あか
    // (different senses of the same kanji — like 仏: ほとけ Buddha vs ふつ France).
    mockFetchTranslation.mockResolvedValue({ data: [{ reading: 'あか', definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The displayed reading follows the dictionary entry, not the freq primary.
    expect(container.textContent).toContain('赤い:あか');
    expect(container.textContent).not.toContain('赤い:あかい');

    // Rating stores the displayed (dictionary) reading so the word DB pairs it
    // with the same definition.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    expect(mockSetWordKnowledgeEase).toHaveBeenCalledWith('赤い', expect.any(Number), 'あか', 'ja');
    dispose();
  });

  it('undoes the last word sync rating with Cmd+Z', async () => {
    const { hashWordSync } = await import('../../services/srsAlgorithm');
    const previousKnowledge = {
      ease: 0.2,
      lastSeen: 100,
      timesSeen: 2,
      timesHovered: 0,
      word: '赤い',
      reading: 'あかい',
      language: 'ja',
      lastStatusChange: 100,
    };
    mockWordSyncState.wordKnowledge = {
      [`ja:${hashWordSync('赤い')}`]: previousKnowledge,
    };
    mockWordSyncState.wordSyncSeen = {
      [`ja:${hashWordSync('赤い')}`]: 1234,
    };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');
    container.querySelector<HTMLButtonElement>('.word-sync-btn--known')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledWith('赤い', previousKnowledge, 1234, 'ja');
    expect(container.textContent).toContain('赤い:あかい');
    dispose();
  });

  it('undoes multiple word sync ratings with repeated Cmd+Z', async () => {
    const { hashWordSync } = await import('../../services/srsAlgorithm');
    const prevA = {
      ease: 0.2, lastSeen: 100, timesSeen: 2, timesHovered: 0,
      word: '赤い', reading: 'あかい', language: 'ja', lastStatusChange: 100,
    };
    const prevB = {
      ease: 0.3, lastSeen: 200, timesSeen: 1, timesHovered: 0,
      word: '青い', reading: 'あおい', language: 'ja', lastStatusChange: 200,
    };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    mockWordSyncState.wordKnowledge = {
      [`ja:${hashWordSync('赤い')}`]: prevA,
      [`ja:${hashWordSync('青い')}`]: prevB,
    };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Pool order within a level is shuffled, so detect which word came up first.
    const firstWord = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';
    const secondWord = firstWord === '赤い' ? '青い' : '赤い';
    const prevFirst = firstWord === '赤い' ? prevA : prevB;
    const prevSecond = secondWord === '赤い' ? prevA : prevB;

    container.querySelector<HTMLButtonElement>('.word-sync-btn--known')?.click();
    await Promise.resolve();
    container.querySelector<HTMLButtonElement>('.word-sync-btn--known')?.click();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(1);
    expect(mockRestoreWordSyncRating).toHaveBeenLastCalledWith(secondWord, prevSecond, undefined, 'ja');
    expect(container.textContent).toContain(`${secondWord}:`);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(2);
    expect(mockRestoreWordSyncRating).toHaveBeenLastCalledWith(firstWord, prevFirst, undefined, 'ja');
    expect(container.textContent).toContain(`${firstWord}:`);

    dispose();
  });

  it('rates once per press, ignoring held-down key auto-repeat', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');

    // Held-down key: OS auto-repeat keydowns must not rate again.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true }));
    await Promise.resolve();
    expect(mockSetWordKnowledgeEase).not.toHaveBeenCalled();
    expect(container.textContent).toContain('赤い:あかい');

    // A fresh press rates exactly once.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    expect(mockSetWordKnowledgeEase).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

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

  it('restores the default word sync filter when starting over after confirmation', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // When the filter dropdown is opened (closed by default)
    container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCommonState.filterBuilderProps?.tokens).toMatchObject([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
    ]);

    container.querySelector<HTMLButtonElement>('.mock-filter-clear')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCommonState.filterBuilderProps?.tokens).toEqual([]);

    container.querySelector<HTMLButtonElement>('.word-sync-btn--known')?.click();
    await Promise.resolve();
    await Promise.resolve();

    const recheckButton = container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn');
    expect(recheckButton).not.toBeNull();
    recheckButton!.click();
    await Promise.resolve();
    await Promise.resolve();

    // Nothing resets until the confirmation dialog is confirmed.
    expect(mockClearAllWordSyncSeen).not.toHaveBeenCalled();

    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-confirm')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCommonState.filterBuilderProps?.tokens).toMatchObject([
      { kind: 'paren', dir: 'open' },
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'OR' },
      { kind: 'operand', field: 'status', op: 'eq', value: '0' },
      { kind: 'paren', dir: 'close' },
    ]);
    expect(mockCommonState.buildWordSyncPreset).toHaveBeenCalledTimes(2);
    expect(mockClearAllWordSyncSeen).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('keeps the filter available on the finished screen', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>('.word-sync-btn--known')?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // The filter toggle stays reachable on the finished screen instead of
    // forcing a full restart just to adjust the scope.
    const filterToggle = container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle');
    expect(filterToggle).not.toBeNull();
    filterToggle!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCommonState.filterBuilderProps).not.toBeNull();
    dispose();
  });

  it('requires confirmation before starting over', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>('.word-sync-btn--known')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn')!.click();
    await Promise.resolve();
    await Promise.resolve();

    // Opening the dialog must not clear seen history or restart the session.
    expect(mockClearAllWordSyncSeen).not.toHaveBeenCalled();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Cancelling keeps the finished screen untouched.
    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-cancel')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    expect(mockClearAllWordSyncSeen).not.toHaveBeenCalled();
    dispose();
  });
});
