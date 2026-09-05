// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createEffect, createSignal, Show } from 'solid-js';
import type { Component, JSX } from 'solid-js';

const mockGetComprehensiveWordStatusWithSourceSync = vi.fn((): { status: string; source: string; timesSeen: number; ease?: number } => ({
  status: 'unknown',
  source: 'None',
  timesSeen: 0,
}));
const mockClearAllWordSyncSeen = vi.fn();
const mockSetWordKnowledgeEase = vi.fn();
const mockSetAspectStatus = vi.fn();
const mockRecordAttempt = vi.fn((..._callArgs: unknown[]) => ({ attemptId: 'attempt-sync-1' }));
const mockShowToast = vi.hoisted(() => vi.fn());
const isReadingScriptTextFn = vi.hoisted(() => vi.fn((_surface?: unknown, _data?: unknown) => false));
const mockMarkWordSyncSeen = vi.fn();
const mockRestoreWordSyncRating = vi.fn();
const mockAppendRetractions = vi.fn();
const mockRecomputeProjection = vi.fn(async () => {});
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
  levelNames: { 5: 'N5' } as Record<string, string>,
  wordFrequency: {
    '赤い': {
      reading: 'あかい',
      raw_level: 5,
      level: 'N5',
    },
  } as Record<string, { reading: string; raw_level: number; level: string }>,
  wordSyncSeen: {} as Record<string, number>,
  getWordTrackingSync: vi.fn((_word: string, _language?: string): { tracker: 'anki' | 'flashcards' | 'nothing' } => ({ tracker: 'nothing' })),
  knownUntracked: {} as Record<string, unknown>,
  ignoredWords: {} as Record<string, unknown>,
  wordKnowledge: {} as Record<string, { word: string; [key: string]: unknown }>,
  currentLangData: null as { textProcessing?: { readingAnnotation?: boolean }; prosody?: { type?: string } } | null,
  getCanonicalFormForLanguage: vi.fn((_language: string, word: string) => word),
}));

function filterTokenShapes(tokens: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return tokens.map(({ instanceId: _ignored, ...rest }) => rest);
}

const mockCommonState = vi.hoisted(() => ({
  filterBuilderProps: null as {
    tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>;
    onChange: (tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>) => void;
  } | null,
  defaultPreset: [
    {
      instanceId: 'default-status-untracked',
      kind: 'operand',
      field: 'status',
      op: 'eq',
      value: 'untracked',
    },
    {
      instanceId: 'default-recency-and',
      kind: 'operator',
      op: 'AND',
    },
    {
      instanceId: 'default-recency-not-recent',
      kind: 'operand',
      field: 'recency',
      op: 'eq',
      value: 'false',
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
    getFreqLevelNames: () => mockWordSyncState.levelNames,
    isLoading: () => false,
    wordFrequency: mockWordSyncState.wordFrequency,
    getWordFrequency: () => mockWordSyncState.wordFrequency,
    getCanonicalForm: (word: string) => word,
    getWordVariants: (word: string) => [word],
    getCanonicalFormForLanguage: mockWordSyncState.getCanonicalFormForLanguage,
  }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getWordTrackingSync: mockWordSyncState.getWordTrackingSync,
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
    appendRetractions: mockAppendRetractions,
    recomputeWordKnowledgeFromEvidence: mockRecomputeProjection,
    getWordKnowledge: vi.fn(() => null),
    getAspectStatus: () => ({ status: 'unknown' as const, ease: 0, source: 'None', untracked: true }),
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
  // Real WordSyncRating: rating tests exercise the actual input controller
  // (its Button/KeyboardShortcut primitives come from the real barrel exports).
  Button: actual.Button,
  KeyboardShortcut: actual.KeyboardShortcut,
  KnowledgeSkeleton: actual.KnowledgeSkeleton,
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
    // Integer-like object keys iterate numerically ascending, so fixtures
    // written N5→N3 arrive as [3,4,5]. Production sorts ascending difficulty
    // (easiest first); mirror that with highest raw_level first.
    sortFrequencyLevelsByDifficulty: (levels: number[]) => [...levels].sort((a, b) => b - a),
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

  // Whole-word collapsed keys (1/2/3/4) rate EVERY tested aspect at one quality
  // and submit immediately; mnemonic chords (digit + aspect letter) draft
  // per-aspect and auto-submit only when the last draft completes the profile.
  const press = (key: string, init: KeyboardEventInit = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
  };

  // The mocked t() renders locale keys verbatim, so controls are located by
  // their label key rather than implementation classes.
  const buttonByText = (text: string): HTMLButtonElement => {
    const el = Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(text));
    if (!el) throw new Error(`button not found: ${text}`);
    return el;
  };

  // Row cells in column order (Missed, Struggled, Fluent, Easy): a row wraps
  // its aspect label and the four quality cell buttons.
  const rowCells = (labelKey: string): HTMLButtonElement[] => {
    const label = Array.from(container.querySelectorAll<HTMLElement>('.word-sync-actions *'))
      .filter((el) => el.childElementCount === 0 && (el.textContent ?? '').includes(labelKey))
      .pop();
    if (!label) throw new Error(`row label not found: ${labelKey}`);
    let row: HTMLElement | null = label;
    while (row && row.querySelectorAll('button').length < 4) row = row.parentElement;
    if (!row) throw new Error(`row container not found for: ${labelKey}`);
    return Array.from(row.querySelectorAll('button'));
  };

  const attemptIdOf = (callIndex: number): string =>
    ((mockRecordAttempt.mock.calls[callIndex]?.[3] as { attemptId?: string } | undefined)?.attemptId ?? '');
  const allAttemptIds = (): Set<string> =>
    new Set(mockRecordAttempt.mock.calls.map((call) => ((call[3] as { attemptId?: string } | undefined)?.attemptId ?? '')));

  // Dispose-robust cleanup: a failing assertion must never leak a mounted
  // WordSyncContent — its window keydown listener would swallow the next
  // test's Space/Enter reveal (stopImmediatePropagation) and cascade failures
  // far from the real cause.
  const disposals: Array<() => void> = [];
  const mountContent = (Component: Component): (() => void) => {
    const dispose = render(() => <Component />, container);
    disposals.push(dispose);
    return dispose;
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockGetComprehensiveWordStatusWithSourceSync.mockClear();
    mockWordSyncState.settings.language = 'ja';
    mockWordSyncState.settings.use_anki = false;
    mockWordSyncState.levelNames = { 5: 'N5' };
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
    mockWordSyncState.getWordTrackingSync.mockReset();
    mockWordSyncState.getWordTrackingSync.mockImplementation(() => ({ tracker: 'nothing' as const }));
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
    mockAppendRetractions.mockClear();
    mockRecomputeProjection.mockClear();
    mockWordSyncState.currentLangData = null;
    isReadingScriptTextFn.mockImplementation(() => false);
    mockFetchTranslation.mockReset();
    mockFetchTranslation.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    while (disposals.length) disposals.pop()!();
    container.remove();
  });

  it('a whole-word keypress records one attempt per tested aspect and advances exactly once', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();
    // weightedShuffle intentionally randomizes pool order — key assertions on
    // the presented word, never a specific one.
    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';

    press(' ');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    await Promise.resolve();

    // Every tested aspect is recorded under ONE shared attemptId — a single
    // logical attempt, not N independent ratings.
    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'meaning', 'fluent', expect.objectContaining({ language: 'ja', origin: 'word-sync' }));
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'reading', 'fluent', expect.objectContaining({ language: 'ja' }));
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'orthography', 'fluent', expect.objectContaining({ language: 'ja' }));
    expect(allAttemptIds().size).toBe(1);

    expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    expect(mockMarkWordSyncSeen).not.toHaveBeenCalled();

    // The second word consumes the last advance → finished.
    press(' ');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    // Two whole-word attempts → two distinct attemptIds.
    expect(mockRecordAttempt).toHaveBeenCalledTimes(6);
    expect(allAttemptIds().size).toBe(2);
    dispose();
  });

  it('whole-word Easy records fluent evidence and drops the scheduler preference', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    press(' ');
    await Promise.resolve();
    press('4');
    await Promise.resolve();

    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
    const call = mockRecordAttempt.mock.calls[0]!;
    expect(call[0]).toBe('赤い');
    expect(call[1]).toBe('meaning');
    // Easy is NOT a third evidence level: the recorded quality is fluent…
    expect(call[2]).toBe('fluent');
    // …and the scheduler preference never reaches Word Sync's evidence store.
    expect((call[3] as { easy?: boolean }).easy).toBeUndefined();
    dispose();
  });

  it('Adjust flow: an All-row click fills unresolved aspects and submits the mixed profile immediately', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();
    // weightedShuffle intentionally randomizes pool order — key assertions on
    // the presented word, never a specific one.
    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';
    const secondShown = firstShown === '赤い' ? '青い' : '赤い';

    press(' ');
    await Promise.resolve();
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();

    // Explicit draft: meaning missed. Nothing is emitted yet.
    rowCells('mlearn.Knowledge.Aspect.Meaning')[0]!.click();
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // The All row's Fluent cell fills the UNDRAFTED aspects (reading,
    // orthography) and completes the word — submit happens on the click, with
    // no further input.
    rowCells('mlearn.WordSync.Rating.AllRow')[2]!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'meaning', 'missed', expect.anything());
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'reading', 'fluent', expect.anything());
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'orthography', 'fluent', expect.anything());
    expect(allAttemptIds().size).toBe(1);
    expect(mockMarkWordSyncSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkWordSyncSeen).toHaveBeenCalledWith(firstShown, 'ja');
    expect(container.textContent).toContain(secondShown === '赤い' ? '赤い:あかい' : '青い:あおい');
    dispose();
  });

  it('sampling follows the worst aspect: fluent moves harder, missed moves easier', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.levelNames = { 5: 'N5', 4: 'N4', 3: 'N3' };
    // Three words per the starting level: whichever one weightedShuffle
    // surfaces first, the assertions below key on LEVEL membership, not a
    // specific word.
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      'ゆき': { reading: 'ゆき', raw_level: 5, level: 'N5' },
      'ねこ': { reading: 'ねこ', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 4, level: 'N4' },
      'みどり': { reading: 'みどり', raw_level: 4, level: 'N4' },
      'さくら': { reading: 'さくら', raw_level: 3, level: 'N3' },
      'もも': { reading: 'もも', raw_level: 3, level: 'N3' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Whole-word fluent on the presented N5 word → sampling moves one level
    // HARDER: pickNext starts at the NEW level, so an N4 word must appear. A
    // stuck level would start at N5 again (two words still wait there).
    press(' ');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    await Promise.resolve();
    expect(['あおい', 'みどり'].some((reading) => container.textContent!.includes(reading))).toBe(true);
    // A wrong-direction move would surface an N3 word.
    expect(container.textContent).not.toContain('さくら');
    expect(container.textContent).not.toContain('もも');

    // Whole-word missed on the N4 word → sampling moves one level EASIER: one
    // of the two waiting N5 words is presented. A stuck level would present
    // the remaining N4 word; a wrong-direction move an N3 word.
    press(' ');
    await Promise.resolve();
    press('1');
    await Promise.resolve();
    await Promise.resolve();
    expect(['あかい', 'ゆき', 'ねこ'].some((reading) => container.textContent!.includes(reading))).toBe(true);
    expect(container.textContent).not.toContain('あおい');
    expect(container.textContent).not.toContain('みどり');
    expect(container.textContent).not.toContain('さくら');
    expect(container.textContent).not.toContain('もも');
    dispose();
  });

  it('a struggled-worst attempt leaves the sampling level unchanged', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.levelNames = { 5: 'N5', 4: 'N4', 3: 'N3' };
    // Three words at the starting level: whichever one weightedShuffle
    // surfaces first, the assertion keys on LEVEL membership.
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      'ゆき': { reading: 'ゆき', raw_level: 5, level: 'N5' },
      'ねこ': { reading: 'ねこ', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 4, level: 'N4' },
      'みどり': { reading: 'みどり', raw_level: 4, level: 'N4' },
      'さくら': { reading: 'さくら', raw_level: 3, level: 'N3' },
      'もも': { reading: 'もも', raw_level: 3, level: 'N3' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Worst (and only) quality struggled → the level stays put: pickNext
    // starts at N5 again and presents one of its two remaining words. A
    // wrongly moved level would surface an N4 or N3 word instead.
    press(' ');
    await Promise.resolve();
    press('2');
    await Promise.resolve();
    await Promise.resolve();
    expect(['あかい', 'ゆき', 'ねこ'].some((reading) => container.textContent!.includes(reading))).toBe(true);
    expect(container.textContent).not.toContain('あおい');
    expect(container.textContent).not.toContain('みどり');
    expect(container.textContent).not.toContain('さくら');
    expect(container.textContent).not.toContain('もも');
    dispose();
  });

  it('manual completion auto-submits exactly once and extra keystrokes do not resubmit', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();
    // weightedShuffle intentionally randomizes pool order.
    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';

    press(' ');
    await Promise.resolve();
    // Chords draft only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();

    // Partial profiles NEVER submit: one and two drafts record nothing.
    press('1');
    await Promise.resolve();
    press('m');
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    press('3');
    await Promise.resolve();
    press('r');
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // The final draft completes the profile → exactly one submit.
    press('3');
    await Promise.resolve();
    press('o');
    await Promise.resolve();
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(allAttemptIds().size).toBe(1);
    expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');

    // The presentation is over: extra keystrokes arm nothing and must not
    // race a second submit through.
    press('1');
    await Promise.resolve();
    press('m');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    dispose();
  });

  it('undo after a whole-word rating retracts the attempt and re-presents the same word', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    press(' ');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    const attemptId = attemptIdOf(0);

    press('z', { metaKey: true });
    await Promise.resolve();
    await Promise.resolve();

    // The attempt's events are retracted and the seen cooldown is rolled back.
    expect(mockAppendRetractions).toHaveBeenCalledTimes(1);
    expect(mockAppendRetractions).toHaveBeenLastCalledWith('赤い', 'ja', [attemptId]);
    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');

    // The re-presented word comes back collapsed…
    expect(buttonByText('mlearn.Rating.Compact.Adjust').getAttribute('aria-expanded')).toBe('false');

    // …and clean: rating it again records a fresh attempt, not a replay.
    press(' ');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(attemptIdOf(1)).not.toBe(attemptId);
    dispose();
  });

  it('undo after a mixed profile restores the seen snapshot and re-presents the word', async () => {
    const { hashWordSync } = await import('../../services/srsAlgorithm');
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordSyncSeen = {
      [`ja:${hashWordSync('赤い')}`]: 1234,
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    press(' ');
    await Promise.resolve();
    // Mixed profile: meaning missed, reading/orthography fluent.
    press('1');
    await Promise.resolve();
    press('m');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    press('r');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    press('o');
    await Promise.resolve();
    const attemptId = attemptIdOf(0);
    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(mockMarkWordSyncSeen).toHaveBeenCalledWith('赤い', 'ja');

    press('z', { metaKey: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockAppendRetractions).toHaveBeenLastCalledWith('赤い', 'ja', [attemptId]);
    expect(mockRestoreWordSyncRating).toHaveBeenCalledWith(
      { [`ja:${hashWordSync('赤い')}`]: 1234 },
      'ja',
    );
    expect(container.textContent).toContain('赤い:あかい');
    dispose();
  });

  it('a reading-script surface offers only Meaning and one collapsed click submits', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    // Pure reading-script surface (もたれる-style): the interaction supplies the
    // segmental reading — only the Meaning row is offered at all.
    isReadingScriptTextFn.mockImplementation(() => true);
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    press(' ');
    await Promise.resolve();
    // Aspect rows are visible only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Reading');
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    // One pointer click on the collapsed Fluent button is a complete attempt.
    buttonByText('mlearn.Rating.Matrix.Fluent').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.anything());
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    isReadingScriptTextFn.mockImplementation(() => false);
    dispose();
  });

  it('records the seen cooldown once per word and not for fluent attempts', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();
    // weightedShuffle intentionally randomizes pool order.
    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';

    // Mixed attempt on the first word carries a miss → seen recorded once.
    press(' ');
    await Promise.resolve();
    // Chords draft only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    press('1');
    await Promise.resolve();
    press('m');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    press('r');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    press('o');
    await Promise.resolve();
    expect(mockMarkWordSyncSeen).toHaveBeenCalledTimes(1);
    expect(mockMarkWordSyncSeen).toHaveBeenNthCalledWith(1, firstShown, 'ja');

    // Fluent whole-word attempt on the second word records no cooldown.
    press(' ');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    await Promise.resolve();
    expect(mockMarkWordSyncSeen).toHaveBeenCalledTimes(1);
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    const initialCanonicalizations = mockWordSyncState.getCanonicalFormForLanguage.mock.calls.length;

    // Whole-word fluent keypress — the pool must not rebuild.
    press(' ');
    await Promise.resolve();
    press('3');
    await Promise.resolve();
    await Promise.resolve();

    // Pool order is shuffled — either word may surface first.
    expect(mockRecordAttempt).toHaveBeenCalledWith(expect.any(String), 'meaning', 'fluent', expect.objectContaining({ language: 'ja' }));
    expect(mockWordSyncState.getCanonicalFormForLanguage.mock.calls.length).toBe(initialCanonicalizations);
    dispose();
  });

  it('excludes words tracked by another scheduler (Anki/SRS) from the calibration pool', async () => {
    // Tier-2: the pool calibrates UNTRACKED words. A word scheduled elsewhere
    // (tracker !== 'nothing') never enters the pool even though the evidence
    // journal has no entry for it — tracking is policy, not knowledge.
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    mockWordSyncState.getWordTrackingSync.mockImplementation((word: string) => (
      word === '赤い' ? { tracker: 'anki' as const } : { tracker: 'nothing' as const }
    ));
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The only eligible word is 青い; 赤い must be skipped entirely.
    expect(container.textContent).toContain('青い');
    expect(container.textContent).not.toContain('赤い');
    dispose();
  });

  it('reveals then toggles the current word translation with T', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
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

  it('Space reveals the answer and a whole-word Fluent keypress submits it', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Prompt first: the answer stays hidden.
    expect(container.textContent).not.toContain('red');

    // First Space reveals the answer; nothing is rated yet.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    expect(container.textContent).toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // A whole-word Fluent keypress is a complete attempt on its own.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('pointer reveal via the translation control arms the rating control and shows the translation', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Prompt first: translation hidden, nothing rated.
    expect(container.textContent).not.toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // A pointer user clicks the visible translation/reveal control.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();

    // Same revealed-and-ratable state as the first Space: translation shown,
    // and a whole-word keypress submits.
    expect(container.textContent).toContain('red');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('Enter reveals the answer and a whole-word Fluent keypress submits it', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).not.toContain('red');

    // First Enter reveals the answer.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    expect(container.textContent).toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Manually toggle the translation on the first card (pointer reveal).
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();
    expect(container.textContent).toContain('definition');

    // Submit → the next word is presented with translation hidden, even though
    // the prior card's translation was manually toggled.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).not.toContain('definition');
    dispose();
  });

  it('hides a manually-toggled translation on restart', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Manually toggle the translation on, then reveal and submit → finished.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Manually toggle the translation on, then reveal and submit → finished.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // A chord before reveal writes nothing — the control is not armed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // Now the answer is revealed; the same chord completes the single-aspect
    // profile and submits it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal and submit the first word.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal and submit → finished.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal + submit → finished.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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

    const dispose = mountContent(WordSyncContent);
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The displayed reading follows the dictionary entry, not the freq primary.
    expect(container.textContent).toContain('赤い:あか');
    expect(container.textContent).not.toContain('赤い:あかい');

    // Rating stores the displayed (dictionary) reading so the word DB pairs it
    // with the same definition.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledWith(
      { [`ja:${hashWordSync('赤い')}`]: 1234 },
      'ja',
    );
    expect(container.textContent).toContain('赤い:あかい');
    dispose();
  });

  it('Cmd+Z still works when a collapsed rating button holds focus', async () => {
    // Two words: one click-rating must not finish the session — the collapsed
    // bar has to stay mounted for the undo dispatch to bubble.
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal the answer first (Space), then submit via the collapsed Fluent
    // button. The undo shortcut must work when dispatched FROM a rating
    // button — the button target must not swallow it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    buttonByText('mlearn.Rating.Matrix.Fluent').click();
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalled();

    buttonByText('mlearn.Rating.Matrix.Fluent')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('a lone quality key arms a chord and writes nothing until the profile completes', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal the answer before rating.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    // Chords draft only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();

    // Pending chord: nothing recorded, hint visible.
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.querySelector('.word-sync-rating__col--pending')).not.toBeNull();

    // Meaning completion only DRAFTS — a partial profile emits nothing.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('赤い');

    // Completing the remaining aspects is the submit boundary.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('a reading-script surface supplies the reading: only the Meaning row is offered', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    // Pure reading-script surface (もたれる-style): the interaction supplies the
    // segmental reading — the control must not offer a Reading row at all.
    isReadingScriptTextFn.mockImplementation(() => true);
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    // Aspect rows are visible only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Meaning');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Aspect.Reading');
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    // Meaning missed on the kana surface: whole-word missed keypress.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    isReadingScriptTextFn.mockImplementation(() => false);
    dispose();
  });

  it('a non-reading-transparent surface offers the Written-form row (1+O)', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Draft orthography missed, then complete the profile.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    // Chords draft only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    expect(container.textContent).toContain('mlearn.Knowledge.Aspect.Orthography');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    // Chords draft only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await Promise.resolve();

    // Profile submit: reading missed (explicit), other tested aspects fluent
    // (confirmed), one shared attemptId, encounter marked on the miss.
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'reading', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'meaning', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    const attemptIds = new Set(mockRecordAttempt.mock.calls.map((call) => (call[3] as { attemptId?: string })?.attemptId));
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

    const dispose = mountContent(WordSyncContent);
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal first so the control is armed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    // Chords arm only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await Promise.resolve();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'reading', 'missed', expect.anything());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledWith(
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Pool order within a level is shuffled, so detect which word came up first.
    const firstWord = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';
    const secondWord = firstWord === '赤い' ? '青い' : '赤い';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(1);
    expect(mockRestoreWordSyncRating).toHaveBeenLastCalledWith(
      { [`ja:${hashWordSync(secondWord)}`]: undefined },
      'ja',
    );
    expect(container.textContent).toContain(`${secondWord}:`);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await Promise.resolve();

    expect(mockRestoreWordSyncRating).toHaveBeenCalledTimes(2);
    expect(mockRestoreWordSyncRating).toHaveBeenLastCalledWith(
      { [`ja:${hashWordSync(firstWord)}`]: undefined },
      'ja',
    );
    expect(container.textContent).toContain(`${firstWord}:`);

    dispose();
  });

  it('rates once per press, ignoring held-down key auto-repeat', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    expect(container.textContent).toContain('赤い:あかい');

    // Held-down key: OS auto-repeat keydowns must not arm or rate.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('赤い:あかい');

    // A fresh chord completes the single-aspect profile and rates exactly once.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();

    expect(container.textContent).not.toContain('يكتب');
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    dispose();
  });

  it('restores the default word sync filter when starting over after confirmation', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // When the filter dropdown is opened (closed by default)
    container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle')?.click();
    await Promise.resolve();
    await Promise.resolve();

    // instanceIds are regenerated per preset build — compare token shapes only.
    expect(filterTokenShapes(mockCommonState.filterBuilderProps?.tokens ?? [])).toEqual([
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'AND' },
      { kind: 'operand', field: 'recency', op: 'eq', value: 'false' },
    ]);

    container.querySelector<HTMLButtonElement>('.mock-filter-clear')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCommonState.filterBuilderProps?.tokens).toEqual([]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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

    // instanceIds are regenerated per preset build — compare token shapes only.
    expect(filterTokenShapes(mockCommonState.filterBuilderProps?.tokens ?? [])).toEqual([
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'AND' },
      { kind: 'operand', field: 'recency', op: 'eq', value: 'false' },
    ]);
    expect(mockCommonState.buildWordSyncPreset).toHaveBeenCalledTimes(2);
    expect(mockClearAllWordSyncSeen).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('keeps the filter available on the finished screen', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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
    // rating control's resetKey must bump per presentation — otherwise the
    // stale missed draft from before the filter change would submit after it.
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    // Reveal, then draft a non-fluent (missed) meaning — a partial profile
    // drafts only.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    // Chords draft only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await Promise.resolve();
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

    // Reveal: a stale missed meaning draft would complete the profile the
    // moment ANY other aspect is drafted and submit immediately — it must not.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    // The re-presented control starts collapsed; chords need the unfold again.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // …and the second completion still leaves meaning UNDRAFTED: no submit.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    await Promise.resolve();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // Drafting meaning fluent completes the profile exactly once, all-fluent.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
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

    const dispose = mountContent(WordSyncContent);
    await Promise.resolve();
    await Promise.resolve();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
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
