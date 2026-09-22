vi.mock('../../context', async () => {
  return {
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useLocalization: () => ({ t: (key: string, params?: Record<string, string>) => params?.rated !== undefined ? `${params.rated} / ${params.total}` : key }),
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
    getWordVariantsForLanguage: mockWordSyncState.getWordVariantsForLanguage,
  }),
  useOptionalGraph: () => ({
    // Mirrors the real no-provider fallback: readiness never 'ready', so the
    // character-components resource short-circuits to [].
    readiness: () => 'unavailable' as const,
    lookupWord: async () => null,
    getRelated: async () => [],
  }),
  useFlashcards: () => ({
    isKnowledgeReady: () => true,
    getCardByWordSync: mockWordSyncState.getCardByWordSync,
    isLoading: () => false,
    store: {
      wordKnowledge: mockWordSyncState.wordKnowledge,
      knownUntracked: mockWordSyncState.knownUntracked,
      ignoredWords: mockWordSyncState.ignoredWords,
      wordToCardMap: {},
      flashcards: {},
    },
    setAccessClaim: mockSetAccessClaim,
    setWordClaim: mockSetWordClaim,
    clearAccessClaim: mockClearAccessClaim,
    recordAttempt: mockRecordAttempt,
    appendRetractions: mockAppendRetractions,
    recomputeWordKnowledgeFromEvidence: mockRecomputeProjection,
    getWordKnowledge: mockGetWordKnowledge,
    getAccessStatus: mockGetAccessStatus,
    getComprehensiveWordStatusWithSourceSync: mockGetComprehensiveWordStatusWithSourceSync,
  }),
  };
});
// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render } from 'solid-js/web';
import { createEffect, createSignal, Show } from 'solid-js';
import type { Component, JSX } from 'solid-js';
import type { LLMStreamCallbacks } from '../../services/llmProvider';
import type { AccessStatusResult } from '../../utils/accessKnowledge';
import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import type { WordStatus } from '../../../shared/constants';

let absentProjectionWords = new Set<string>();
const mockStreamChat = vi.hoisted(() => vi.fn());
const mockRetryKnowledgeProjection = vi.hoisted(() => vi.fn());
const mockQueryLanguageKeys = vi.hoisted(() => vi.fn());
vi.mock('../../services/llmProvider', () => ({ streamChat: mockStreamChat }));
vi.mock('../../services/knowledgeEvents', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/knowledgeEvents')>();
  return {
    ...original,
    // Journal-key snapshot for the F-N1 request bound (production
    // `queryLanguageKeys` → bridge): the fixture's measured words are the
    // store rows plus the per-word projection fixture, so the bounded
    // request covers exactly the surfaces that carry evidence.
    queryLanguageKeys: mockQueryLanguageKeys,
  };
});

const mockGetComprehensiveWordStatusWithSourceSync = vi.fn((): { status: string; source: string; timesSeen: number; ease?: number } => ({
  status: 'unknown',
  source: 'None',
  timesSeen: 0,
}));
const mockSetAccessClaim = vi.fn();
const mockSetWordClaim = vi.fn();
const mockClearAccessClaim = vi.fn();
const mockGetAccessStatus = vi.fn((_word?: string, _capability?: string): AccessStatusResult => ({ status: 'unknown', ease: 0, source: 'None', untracked: true }));
// Configurable per test: pool-eligibility reads (written-form bridge, bridge
// candidates) go through getWordKnowledge.
const mockGetWordKnowledge = vi.fn((): {
  word: string;
  ease?: number;
  access?: Partial<Record<string, { status?: string; claim?: string }>>;
} | undefined => undefined);
const mockRecordAttempt = vi.fn((..._callArgs: unknown[]) => ({ attemptId: 'attempt-sync-1' }));
const mockShowToast = vi.hoisted(() => vi.fn());
const isReadingScriptTextFn = vi.hoisted(() => vi.fn((_surface?: unknown, _data?: unknown) => false));
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
  },
  levelNames: { 5: 'N5' } as Record<string, string>,
  wordFrequency: {
    '赤い': {
      reading: 'あかい',
      raw_level: 5,
      level: 'N5',
    },
  } as Record<string, { reading: string; raw_level: number; level: string }>,
  getCardByWordSync: vi.fn((_word: string, _language?: string): { id: string } | null => null),
  knownUntracked: {} as Record<string, unknown>,
  ignoredWords: {} as Record<string, unknown>,
  wordKnowledge: {} as Record<string, { word: string; [key: string]: unknown }>,
  projection: undefined as KnowledgeProjection | undefined,
  collectionReady: (): boolean => true,
  projectionByWord: new Map<string, KnowledgeProjection>(),
  capabilities: ['sense-recognition', 'surface-reading', 'prosodic-pattern'],
  collectionFailed: (): boolean => false,
  currentLangData: null as { textProcessing?: { readingAnnotation?: boolean }; prosody?: { type?: string } } | null,
  getCanonicalFormForLanguage: vi.fn((_language: string, word: string) => word),
  getWordVariantsForLanguage: vi.fn((_language: string, word: string) => [word]),
  /** Surfaces whose ENCOUNTER projection is genuinely absent (the unmeasured
   *  shape); distinct from the batched-scan seam so the single-surface hook
   *  can return undefined for exactly these words. */
  encounterAbsentWords: new Set<string>(),
  /** Controllable loading accessor for the single-surface hook (null = the
   *  hook always reports settled). */
  encounterLoading: null as null | (() => boolean),
}));

function filterTokenShapes(tokens: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return tokens.map(({ instanceId: _ignored, ...rest }) => rest);
}

const mockCommonState = vi.hoisted(() => ({
  filterBuilderProps: null as {
    tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>;
    onChange: (tokens: Array<{ kind: string; field?: string; op?: string; value?: string }>) => void;
  } | null,
  defaultPreset: [] as Array<{ instanceId: string; kind: string; field?: string; op?: string; value?: string }>,
  buildWordSyncPreset: vi.fn(),
}));

mockCommonState.buildWordSyncPreset.mockImplementation(() => (
  mockCommonState.defaultPreset.map((token) => ({ ...token }))
));

vi.mock('../../hooks/useKnowledgeProjection', () => ({
  useKnowledgeProjection: (query?: () => { surface: string } | undefined) => ({
    projection: () => {
      const surface = query?.()?.surface ?? '';
      // Genuinely absent surface (unmeasured shape, F-N1): the hook resolved
      // and found nothing — undefined, not an error.
      if (mockWordSyncState.encounterAbsentWords.has(surface)) return undefined;
      return mockWordSyncState.projectionByWord.get(surface) ?? mockWordSyncState.projection ?? ({
      status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'test-surface' },
        applicableCapabilities: mockWordSyncState.capabilities,
        states: mockWordSyncState.capabilities.map(capability => {
          const access = mockGetAccessStatus('', capability);
          return { capability, classification: access.claim ?? (access.untracked ? 'unmeasured' : access.status), basis: access.claim ? 'claim' : access.untracked ? 'unmeasured' : 'evidence', evidence: [], evidenceSourceCounts: {} };
        }),
      }],
    });
    },
    loading: () => mockWordSyncState.encounterLoading?.() ?? false,
    capabilities: () => mockWordSyncState.capabilities,
  }),
}));

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
  buildWordSyncFields: () => ({ fields: ['level', 'status'].map(field => ({ field, resolver: { read: (record: Record<string, unknown>) => record[field], valueLabel: (value: unknown) => value } })), paletteItems: [] }),
  buildWordSyncPreset: mockCommonState.buildWordSyncPreset,
  evaluateAst: actual.evaluateAst,
  parseTokens: actual.parseTokens,
  validateTokens: actual.validateTokens,
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
  refreshAnkiWordsCache: vi.fn(async () => undefined),
  isAnkiCacheFetched: vi.fn(() => true),
  ankiCacheVersion: vi.fn(() => 0),
}));

vi.mock('../../../shared/languageFeatures', async () => {
  // getAvailableAccesses is pure and unmocked — safe to import inside the factory.
  const { getAvailableAccesses } = await import('../../../shared/types');
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
    // Scaffold snapshot: fixtures present no furigana annotation, so no
    // reading scaffold is recorded and measured rows stay the tested set.
    wordNeedsReadingAnnotation: vi.fn(() => false),
    // Faithful mirror of the shared tested/supplied gate, wired to the MOCKED
    // isReadingScriptText (the real module's internal binding would bypass this mock).
    getTestedAccesses: vi.fn(({ languageData, surface, hasReadingData, hasProsodyData }: {
      languageData?: unknown; surface: string; hasReadingData: boolean; hasProsodyData: boolean;
    }) => {
      const available = getAvailableAccesses(languageData as never);
      const supplies = isReadingScriptTextFn(surface, languageData as never);
      const accesses: string[] = ['sense-recognition'];
      if (available.includes('surface-reading') && hasReadingData && !supplies) accesses.push('surface-reading');
      if (available.includes('prosodic-pattern') && hasProsodyData) accesses.push('prosodic-pattern');
      if (surface.trim()) accesses.push('surface-recognition');
      return accesses;
    }),
  };
});

vi.mock('../../../shared/languageScriptProfile', () => ({
  hasLettersInAnyScript: () => false,
}));

// Resolve the projection and dictionary promises before interacting with a probe.
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('WordSyncContent', () => {
  let container: HTMLDivElement;

  // Digits record one selected observed outcome after reveal.
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
    mockWordSyncState.knownUntracked = {};
    mockWordSyncState.ignoredWords = {};
    mockWordSyncState.wordKnowledge = {};
    absentProjectionWords = new Set<string>();
    mockWordSyncState.encounterAbsentWords = new Set<string>();
    mockWordSyncState.encounterLoading = null;
    mockWordSyncState.getCanonicalFormForLanguage.mockReset();
    mockWordSyncState.getWordVariantsForLanguage.mockReset();
    mockWordSyncState.getWordVariantsForLanguage.mockImplementation((_language: string, word: string) => [word]);
    mockWordSyncState.getCardByWordSync.mockReset();
    mockWordSyncState.getCardByWordSync.mockImplementation(() => null);
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((_language: string, word: string) => word);
    mockCommonState.filterBuilderProps = null;
    mockCommonState.defaultPreset = [];
    mockCommonState.buildWordSyncPreset.mockClear();
    mockSetAccessClaim.mockClear();
    mockSetWordClaim.mockClear();
    mockClearAccessClaim.mockClear();
    mockGetAccessStatus.mockClear();
    mockGetWordKnowledge.mockReset();
    mockGetWordKnowledge.mockImplementation(() => undefined);
    mockRecordAttempt.mockClear();
    mockShowToast.mockClear();
    mockAppendRetractions.mockClear();
    mockRecomputeProjection.mockClear();
    mockWordSyncState.projection = undefined;
  mockWordSyncState.collectionReady = () => true;
  mockWordSyncState.collectionFailed = () => false;
  mockRetryKnowledgeProjection.mockClear();
  mockQueryLanguageKeys.mockReset();
  mockQueryLanguageKeys.mockImplementation(async () => [
    ...Object.keys(mockWordSyncState.wordKnowledge),
    ...mockWordSyncState.projectionByWord.keys(),
  ]);
    mockWordSyncState.projectionByWord = new Map();
    mockGetAccessStatus.mockReset();
    mockGetAccessStatus.mockReturnValue({ status: 'unknown', ease: 0, source: 'None', untracked: true });
    mockWordSyncState.currentLangData = null;
    mockWordSyncState.capabilities = ['sense-recognition', 'surface-reading', 'prosodic-pattern'];
    isReadingScriptTextFn.mockImplementation(() => false);
    mockFetchTranslation.mockReset();
    mockFetchTranslation.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    while (disposals.length) disposals.pop()!();
    container.remove();
  });

  it.skipIf(!process.env.MLEARN_PROJECTION_FIXTURE)('replays saved projections through cold startup, level changes and rapid session ratings', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const fixture = JSON.parse(readFileSync(process.env.MLEARN_PROJECTION_FIXTURE!, 'utf8'));
    mockWordSyncState.wordFrequency = fixture.frequency;
    mockWordSyncState.levelNames = fixture.languageData.frequencyLevels.names;
    mockWordSyncState.currentLangData = fixture.languageData;
    mockWordSyncState.projectionByWord = new Map(Object.entries(fixture.projections));
    const [ready, setReady] = createSignal(false);
    mockWordSyncState.collectionReady = ready;
    const filter = (level: string) => [
      { kind: 'operand', field: 'status', op: 'eq', value: 'untracked' },
      { kind: 'operator', op: 'AND' },
      { kind: 'operand', field: 'level', op: 'eq', value: level },
    ];
    mockCommonState.defaultPreset = filter('2').map((token, index) => ({ ...token, instanceId: String(index) }));
    const logger = await import('../../../shared/utils/logger');
    const records: unknown[] = [];
    logger.setMinLevel('DEBUG');
    logger.setLogSink({ write: record => { if (record.module.endsWith('wordSync')) records.push(record); } });
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle();
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    setReady(true);
    await vi.waitFor(() => expect(container.querySelector('.word-sync-counter')).not.toBeNull());
    const initialCounter = container.querySelector('.word-sync-counter')!.textContent!;
    const total = Number(initialCounter.split('/')[1]);
    expect(total).toBeGreaterThan(5);
    const words = new Set<string>();
    mockRecordAttempt.mockImplementation((value: unknown) => { const word = String(value); words.add(word); setReady(false); return { attemptId: word }; });
    for (let count = 1; count <= 5; count++) {
      press(' '); await settle(); press('3'); await settle(); await settle();
      expect(container.querySelector('.word-sync-counter')?.textContent).toBe(`${count} / ${total}`);
    }
    expect(words.size).toBe(5);
    buttonByText('mlearn.WordSync.Filter').click(); await settle();
    mockCommonState.filterBuilderProps!.onChange(filter('4'));
    await settle();
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    setReady(true);
    await vi.waitFor(() => expect(container.querySelector('.word-sync-counter')).not.toBeNull());
    const n4Counter = container.querySelector('.word-sync-counter')!.textContent!;
    expect(n4Counter).not.toBe(initialCounter);
    writeFileSync('/private/tmp/word-sync-lifecycle-trace.json', JSON.stringify({ initialCounter, n4Counter, distinctRated: [...words], records }, null, 2));
    logger.setMinLevel('INFO'); logger.setLogSink(null);
    mockRecordAttempt.mockImplementation(() => ({ attemptId: 'attempt-sync-1' }));
  });

  it('shows a retry action when the shared projection read fails instead of keeping the skeleton', async () => {
    mockWordSyncState.collectionReady = () => false;
    mockWordSyncState.collectionFailed = () => true;
    const { WordSyncContent } = await import('./App');

    mountContent(WordSyncContent);
    await settle();

    expect(container.textContent).toContain('mlearn.WordSync.ProjectionUnavailable');
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('mlearn.Global.Retry'));
    expect(retry).toBeDefined();
    retry!.click();
    expect(mockRetryKnowledgeProjection).toHaveBeenCalledTimes(1);
  });

  it('retries a failed journal snapshot from the Word Sync error state', async () => {
    mockQueryLanguageKeys
      .mockRejectedValueOnce(new Error('temporary journal read failure'))
      .mockResolvedValueOnce([]);
    const { WordSyncContent } = await import('./App');

    mountContent(WordSyncContent);
    await settle();
    await vi.waitFor(() => expect(container.textContent).toContain('mlearn.WordSync.ProjectionUnavailable'));

    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('mlearn.Global.Retry'));
    expect(retry).toBeDefined();
    retry!.click();
    await vi.waitFor(() => expect(mockQueryLanguageKeys).toHaveBeenCalledTimes(2));
    await settle();
    expect(container.textContent).not.toContain('mlearn.WordSync.ProjectionUnavailable');
  });

  it('waits for the accelerator, then keeps a fixed queue while rating invalidates its live reader', async () => {
    const [ready, setReady] = createSignal(false);
    mockWordSyncState.collectionReady = ready;
    mockWordSyncState.wordFrequency = Object.fromEntries(['one', 'two', 'three', 'four'].map(word => [word, { reading: word, raw_level: 5, level: 'N5' }]));
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    expect(mockFetchTranslation).not.toHaveBeenCalled();
    setReady(true);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 4');
    const seen = new Set<string>();
    mockRecordAttempt.mockImplementation((value: unknown) => { const word = String(value); seen.add(word); setReady(false); return { attemptId: word }; });
    for (let count = 1; count <= 4; count++) {
      press(' '); await settle(); press('3'); await settle(); await settle();
      expect(container.querySelector('.word-sync-counter')?.textContent).toBe(`${count} / 4`);
    }
    expect(seen.size).toBe(4);
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    mockRecordAttempt.mockReset();
  });

  it('rejects a delayed candidate scan from the previous filter scope', async () => {
    mockWordSyncState.wordFrequency = {
      first: { reading: 'first', raw_level: 4, level: 'N4' },
      second: { reading: 'second', raw_level: 2, level: 'N2' },
      third: { reading: 'third', raw_level: 2, level: 'N2' },
    };
    mockWordSyncState.levelNames = { 4: 'N4', 2: 'N2' };
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    buttonByText('mlearn.WordSync.Filter').click(); await settle();
    const change = mockCommonState.filterBuilderProps!.onChange;
    let resolveOld!: (value: Awaited<ReturnType<typeof mockFetchTranslation>>) => void;
    mockFetchTranslation.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    change([{ kind: 'operand', field: 'level', op: 'eq', value: '4' }]);
    await settle();
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    change([{ kind: 'operand', field: 'level', op: 'eq', value: '2' }]);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');
    resolveOld({ data: [] }); await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');
    expect(container.textContent).not.toContain('first:first');
  });

  it('counts the filtered probe universe and resets progress when its scope changes', async () => {
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 2, level: 'N2' },
    };
    mockWordSyncState.levelNames = { 5: 'N5', 2: 'N2' };
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');
    buttonByText('mlearn.WordSync.Filter').click();
    await settle();
    mockCommonState.filterBuilderProps!.onChange([{ kind: 'operand', field: 'level', op: 'eq', value: '5' }]);
    await settle(); await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 1');
    expect(container.textContent).toContain('赤い:あかい');
    press(' '); await settle(); press('1'); await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('1 / 1');
    // The miss does not become a recency exclusion when the scope is reopened.
    mockCommonState.filterBuilderProps!.onChange([]);
    await settle(); await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');
    dispose();
  });

  it('flushes one knowledge update for a complete rating, after advancing the word', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.capabilities = ['sense-recognition', 'surface-reading', 'surface-recognition'];
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const [revision, setRevision] = createSignal(0);
    const flushedRevisions: number[] = [];
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(() => {
      createEffect(() => { flushedRevisions.push(revision()); });
      return <WordSyncContent />;
    });
    await settle();
    await settle();
    mockRecordAttempt.mockImplementation(() => {
      setRevision(value => value + 1);
      return { attemptId: 'attempt-sync-1' };
    });
    try {
    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';
      press(' ');
    await settle();
      flushedRevisions.length = 0;
      press('3');
    await settle();
      expect(mockRecordAttempt).toHaveBeenCalledTimes(3);
      expect(flushedRevisions).toEqual([3]);
      expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');
    } finally {
      mockRecordAttempt.mockImplementation(() => ({ attemptId: 'attempt-sync-1' }));
      dispose();
    }
  });

  it('a collapsed whole-word keypress records one logical attempt and advances exactly once', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    // weightedShuffle intentionally randomizes pool order — key assertions on
    // the presented word, never a specific one.

    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';
    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    await settle();

    // The whole-word keypress is one logical attempt over every tested
    // access: one attempt identity, one observation per tested row.
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'sense-recognition', 'fluent', expect.objectContaining({ language: 'ja', origin: 'word-sync' }));
    expect(mockRecordAttempt).toHaveBeenCalledWith(firstShown, 'surface-reading', 'fluent', expect.objectContaining({ language: 'ja', origin: 'word-sync' }));
    expect(allAttemptIds().size).toBe(1);

    expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');

    // The second word consumes the last advance → finished.
    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    // Two whole-word attempts → two distinct attemptIds.
    expect(mockRecordAttempt).toHaveBeenCalledTimes(4);
    expect(allAttemptIds().size).toBe(2);
    dispose();
  });

  it('selected outcome Easy records fluent evidence and drops the scheduler preference', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    press(' ');
    await settle();
    await settle();
    press('4');
    await settle();
    await settle();

    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
    const call = mockRecordAttempt.mock.calls[0]!;
    expect(call[0]).toBe('赤い');
    expect(call[1]).toBe('sense-recognition');
    // Easy is NOT a third evidence level: the recorded quality is fluent…
    expect(call[2]).toBe('fluent');
    // …and the scheduler preference never reaches Word Sync's evidence store.
    expect((call[3] as { easy?: boolean }).easy).toBeUndefined();
    dispose();
  });

  it('sampling follows the worst measured quality: fluent moves harder, missed moves easier', async () => {
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
    await settle();
    await settle();

    // Whole-word fluent on the presented N5 word → sampling moves one level
    // HARDER: pickNext starts at the NEW level, so an N4 word must appear. A
    // stuck level would start at N5 again (two words still wait there).
    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    await settle();
    expect(['あおい', 'みどり'].some((reading) => container.textContent!.includes(reading))).toBe(true);
    // A wrong-direction move would surface an N3 word.
    expect(container.textContent).not.toContain('さくら');
    expect(container.textContent).not.toContain('もも');

    // Whole-word missed on the N4 word → sampling moves one level EASIER: one
    // of the two waiting N5 words is presented. A stuck level would present
    // the remaining N4 word; a wrong-direction move an N3 word.
    press(' ');
    await settle();
    await settle();
    press('1');
    await settle();
    await settle();
    await settle();
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
    await settle();
    await settle();

    // Worst (and only) quality struggled → the level stays put: pickNext
    // starts at N5 again and presents one of its two remaining words. A
    // wrongly moved level would surface an N4 or N3 word instead.
    press(' ');
    await settle();
    await settle();
    press('2');
    await settle();
    await settle();
    await settle();
    expect(['あかい', 'ゆき', 'ねこ'].some((reading) => container.textContent!.includes(reading))).toBe(true);
    expect(container.textContent).not.toContain('あおい');
    expect(container.textContent).not.toContain('みどり');
    expect(container.textContent).not.toContain('さくら');
    expect(container.textContent).not.toContain('もも');
    dispose();
  });

  it('collapsed whole-word rating submits exactly once and extra keystrokes do not resubmit', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    // weightedShuffle intentionally randomizes pool order.

    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';
    press(' ');
    await settle();
    await settle();
    await settle();

    press('1');
    await settle();
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(allAttemptIds().size).toBe(1);
    expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');

    // The presentation is over: extra keystrokes arm nothing and must not
    // race a second submit through.
    press('1');
    await settle();
    await settle();
    press('m');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    dispose();
  });

  it('undo after a selected outcome rating retracts the attempt and re-presents the same word', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    const attemptId = attemptIdOf(0);

    press('z', { metaKey: true });
    await settle();
    await settle();
    await settle();

    // The attempt's events are retracted before re-presenting the probe.
    expect(mockAppendRetractions).toHaveBeenCalledTimes(1);
    expect(mockAppendRetractions).toHaveBeenLastCalledWith('赤い', 'ja', [attemptId]);
    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');

    // The re-presented word comes back collapsed…
    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);

    // …and clean: rating it again records a fresh attempt, not a replay.
    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(attemptIdOf(1)).not.toBe(attemptId);
    dispose();
  });

  it('undo after a missed observation retracts it and re-presents the word', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    press(' ');
    await settle();
    await settle();
    // One miss is recorded; extra keys cannot submit another hidden answer.
    press('1');
    await settle();
    await settle();
    press('m');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    press('r');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    press('w');
    await settle();
    await settle();
    const attemptId = attemptIdOf(0);
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);

    press('z', { metaKey: true });
    await settle();
    await settle();
    await settle();

    expect(mockAppendRetractions).toHaveBeenLastCalledWith('赤い', 'ja', [attemptId]);
    expect(container.textContent).toContain('赤い:あかい');
    dispose();
  });

  it('keeps explicit corrections separate from review without preset capability claims', async () => {
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    press(' ');
    await settle();
    await settle();
    expect(container.textContent).not.toContain('mlearn.WordSync.Statement.MeaningNotForm');
    expect(container.textContent).toContain('mlearn.TellMlearn.Label');
    expect(mockSetWordClaim).not.toHaveBeenCalled();
    expect(mockSetAccessClaim).not.toHaveBeenCalled();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    dispose();
  });

  it('advances after rating the last unclaimed row following a natural-language adjustment', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.capabilities = ['surface-recognition', 'surface-reading', 'prosodic-pattern', 'sense-recognition'];
    mockWordSyncState.wordFrequency = { '水筒': { reading: 'すいとう', raw_level: 2, level: 'N2' } };
    mockWordSyncState.levelNames = { 2: 'N2' };
    const [claims, setClaims] = createSignal<Record<string, WordStatus | undefined>>({});
    mockGetAccessStatus.mockImplementation((_word, capability) => ({ status: 'unknown', ease: 0, source: 'None', untracked: true, claim: claims()[capability!] }));
    mockSetAccessClaim.mockImplementation((_word, capability: string, status: WordStatus) => setClaims(previous => ({ ...previous, [capability]: status })));
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    press(' '); await settle();
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    buttonByText('mlearn.TellMlearn.Label').click();
    const input = container.querySelector<HTMLTextAreaElement>('.tell-mlearn__input')!;
    input.value = "I know すいとう so it's kinda struggled, then I know the prosody, then I actually like the kanji kinda suggested me it but I couldn't have guessed without the reading side by side. When it opened I was like aahhh";
    input.dispatchEvent(new Event('input', { bubbles: true }));
    buttonByText('mlearn.TellMlearn.Send').click();
    // Replay the reported model interpretation, independently of whether that
    // interpretation is accurate: applying claims must not wedge completion.
    const callbacks = mockStreamChat.mock.calls.at(-1)![2] as LLMStreamCallbacks;
    callbacks.onDone('', ['sense-recognition', 'surface-reading', 'prosodic-pattern'].map(capability => ({
      id: capability, name: 'set_access_claim', arguments: { capability, status: capability === 'prosodic-pattern' ? 'known' : 'learning', basis: 'unassisted' },
    })));
    await settle(); await settle();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    const missing = container.querySelector<HTMLButtonElement>('[aria-label="mlearn.Knowledge.Capability.surface-recognition: mlearn.Rating.Matrix.Missed"]')!;
    missing.click(); await settle(); await settle();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
    expect(mockRecordAttempt.mock.calls[0][0]).toBe('水筒');
    expect(mockRecordAttempt.mock.calls[0][1]).toBe('surface-recognition');
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('1 / 1');
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
  });

  it('applies and undoes meaning success and reading failure from the same explanation', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const [claims, setClaims] = createSignal<Record<string, WordStatus | undefined>>({});
    mockGetAccessStatus.mockImplementation((_word, capability) => ({
      status: 'unknown', ease: 0, source: 'None', untracked: true, claim: claims()[capability!],
    }));
    mockSetAccessClaim.mockImplementation((_word, capability: string, status: WordStatus) => {
      setClaims(previous => ({ ...previous, [capability]: status }));
    });
    mockClearAccessClaim.mockImplementation((_word, capability: string) => {
      setClaims(previous => ({ ...previous, [capability]: undefined }));
    });
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    press(' ');
    await settle();
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    buttonByText('mlearn.TellMlearn.Label').click();
    const input = container.querySelector<HTMLTextAreaElement>('.tell-mlearn__input')!;
    input.value = "I can infer the meaning form the kanji, but I didn't get the reading. Kanji -> meaning works, but not kanji -> reading. But reading -> meaning also works";
    input.dispatchEvent(new Event('input', { bubbles: true }));
    buttonByText('mlearn.TellMlearn.Send').click();
    expect(mockStreamChat).toHaveBeenCalledOnce();
    // Exercise the actual parser, application, summary and undo; only the
    // model transport is mocked. Both clauses must reach the claim writer.
    const callbacks = mockStreamChat.mock.calls[0][2] as LLMStreamCallbacks;
    callbacks.onDone('', [
      { id: 'meaning', name: 'set_access_claim', arguments: { capability: 'sense-recognition', status: 'known', basis: 'unassisted' } },
      { id: 'reading', name: 'set_access_claim', arguments: { capability: 'surface-reading', status: 'unknown', basis: 'unassisted' } },
    ]);
    expect(mockSetAccessClaim).toHaveBeenCalledTimes(2);
    expect(mockSetAccessClaim).toHaveBeenCalledWith('赤い', 'sense-recognition', 'known', 'ja');
    expect(mockSetAccessClaim).toHaveBeenCalledWith('赤い', 'surface-reading', 'unknown', 'ja');
    expect(mockSetWordClaim).not.toHaveBeenCalled();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    const summary = container.querySelector('.tell-mlearn__summary')!.textContent;
    expect(summary).toContain('mlearn.Knowledge.Capability.sense-recognition');
    expect(summary).toContain('mlearn.Knowledge.Capability.surface-reading');
    const selected = () => Array.from(container.querySelectorAll('.rating-matrix__cell[aria-pressed="true"]'))
      .map(button => button.getAttribute('aria-label'));
    expect(selected()).toEqual([
      'mlearn.Knowledge.Capability.sense-recognition: mlearn.Rating.Matrix.Fluent',
      'mlearn.Knowledge.Capability.surface-reading: mlearn.Rating.Matrix.Missed',
    ]);
    buttonByText('mlearn.TellMlearn.Undo').click();
    expect(mockClearAccessClaim).toHaveBeenCalledTimes(2);
    expect(mockClearAccessClaim).toHaveBeenCalledWith('赤い', 'sense-recognition', 'ja');
    expect(mockClearAccessClaim).toHaveBeenCalledWith('赤い', 'surface-reading', 'ja');
    expect(selected()).toEqual([]);
    dispose();
  });

  it('a reading-script surface tests meaning and spelling recognition, with one collapsed submission', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    // Pure reading-script surface (もたれる-style): the interaction supplies the
    // segmental reading, but recognizing the displayed spelling is still tested.
    isReadingScriptTextFn.mockImplementation(() => true);
    mockWordSyncState.capabilities = ['sense-recognition', 'surface-reading', 'surface-recognition'];
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    press(' ');
    await settle();
    // Access rows are visible only in the unfolded Adjust state.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await settle();
    expect(container.textContent).toContain('mlearn.Knowledge.Capability.sense-recognition');
    expect(container.textContent).not.toContain('mlearn.Knowledge.Capability.surface-reading');
    expect(container.textContent).toContain('mlearn.Knowledge.Capability.surface-recognition');
    // Folding back turns the column headers into the collapsed quality
    // buttons again — one collapsed Fluent click is a complete attempt.
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await settle();
    buttonByText('mlearn.Rating.Matrix.Fluent').click();
    await settle();
    await settle();

    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.anything());
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'surface-recognition', 'fluent', expect.anything());
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    isReadingScriptTextFn.mockImplementation(() => false);
    dispose();
  });

  it('records each word profile as a separate logical attempt', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    // weightedShuffle intentionally randomizes pool order.

    // Mixed attempt on the first word records its observed outcomes.
    press(' ');
    await settle();
    await settle();
    await settle();
    press('1');
    await settle();
    await settle();
    press('m');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    press('r');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    press('w');
    await settle();
    await settle();

    // The second word records its own fluent observations.
    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    await settle();
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
    await settle();
    await settle();

    const initialCanonicalizations = mockWordSyncState.getCanonicalFormForLanguage.mock.calls.length;

    // Whole-word fluent keypress — the pool must not rebuild.
    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    await settle();

    // Pool order is shuffled — either word may surface first.
    expect(mockRecordAttempt).toHaveBeenCalledWith(expect.any(String), 'sense-recognition', 'fluent', expect.objectContaining({ language: 'ja' }));
    expect(mockWordSyncState.getCanonicalFormForLanguage.mock.calls.length).toBe(initialCanonicalizations);
    dispose();
  });

  it('does not use card existence as knowledge or exclude its unresolved aspects', async () => {
    mockWordSyncState.getCardByWordSync.mockReturnValue({ id: 'existing-review-card' });
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle();
    expect(container.textContent).toContain('赤い');
    expect(mockWordSyncState.getCardByWordSync).not.toHaveBeenCalled();
    expect(mockGetComprehensiveWordStatusWithSourceSync).not.toHaveBeenCalled();
    dispose();
  });

  it('shows only the residual Reading probe and writes only its aspect', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.capabilities = ['sense-recognition', 'surface-reading', 'surface-recognition'];
    mockWordSyncState.projection = {
      status: 'ready', targets: [{ targetRef: { kind: 'surface', id: 'test-surface' },
        applicableCapabilities: mockWordSyncState.capabilities,
        states: mockWordSyncState.capabilities.map(capability => ({ capability,
          classification: capability === 'surface-reading' ? 'unmeasured' : 'known',
          basis: capability === 'surface-reading' ? 'unmeasured' : 'evidence',
          evidence: [], evidenceSourceCounts: Object.fromEntries(capability === 'surface-reading' ? [] : [['anki', 5]]),
        })),
      }],
    };
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle();
    const labels = Array.from(container.querySelectorAll('.rating-matrix__label')).map(node => node.textContent);
    expect(labels).toContain('mlearn.Knowledge.Capability.surface-reading');
    expect(labels).not.toContain('mlearn.Knowledge.Capability.sense-recognition');
    expect(labels).not.toContain('mlearn.Knowledge.Capability.surface-recognition');
    press(' ');
    await settle();
    const fluent = container.querySelector<HTMLButtonElement>('[aria-label="mlearn.Knowledge.Capability.surface-reading: mlearn.Rating.Matrix.Fluent"]')!;
    fluent.click();
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledOnce();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'surface-reading', 'fluent', expect.objectContaining({ origin: 'word-sync' }));
    expect(mockSetWordClaim).not.toHaveBeenCalled();
    expect(mockGetComprehensiveWordStatusWithSourceSync).not.toHaveBeenCalled();
    dispose();
  });

  it('reveals then toggles the current word translation with T', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    expect(container.textContent).not.toContain('red');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
    await settle();

    expect(container.textContent).toContain('red');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
    await settle();

    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('Space reveals the answer and a selected outcome Fluent keypress submits it', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Prompt first: the answer stays hidden.
    expect(container.textContent).not.toContain('red');

    // First Space reveals the answer; nothing is rated yet.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    expect(container.textContent).toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // A selected outcome Fluent keypress is a complete attempt on its own.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('pointer reveal via the translation control arms the rating control and shows the translation', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Prompt first: translation hidden, nothing rated.
    expect(container.textContent).not.toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // A pointer user clicks the visible translation/reveal control.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await settle();

    // Same revealed-and-ratable state as the first Space: translation shown,
    // and a selected outcome keypress submits.
    expect(container.textContent).toContain('red');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.objectContaining({
      language: 'ja',
    }));
    dispose();
  });

  it('Enter reveals the answer and a selected outcome Fluent keypress submits it', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    expect(container.textContent).not.toContain('red');

    // First Enter reveals the answer.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    expect(container.textContent).toContain('red');
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.objectContaining({
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
    await settle();
    await settle();

    // Manually toggle the translation on the first card (pointer reveal).
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await settle();
    expect(container.textContent).toContain('definition');

    // Submit → the next word is presented with translation hidden, even though
    // the prior card's translation was manually toggled.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    await settle();
    expect(container.textContent).not.toContain('definition');
    dispose();
  });

  it('hides a manually-toggled translation on restart', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Manually toggle the translation on, then reveal and submit → finished.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Start over → the first word is presented with translation hidden.
    container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn')!.click();
    await settle();
    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-confirm')!.click();
    await settle();
    await settle();

    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('hides a manually-toggled translation on undo', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Manually toggle the translation on, then reveal and submit → finished.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Undo restores the word with the translation hidden.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await settle();
    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('does not rate before the answer is revealed', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // A quality key before reveal writes nothing — the control is not armed.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await settle();
    expect(mockRecordAttempt).not.toHaveBeenCalled();

    // Now the answer is revealed; the same key records the single-access
    // profile and submits it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'sense-recognition', 'missed', expect.objectContaining({
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
    await settle();
    await settle();

    // Reveal and submit the first word.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    await settle();

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
    await settle();
    await settle();

    // Reveal and submit → finished.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Undo restores the word with the answer hidden (no translation leak).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await settle();
    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('starting over presents the first word with the answer hidden', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Reveal + submit → finished.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Start over → the first word is presented with the answer hidden.
    container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn')!.click();
    await settle();
    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-confirm')!.click();
    await settle();
    await settle();

    expect(container.textContent).toContain('赤い:あかい');
    expect(container.textContent).not.toContain('red');
    dispose();
  });

  it('renders the word as pure text when additional info is part of the answer', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Default (toggle off): full word render with reading.
    expect(container.textContent).toContain('赤い:あかい');
    // Word Sync owns its word display — no flashcard-display classes leak in.
    expect(container.querySelector('.flashcard-word-title')).toBeNull();

    // Toggle on: hidden answer shows the bare word.
    const toggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    toggle!.click();
    await settle();
    await settle();

    expect(container.textContent).toContain('赤い');
    expect(container.textContent).not.toContain('赤い:あかい');
    expect(container.querySelector('.flashcard-word-title')).toBeNull();

    // Revealing the answer restores the full render.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
    await settle();
    await settle();

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
    await settle();
    await settle();
    await settle();

    // The displayed reading follows the dictionary entry, not the freq primary.
    expect(container.textContent).toContain('赤い:あか');
    expect(container.textContent).not.toContain('赤い:あかい');

    // Rating stores the displayed (dictionary) reading so the word DB pairs it
    // with the same definition.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'sense-recognition', 'missed', expect.objectContaining({ language: 'ja' }));
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
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    expect(container.textContent).toContain('赤い:あかい');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    await settle();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await settle();
    expect(container.textContent).toContain('赤い:あかい');
    dispose();
  });

  it('Cmd+Z still works when a observed rating button holds focus', async () => {
    // Two words: one click-rating must not finish the session — the collapsed
    // bar has to stay mounted for the undo dispatch to bubble.
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Reveal the answer first (Space), then submit via the collapsed Fluent
    // button. The undo shortcut must work when dispatched FROM a rating
    // button — the button target must not swallow it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    buttonByText('mlearn.Rating.Matrix.Fluent').click();
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalled();

    buttonByText('mlearn.Rating.Matrix.Fluent')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    await settle();
    dispose();
  });

  it('routes a surface-reading miss through recordAttempt with one attempt identity', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await settle();
    // Restored matrix rows: All, sense-recognition, surface-reading. The
    // reading miss drafts; completing the word submits the explicit set.
    const rows = container.querySelectorAll('.rating-matrix__row');
    (rows[2].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[0]).click();
    await settle();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    (rows[1].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[0]).click();
    await settle();

    // A reading miss fabricates no fluent evidence elsewhere: both rows hold
    // explicit misses under one attempt identity.
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'surface-reading', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    expect(mockRecordAttempt).toHaveBeenCalledTimes(2);
    const attemptIds = new Set(mockRecordAttempt.mock.calls.map((call) => (call[3] as { attemptId?: string })?.attemptId));
    expect(attemptIds.size).toBe(1);
    dispose();
  });

  it('mounted Word Sync rates a REAL HSK Level-1 word from the packaging source with word-sync provenance', async () => {
    // Finding 1 (mounted-activity half): the word comes from the REAL
    // packaging-source frequency rows, and the EXISTING Word Sync surface
    // drives it — this is the accepted activity, not a new one.
    const freq = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'scripts/language-data/source/root-of-app/languages/zh.freq.json'),
      'utf8',
    )) as Array<[string, string, number, string]>;
    const hskRow = freq.find(([word, , level]) => level === 1 && typeof word === 'string' && word.length > 0);
    expect(hskRow).toBeDefined();
    const [hskWord, hskReading] = hskRow!;

    mockWordSyncState.settings.language = 'zh';
    mockWordSyncState.levelNames = { 1: 'HSK 3.0 Level 1' };
    mockWordSyncState.wordFrequency = {
      [hskWord]: { reading: hskReading, raw_level: 1, level: 'HSK 3.0 Level 1' },
    };
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    await settle();
    // Access rows for a zh word may be fewer than ja's — click the first cell
    // of every access row (skipping the All row) until the word completes.
    for (let guard = 0; guard < 10; guard += 1) {
      const accessRows = Array.from(
        container.querySelectorAll('.rating-matrix__row:not(:first-child)'),
      ) as HTMLButtonElement[];
      if (accessRows.length === 0) break;
      let clicked = false;
      for (const row of accessRows) {
        const cell = row.querySelector('.rating-matrix__cell') as HTMLButtonElement | null;
        if (cell && !cell.disabled) { cell.click(); clicked = true; }
      }
      if (!clicked) break;
      await settle();
      if (mockRecordAttempt.mock.calls.length > 0) break;
    }
    await settle();

    expect(mockRecordAttempt).toHaveBeenCalledWith(
      hskWord,
      expect.any(String),
      'missed',
      expect.objectContaining({ language: 'zh', origin: 'word-sync' }),
    );
    dispose();
  });

  it('never pools comprehensively-known words that already hold written-form access', async () => {
    // Teaching policy: a word whose written-form bridge is already accessible
    // (surface-recognition known) is fully owned elsewhere (e.g. Anki) — Word
    // Sync calibrates untracked words, not another scheduler's.
    mockGetComprehensiveWordStatusWithSourceSync.mockReturnValue({
      status: 'known',
      source: 'Anki',
      timesSeen: 1,
    });
    mockGetWordKnowledge.mockImplementation(() => ({
      word: '赤い',
      ease: 2.5,
      access: { 'surface-recognition': { status: 'known' } },
    }));
    mockGetAccessStatus.mockReturnValue({ status: 'known', ease: 2.5, source: 'Anki', untracked: false });
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // Pool empty → the finished state renders instead of any word.
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    dispose();
    mockGetAccessStatus.mockReturnValue({ status: 'unknown', ease: 0, source: 'None', untracked: true });
    // Restore the shared mock's default shape (mockReturnValue persists across tests).
    mockGetComprehensiveWordStatusWithSourceSync.mockImplementation(() => ({
      status: 'unknown',
      source: 'None',
      timesSeen: 0,
    }));
  });

  it('pools a known word with a missing written-form bridge (bridge candidate)', async () => {
    // A KNOWN lexical object without surface-recognition access is NOT
    // excluded: re-presenting it is a cheap bridge completion — exactly Word
    // Sync's overlay job. The knowledge record exists, so it is a bridge
    // candidate (weight ×1.5 in the calibration pick).
    mockGetComprehensiveWordStatusWithSourceSync.mockReturnValue({
      status: 'known',
      source: 'Manual',
      timesSeen: 1,
    });
    mockGetWordKnowledge.mockImplementation(() => ({
      word: '赤い',
      ease: 2.5,
    }));
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // The known object IS presented for its missing written-form access.
    expect(container.textContent).toContain('赤い:あかい');
    dispose();
    mockGetComprehensiveWordStatusWithSourceSync.mockImplementation(() => ({
      status: 'unknown',
      source: 'None',
      timesSeen: 0,
    }));
  });

  it('undoes an attempt-attributed rating via the per-hash snapshot', async () => {
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
    await settle();
    await settle();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    buttonByText('mlearn.Rating.Compact.Adjust').click();
    const rows = container.querySelectorAll('.rating-matrix__row');
    (rows[2].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[0]).click();
    (rows[1].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[0]).click();
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledWith('赤い', 'surface-reading', 'missed', expect.anything());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await settle();
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
    await settle();
    await settle();

    // Pool order within a level is shuffled, so detect which word came up first.
    const firstWord = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';
    const secondWord = firstWord === '赤い' ? '青い' : '赤い';

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    await settle();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await settle();
    expect(container.textContent).toContain(`${secondWord}:`);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await settle();
    expect(container.textContent).toContain(`${firstWord}:`);

    dispose();
  });

  it('rates once per press, ignoring held-down key auto-repeat', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    expect(container.textContent).toContain('赤い:あかい');

    // Held-down key: OS auto-repeat keydowns must not arm or rate.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true }));
    await settle();
    expect(mockRecordAttempt).not.toHaveBeenCalled();
    expect(container.textContent).toContain('赤い:あかい');

    // A fresh quality key records the selected outcome and rates exactly once.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    dispose();
  });

  it('admits an untracked word whose projection is ABSENT from the batched projections (F-N1 scan-level admission; request bounding W07)', async () => {
    absentProjectionWords = new Set(['يكتب']);
    mockWordSyncState.settings.language = 'ar';
    mockWordSyncState.wordFrequency = {
      'يكتب': {
        reading: 'yaktub',
        raw_level: 5,
        level: 'A1',
      },
    };
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();

    // The batched projections intentionally omit this surface's projection:
    // admission must still treat the unmeasured word as a candidate.
    expect(container.textContent).toContain('يكتب');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    dispose();
  });

  it('presents and rates a scan-admitted word whose ENCOUNTER projection is genuinely absent (F-N1)', async () => {
    absentProjectionWords = new Set(['يكتب']);
    mockWordSyncState.encounterAbsentWords = new Set(['يكتب']);
    mockWordSyncState.settings.language = 'ar';
    mockWordSyncState.wordFrequency = {
      'يكتب': {
        reading: 'yaktub',
        raw_level: 5,
        level: 'A1',
      },
    };
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();

    // The encounter admitted the unmeasured shape (identity-backed
    // constructed targets): the card is PRESENTED with the canonical rating
    // control for its tested accesses — previously an absent projection
    // died silently here and the word could never be rated (W07 repair).
    expect(container.textContent).toContain('يكتب');
    expect(container.querySelector('.rating-matrix__adjust')).toBeTruthy();

    // Reveal, then rate: the submission is accepted for the unmeasured word
    // and the session finishes honestly.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRecordAttempt).toHaveBeenCalled();
    expect(mockRecordAttempt.mock.calls[0][0]).toBe('يكتب');
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    dispose();
  });

  it('does not mis-admit a measured word while its projection is still materializing (F-N1 transient gate)', async () => {
    // The single-surface hook reports LOADING: an undefined projection is
    // not yet the unmeasured shape, so the encounter must wait instead of
    // presenting (and risking a mis-scoped rating).
    const [loading, setLoading] = createSignal(true);
    mockWordSyncState.encounterLoading = () => loading();
    mockWordSyncState.encounterAbsentWords = new Set(['يكتب']);
    mockWordSyncState.settings.language = 'ar';
    mockWordSyncState.wordFrequency = {
      'يكتب': {
        reading: 'yaktub',
        raw_level: 5,
        level: 'A1',
      },
    };
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    // No premature presentation while the hook loads: the shared skeleton
    // owns the gap.
    expect(container.textContent).not.toContain('يكتب');

    // Settled: the absent projection IS the unmeasured shape — presented.
    setLoading(false);
    await settle();
    await settle();
    expect(container.textContent).toContain('يكتب');
    dispose();
  });

  it('keeps a weak canonical target eligible without a recency gate', async () => {
    mockWordSyncState.settings.language = 'ar';
    mockWordSyncState.wordFrequency = {
      'يكتب': {
        reading: 'yaktub',
        raw_level: 5,
        level: 'A1',
      },
    };
    mockWordSyncState.getCanonicalFormForLanguage.mockImplementation((language: string, word: string) => (
      language === 'ar' && word === 'يكتب' ? 'كتب' : word
    ));
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();

    expect(container.textContent).toContain('يكتب');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    dispose();
  });

  it('restores the default word sync filter when starting over after confirmation', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    // When the filter dropdown is opened (closed by default)
    container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle')?.click();
    await settle();
    await settle();

    // instanceIds are regenerated per preset build — compare token shapes only.
    expect(filterTokenShapes(mockCommonState.filterBuilderProps?.tokens ?? [])).toEqual([]);

    container.querySelector<HTMLButtonElement>('.mock-filter-clear')?.click();
    await settle();
    await settle();
    expect(mockCommonState.filterBuilderProps?.tokens).toEqual([]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    await settle();

    const recheckButton = container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn');
    expect(recheckButton).not.toBeNull();
    recheckButton!.click();
    await settle();
    await settle();

    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-confirm')?.click();
    await settle();
    await settle();

    // instanceIds are regenerated per preset build — compare token shapes only.
    expect(filterTokenShapes(mockCommonState.filterBuilderProps?.tokens ?? [])).toEqual([]);
    expect(mockCommonState.buildWordSyncPreset).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('keeps the filter available on the finished screen', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    await settle();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // The filter toggle stays reachable on the finished screen instead of
    // forcing a full restart just to adjust the scope.
    const filterToggle = container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle');
    expect(filterToggle).not.toBeNull();
    filterToggle!.click();
    await settle();
    await settle();

    expect(mockCommonState.filterBuilderProps).not.toBeNull();
    dispose();
  });

  it('requires confirmation before starting over', async () => {
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn')!.click();
    await settle();
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');

    // Cancelling keeps the finished screen untouched.
    container.querySelector<HTMLButtonElement>('.mock-confirm-dialog-cancel')!.click();
    await settle();
    await settle();

    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    dispose();
  });
});

vi.mock('../../hooks/useKnowledgeProjections', async () => {
  const { useKnowledgeProjection } = await import('../../hooks/useKnowledgeProjection');
  return { useKnowledgeProjections: (query: () => { language: string; surfaces: string[] } | undefined) => {
    const knowledge = useKnowledgeProjection(() => undefined);
    return {
      ready: () => mockWordSyncState.collectionReady(),
      loading: () => !mockWordSyncState.collectionReady(),
      failed: () => mockWordSyncState.collectionFailed(),
      retry: mockRetryKnowledgeProjection,
      projections: () => new Map((query()?.surfaces ?? []).filter(word => !absentProjectionWords.has(word)).map(word => [word, mockWordSyncState.projectionByWord.get(word) ?? knowledge.projection()])),
    };
  } };
});
