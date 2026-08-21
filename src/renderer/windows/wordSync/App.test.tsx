// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createEffect, createSignal, Show } from 'solid-js';
import type { JSX } from 'solid-js';

const mockGetComprehensiveWordStatusWithSourceSync = vi.fn((): { status: string; source: string; timesSeen: number; ease?: number } => ({
  status: 'unknown',
  source: 'None',
  timesSeen: 0,
}));
const mockClearAllWordSyncSeen = vi.fn();
const mockSetWordKnowledgeEase = vi.fn();
const mockSetAspectStatus = vi.fn();
const mockRecordAttempt = vi.fn();
const mockShowToast = vi.hoisted(() => vi.fn());
const isReadingScriptTextFn = vi.hoisted(() => vi.fn((_surface?: unknown, _data?: unknown) => false));
const mockMarkWordSyncSeen = vi.fn();
const mockRestoreWordSyncRating = vi.fn();
const mockFetchTranslation = vi.hoisted(() => vi.fn(async (_word?: string): Promise<{ data: Array<{ definitions: string[]; reading?: string }> }> => ({ data: [] })));
const mockWordSyncState = vi.hoisted(() => ({
  settings: {
    language: 'ja',
    uiLanguage: 'en',
    dictionaryTargetLanguages: {} as Record<string, string>,
    use_anki: false,
    ratingKeyboardMode: 'mnemonic' as const,
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
  wordKnowledge: {} as Record<string, { word: string; [key: string]: unknown }>,
  currentLangData: null as { textProcessing?: { readingAnnotation?: boolean }; prosody?: { type?: string } } | null,
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

vi.mock('../../context', async () => {
  const { hashWordSync } = await import('../../services/srsAlgorithm');
  return {
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useLocalization: () => ({ t: (key: string, params?: Record<string, string>) => params?.rated ?? key }),
  useSettings: () => ({
    settings: mockWordSyncState.settings,
  }),
  useLanguage: () => ({
    currentLangData: () => mockWordSyncState.currentLangData,
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
    setAspectStatus: mockSetAspectStatus,
    recordAttempt: mockRecordAttempt,
    markWordSyncSeen: mockMarkWordSyncSeen,
    clearAllWordSyncSeen: mockClearAllWordSyncSeen,
    restoreWordSyncRating: mockRestoreWordSyncRating,
    getWordKnowledge: vi.fn(() => null),
    getWordKnowledgeSnapshotForForms: vi.fn((word: string, language?: string) => {
      const lang = language ?? 'ja';
      const snapshot: Record<string, typeof mockWordSyncState.wordKnowledge[string] | undefined> = {};
      for (const [lk, entry] of Object.entries(mockWordSyncState.wordKnowledge)) {
        if (lk.startsWith(`${lang}:`) && entry?.word === word) {
          snapshot[lk] = entry ? { ...entry } : undefined;
        }
      }
      return snapshot;
    }),
    getWordSyncSeenSnapshotForForms: vi.fn((word: string, language?: string) => {
      const lang = language ?? 'ja';
      return { [`${lang}:${hashWordSync(word)}`]: mockWordSyncState.wordSyncSeen[`${lang}:${hashWordSync(word)}`] };
    }),
    getComprehensiveWordStatusWithSourceSync: mockGetComprehensiveWordStatusWithSourceSync,
  }),
  };
});

vi.mock('../../components/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/common')>();
  return ({
  // Real RatingMatrix: rating tests exercise the actual input controller.
  RatingMatrix: actual.RatingMatrix,
  RateOptions: undefined,
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
  });
});

vi.mock('../../components/language-specific', () => ({
  WordWithReading: (props: { word: string; reading?: string }) => <span>{props.reading ? `${props.word}:${props.reading}` : props.word}</span>,
}));

vi.mock('../../utils/readingProsody', () => ({
  extractProsodyFromTranslationData: vi.fn(() => undefined),
}));

vi.mock('../../components/common/Feedback/Toast', () => ({
  showToast: mockShowToast,
}));

vi.mock('../../hooks/useTranslation', () => ({
  fetchTranslation: mockFetchTranslation,
}));

vi.mock('../../services/ankiWordsCache', () => ({
  fetchAnkiWordsCache: vi.fn(async () => undefined),
  isAnkiCacheFetched: vi.fn(() => true),
  ankiCacheVersion: vi.fn(() => 0),
}));

vi.mock('../../../shared/languageFeatures', async () => {
  // getAvailableAspects is pure and unmocked — safe to import inside the factory.
  const { getAvailableAspects } = await import('../../../shared/types');
  return {
    extractStudyCharacters: () => [],
    getCharacterStudyScripts: () => [],
    getFrequencyLevelLabel: (level: number, names?: Record<string, string>) => names?.[String(level)] ?? String(level),
    getFrequencyLevelVisualRank: (level: number) => level,
    getLearningLanguageLevelForLanguage: () => null,
    sortFrequencyLevelsByDifficulty: (levels: number[]) => levels,
    // Kanji/mixed surfaces by default (reading testable); the kana-gate test flips this.
    // getDictionaryLookupCandidates feeds wordForms' reading-lookup branch (reached once
    // the flip is on) — absent from the factory it throws and kills the pool build.
    isReadingScriptText: isReadingScriptTextFn,
    getDictionaryLookupCandidates: vi.fn(() => []),
    // Faithful mirror of the shared gate, wired to the MOCKED isReadingScriptText
    // (the real module's internal binding would bypass this mock).
    getTestedAspects: vi.fn(({ languageData, surface, hasReadingData, hasProsodyData }: {
      languageData?: unknown; surface: string; hasReadingData: boolean; hasProsodyData: boolean;
    }) => {
      const available = getAvailableAspects(languageData as never);
      const supplies = isReadingScriptTextFn(surface, languageData as never);
      const aspects: string[] = ['meaning'];
      if (available.includes('reading') && hasReadingData && !supplies) aspects.push('reading');
      if (available.includes('prosody') && hasProsodyData) aspects.push('prosody');
      if (available.includes('orthography') && !supplies) aspects.push('orthography');
      return aspects;
    }),
  };
});

vi.mock('../../../shared/languageScriptProfile', () => ({
  hasLettersInAnyScript: () => false,
}));

describe('WordSyncContent', () => {
  let container: HTMLDivElement;

  // Mnemonic chord + submit: reveal, quality, aspect letter, then the profile
  // submit boundary (wordSync runs the matrix in profile mode — drafts only,
  // Space commits; the first Space reveals the answer, the second submits).
  const chord = (quality: '1' | '2' | '3', letter: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: quality }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: letter }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  };

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
    mockSetAspectStatus.mockClear();
    mockRecordAttempt.mockClear();
    mockShowToast.mockClear();
    mockMarkWordSyncSeen.mockClear();
    mockRestoreWordSyncRating.mockClear();
    mockWordSyncState.currentLangData = null;
    isReadingScriptTextFn.mockImplementation(() => false);
    mockFetchTranslation.mockReset();
    mockFetchTranslation.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    container.remove();
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

    // Meaning fluent via mnemonic chord — the pool must not rebuild.
    chord('3', 'm');
    await Promise.resolve();
    await Promise.resolve();

    // Pool order is shuffled — either word may surface first.
    expect(mockRecordAttempt).toHaveBeenCalledWith(expect.any(String), 'meaning', 'fluent', expect.objectContaining({ language: 'ja' }));
    expect(mockWordSyncState.getCanonicalFormForLanguage.mock.calls.length).toBe(initialCanonicalizations);
    dispose();
  });

  it('reveals then toggles the current word translation with T', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).not.toContain('red');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
    await Promise.resolve();

    expect(container.textContent).toContain('red');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
    await Promise.resolve();

    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('reveals the answer on the first Space and submits all-fluent on the second', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Prompt first: the answer stays hidden.
    expect(container.textContent).not.toContain('red');

    // First Space reveals the answer; nothing is rated yet.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(container.textContent).toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // Second Space submits the existing profile rating as fluent.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('pointer reveal via the translation control arms RatingMatrix and shows the translation', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Prompt first: translation hidden, nothing rated.
    expect(container.textContent).not.toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // A pointer user clicks the visible translation/reveal control.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();

    // Same revealed-and-ratable state as the first Space: translation shown,
    // and the matrix is armed so a second Space submits.
    expect(container.textContent).toContain('red');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('reveals on the first Enter and submits all-fluent on the second', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).not.toContain('red');

    // First Enter reveals the answer.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    expect(container.textContent).toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // Second Enter submits the existing profile rating as fluent.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('hides a manually-toggled translation on the next word', async () => {
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['definition'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Manually toggle the translation on the first card (pointer reveal).
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();
    expect(container.textContent).toContain('definition');

    // Submit all-fluent → the next word is presented with translation hidden,
    // even though the prior card's translation was manually toggled.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).not.toContain('definition');
    dispose();
  });

  it('hides a manually-toggled translation on restart', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Manually toggle the translation on, then reveal and submit → finished.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Start over → the first word is presented with translation hidden.
    container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn')!.click();
    await Promise.resolve();
    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-confirm')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('hides a manually-toggled translation on undo', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Manually toggle the translation on, then reveal and submit → finished.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Undo restores the word with the translation hidden.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();
    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('does not rate before the answer is revealed', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Chord + submit before reveal: the first Space only reveals, nothing rates.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // Now the answer is revealed; the same chord drafts and Space submits.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('resets the reveal state when a new word is selected', async () => {
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    mockFetchTranslation.mockImplementation(async (word?: string) => ({
      data: [{ definitions: [word === '赤い' ? 'red' : 'blue'] }],
    }));
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal and submit the first word.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    await Promise.resolve();

    // The next word is presented with its answer hidden — no leak from the
    // previous card's reveal.
    expect(container.textContent).not.toContain('blue');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('undo restores the previous word with the answer hidden again', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal and submit all-fluent → finished.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Undo restores the word with the answer hidden (no translation leak).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();
    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('starting over presents the first word with the answer hidden', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal + submit → finished.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Start over → the first word is presented with the answer hidden.
    container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn')!.click();
    await Promise.resolve();
    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-confirm')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');
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
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
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
    chord('1', 'm');
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'missed', expect.objectContaining({ language: 'ja' }));
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
    chord('3', 'm');
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledWith(
      '赤い',
      { [`ja:${hashWordSync('赤い')}`]: previousKnowledge },
      { [`ja:${hashWordSync('赤い')}`]: 1234 },
      'ja',
    );
    expect(container.textContent).toContain('赤い:あかい');
    dispose();
  });

  it('Cmd+Z still works when a rating-matrix cell holds focus', async () => {
    // Two words: one click-rating must not finish the session — the matrix (and
    // the clicked cell) have to stay mounted for the undo dispatch to bubble.
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal the answer first (Space), then click drafts (profile mode), Space
    // submits, THEN undo dispatched FROM the cell button — the target being a
    // button must not swallow the shortcut.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    const cell = container.querySelector<HTMLButtonElement>('.rating-matrix__cell');
    if (!cell) throw new Error('matrix cell missing');
    cell.click();
    await Promise.resolve();
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalled();

    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('a lone quality key arms a chord and writes nothing until the aspect letter', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal the answer before rating.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();

    // Pending chord: nothing recorded, hint visible.
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('mlearn.Rating.Matrix.PendingHint');

    // Meaning completion only DRAFTS — profile mode emits nothing until submit.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('赤い');

    // Space is the submit boundary: the record fires.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('a reading-script surface supplies the reading: only the Meaning row is offered', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    // Pure reading-script surface (もたれる-style): the interaction supplies the
    // segmental reading — the matrix must not offer a Reading row at all.
    isReadingScriptTextFn.mockImplementation(() => true);
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Reading');
    // Meaning missed on the kana surface: rated directly via chord.
    chord('1', 'm');
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'missed', expect.anything());
    isReadingScriptTextFn.mockImplementation(() => false);
    dispose();
  });

  it('a non-reading-transparent surface offers the Written-form row (1+O)', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Orthography');

    chord('1', 'o');
    await Promise.resolve();
    // Orthography is surface-scoped; the wordSync task demonstrates the chain up
    // to (but not including) orthography — orthography has no prerequisites.
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'orthography', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('routes a reading miss through recordAttempt with word-presentation demonstration', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    chord('1', 'r');
    await Promise.resolve();

    // Profile submit: reading missed (explicit), other tested aspects fluent
    // (confirmed), one shared attemptId, encounter marked on the miss.
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'reading', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    const attemptIds = new Set(mockRecordAttempt.mock.calls.map((call) => (call[3] as { attemptId?: number })?.attemptId));
    expect(attemptIds.size).toBe(1);
    expect(mockMarkWordSyncSeen).toHaveBeenCalledWith('赤い', 'ja');
    dispose();
  });

  it('never pools words the comprehensive resolver marks known (e.g. via anki)', async () => {
    mockGetComprehensiveWordStatusWithSourceSync.mockReturnValue({
      status: 'known',
      source: 'Anki',
      timesSeen: 1,
    });
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Pool empty → the finished state renders instead of any word.
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    dispose();
    // Restore the shared mock's default shape (mockReturnValue persists across tests).
    mockGetComprehensiveWordStatusWithSourceSync.mockImplementation(() => ({
      status: 'unknown',
      source: 'None',
      timesSeen: 0,
    }));
  });

  it('cancels attribution with Escape without rating', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal first so the matrix is armed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await Promise.resolve();

    // Chord cancelled: no record, no pending hint, word still presented.
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('mlearn.Rating.Matrix.PendingHint');
    expect(container.textContent).toContain('赤い');
    dispose();
  });

  it('undoes an aspect-attributed rating via the per-hash snapshot', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
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
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    chord('1', 'r');
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'reading', 'missed', expect.anything());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledWith(
      '赤い',
      { [`ja:${hashWordSync('赤い')}`]: previousKnowledge },
      { [`ja:${hashWordSync('赤い')}`]: undefined },
      'ja',
    );
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

    chord('3', 'm');
    await Promise.resolve();
    chord('3', 'm');
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(1);
    expect(mockRestoreWordSyncRating).toHaveBeenLastCalledWith(
      secondWord,
      { [`ja:${hashWordSync(secondWord)}`]: prevSecond },
      { [`ja:${hashWordSync(secondWord)}`]: undefined },
      'ja',
    );
    expect(container.textContent).toContain(`${secondWord}:`);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(2);
    expect(mockRestoreWordSyncRating).toHaveBeenLastCalledWith(
      firstWord,
      { [`ja:${hashWordSync(firstWord)}`]: prevFirst },
      { [`ja:${hashWordSync(firstWord)}`]: undefined },
      'ja',
    );
    expect(container.textContent).toContain(`${firstWord}:`);

    dispose();
  });

  it('rates once per press, ignoring held-down key auto-repeat', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');

    // Held-down key: OS auto-repeat keydowns must not arm or rate.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('赤い:あかい');

    // A fresh chord rates exactly once.
    chord('1', 'm');
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
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

    chord('3', 'm');
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

    chord('3', 'm');
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

  it('a draft cannot carry through filter reselection of the same word', async () => {
    // One eligible word: a filter reselection re-presents the SAME word, so the
    // RatingMatrix resetKey must bump per presentation — otherwise the stale
    // missed draft from before the filter change would submit after it.
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal, then draft a non-fluent (missed) meaning — profile mode drafts only.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // Filter reselection rebuilds the pool and re-presents the same word.
    container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle')!.click();
    await Promise.resolve();
    container.querySelector<HTMLButtonElement>('.mock-filter-clear')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).toContain('赤い:あかい');

    // Reveal + submit: the stale missed draft must NOT carry through — the clean
    // default fluent observation is emitted exactly once, and nothing missed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    const meaningFluentCalls = mockRecordAttempt.mock.calls.filter(
      (c) => c[0] === '赤い' && c[1] === 'meaning' && c[2] === 'fluent',
    );
    expect(meaningFluentCalls).toHaveLength(1);
    expect(mockRecordAttempt.mock.calls.some((c) => c[2] === 'missed')).toBe(false);
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('requires confirmation before starting over', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = render(() => <WordSyncContent />, container);
    await Promise.resolve();
    await Promise.resolve();

    chord('3', 'm');
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
