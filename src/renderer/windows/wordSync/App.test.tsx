vi.mock('../../context', async () => {
  return {
  WindowWrapper: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
  useLocalization: () => ({ t: (key: string, params?: Record<string, string>) => params?.rated !== undefined ? `${params.rated} / ${params.total}` : key }),
  useSettings: () => ({
    settings: new Proxy(mockWordSyncState.settings, { get: (target, key) => key === 'language' && mockWordSyncState.scopeLanguage ? mockWordSyncState.scopeLanguage() : Reflect.get(target, key) }),
    updateSettings: mockUpdateSettings,
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
    submitRating: mockSubmitRating,
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
import { batch, createEffect, createSignal, Show } from 'solid-js';
import type { Component, JSX } from 'solid-js';
import type { LLMStreamCallbacks } from '../../services/llmProvider';
import type { AccessStatusResult } from '../../utils/accessKnowledge';
import type { KnowledgeProjection } from '../../../shared/graph/ipc';
import type { WordStatus } from '../../../shared/constants';
import type { AttemptQuality } from '../../../shared/constants';
import { closeKnowledgeInspector, knowledgeInspection } from '../../services/openKnowledgeInspector';
import { projectionFixture } from '../../../../test/projectionFixture';

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
// Captures observations emitted by the submitRating command mock for assertions;
// Word Sync no longer owns or calls a provider recordAttempt API.
const mockRatingObservation = vi.fn((..._callArgs: unknown[]) => ({ attemptId: 'attempt-sync-1' }));
const mockSubmitRating = vi.fn(async (
  word: string,
  observations: readonly { capability: string; quality: AttemptQuality; method?: 'recall' | 'inference' }[],
  options: { attemptId: string; [key: string]: unknown },
) => {
  batch(() => {
    for (const observation of observations) {
      mockRatingObservation(word, observation.capability, observation.quality, { ...options, method: observation.method });
    }
  });
  return { attemptId: options.attemptId, completed: true };
});
const mockShowToast = vi.hoisted(() => vi.fn());
const isReadingScriptTextFn = vi.hoisted(() => vi.fn((_surface?: unknown, _data?: unknown) => false));
const mockAppendRetractions = vi.fn(async () => true);
const mockRecomputeProjection = vi.fn(async () => {});
const mockUpdateSettings = vi.fn();
const mockFetchTranslation = vi.hoisted(() => vi.fn(async (_word?: string): Promise<{ data: Array<{ definitions: string[]; reading?: string }> }> => ({ data: [] })));
const mockWordSyncState = vi.hoisted(() => ({
  scopeLanguage: null as null | (() => string),
  settings: {
    language: 'ja',
    uiLanguage: 'en',
    dictionaryTargetLanguages: {} as Record<string, string>,
    learningLanguageLevels: {} as Record<string, number>,
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
  currentLangData: null as {
    textProcessing?: { readingAnnotation?: boolean };
    prosody?: { type?: string };
    frequencyLevels?: { difficulty?: 'lower-is-harder' | 'higher-is-harder'; names?: Record<string, string> };
    languageData?: { version?: string };
  } | null,
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
    retry: mockRetryKnowledgeProjection,
    capabilities: () => mockWordSyncState.capabilities,
  }),
}));

vi.mock('../../components/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/common')>();
  return ({
  // Real RatingMatrix: rating tests exercise the actual input controller
  // (its Button/KeyboardShortcut primitives come from the real barrel exports).
  Button: actual.Button,
  Panel: actual.Panel,
  RatingMatrix: actual.RatingMatrix,
  // Real banner: the save-failure assertions read its role/label contract.
  WriteStatusBanner: actual.WriteStatusBanner,
  KeyboardShortcut: actual.KeyboardShortcut,
  KnowledgeSkeleton: actual.KnowledgeSkeleton,
  EmptyState: (props: { title?: string }) => <div>{props.title}</div>,
  Popover: (props: {
    open?: boolean | (() => boolean);
    children?: JSX.Element;
  }) => {
    const [rendered, setRendered] = createSignal(false);
    createEffect(() => setRendered(Boolean(typeof props.open === 'function' ? props.open() : props.open)));
    return <Show when={rendered()}><div role="dialog">{props.children}</div></Show>;
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
    getLearningLanguageLevelForLanguage: (settings: { learningLanguageLevels?: Record<string, number> }, language: string) => settings.learningLanguageLevels?.[language] ?? null,
    // Integer-like object keys iterate numerically ascending, so fixtures
    // written N5→N3 arrive as [3,4,5]. Production sorts ascending difficulty
    // (easiest first); mirror both package-declared numeric scale directions.
    sortFrequencyLevelsByDifficulty: (levels: number[], data?: { frequencyLevels?: { difficulty?: string } }) =>
      [...levels].sort((a, b) => data?.frequencyLevels?.difficulty === 'higher-is-harder' ? a - b : b - a),
    isFrequencyLevelAtOrEasierThanTarget: (level: number, target: number, data?: { frequencyLevels?: { difficulty?: string } }) =>
      data?.frequencyLevels?.difficulty === 'higher-is-harder' ? level <= target : level >= target,
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
async function settle() { for (let i = 0; i < 24; i++) await Promise.resolve(); }

describe('WordSyncContent', () => {
  it('opens the current word in the shared knowledge Inspector', async () => {
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle();
    buttonByText('mlearn.Knowledge.Popup.Inspect').click();
    expect(knowledgeInspection()).toMatchObject({ language: 'ja', surface: '赤い', target: { kind: 'surface' } });
    closeKnowledgeInspector();
  }, 20000);

  it('runs assessment in the shared session, resumes its result, and leaves unsampled surfaces unmeasured', async () => {
    mockWordSyncState.wordFrequency = {
      'high-a': { reading: 'high-a', raw_level: 5, level: 'High' },
      'high-b': { reading: 'high-b', raw_level: 5, level: 'High' },
      'high-c': { reading: 'high-c', raw_level: 5, level: 'High' },
      'already-measured': { reading: 'already-measured', raw_level: 5, level: 'High' },
      'low-a': { reading: 'low-a', raw_level: 2, level: 'Low' },
      'low-b': { reading: 'low-b', raw_level: 2, level: 'Low' },
      'low-c': { reading: 'low-c', raw_level: 2, level: 'Low' },
    };
    mockWordSyncState.levelNames = { 5: 'High', 2: 'Low' };
    mockWordSyncState.projectionByWord.set('already-measured', projectionFixture('known', 'evidence'));

    const { WordSyncContent } = await import('./App');
    const mountAssessment = () => {
      const dispose = render(() => <WordSyncContent mode="assessment" />, container);
      disposals.push(dispose);
      return dispose;
    };
    const dispose = mountAssessment();
    await settle(); await settle(); await settle();
    expect(container.querySelector('.word-sync-filter-toggle')).toBeNull();
    buttonByText('mlearn.LevelStudy.Placement.Start').click();
    await settle(); await settle();

    const key = 'mlearn-study-word-sync-assessment:ja';
    const started = JSON.parse(localStorage.getItem(key)!) as {
      queue: Array<{ id: string }>;
      meta: { assessment: { pools: Array<{ level: number; words: string[] }> } };
    };
    expect(started.meta.assessment.pools.flatMap((pool) => pool.words)).not.toContain('already-measured');
    expect(started.queue).toHaveLength(6);

    for (let sample = 0; sample < 5; sample += 1) {
      await settle();
      press('3');
      await settle(); await settle();
    }
    expect(container.querySelector('[data-testid="word-sync-assessment-summary"]')).not.toBeNull();
    expect(container.textContent).toContain('mlearn.LevelStudy.Placement.Placement');
    expect(mockSubmitRating).toHaveBeenCalledTimes(5);
    for (const [, observations, options] of mockSubmitRating.mock.calls) {
      expect(observations).toEqual([{ capability: 'surface-recognition', quality: 'fluent' }]);
      expect(options).toEqual(expect.objectContaining({ origin: 'placement', taskType: 'placement' }));
    }
    const sampled = mockRatingObservation.mock.calls.map(([word]) => word);
    expect(new Set(sampled).size).toBe(5);
    const completed = JSON.parse(localStorage.getItem(key)!) as { meta: { assessment: { draws: Array<{ key: string; outcome: string }> } } };
    expect(completed.meta.assessment.draws.filter((draw) => draw.outcome !== 'skipped')).toHaveLength(5);

    dispose();
    const resume = mountAssessment();
    await settle(); await settle(); await settle();
    expect(container.querySelector('[data-testid="word-sync-assessment-summary"]')).not.toBeNull();
    expect(container.querySelector('.word-sync-assessment-start')).toBeNull();
    buttonByText('mlearn.LevelStudy.Placement.UseLevel').click();
    expect(mockUpdateSettings).toHaveBeenCalledWith({ learningLanguageLevels: { ja: 2 } });
    resume();
  });

  it('orders assessment levels by package difficulty rather than raw level numbers', async () => {
    const scaleWords: Array<[string, number]> = [
      ['easy-a', 1], ['easy-b', 1], ['easy-c', 1], ['easy-d', 1],
      ['hard-a', 5], ['hard-b', 5], ['hard-c', 5], ['hard-d', 5],
    ];
    mockWordSyncState.wordFrequency = Object.fromEntries(scaleWords.map(([word, level]) => [word, { reading: word, raw_level: level, level: String(level) }]));
    mockWordSyncState.levelNames = { 1: 'Easy', 5: 'Hard' };
    mockWordSyncState.currentLangData = { frequencyLevels: { difficulty: 'higher-is-harder', names: { 1: 'Easy', 5: 'Hard' } } };
    mockWordSyncState.settings.learningLanguageLevels = { ja: 1 };
    const dispose = await mountAssessment();
    await settle(); await settle();
    buttonByText('mlearn.LevelStudy.Placement.Start').click();
    await settle(); await settle();

    expect(container.querySelector('[data-word="hard-a"], [data-word="hard-b"], [data-word="hard-c"], [data-word="hard-d"]')).not.toBeNull();
    for (let sample = 0; sample < 5; sample += 1) {
      press('3');
      await settle(); await settle();
    }
    expect(container.querySelector('[data-testid="word-sync-assessment-summary"]')?.textContent).toContain('mlearn.LevelStudy.Placement.MoveAhead');
    buttonByText('mlearn.LevelStudy.Placement.UseLevel').click();
    expect(mockUpdateSettings).toHaveBeenCalledWith({ learningLanguageLevels: { ja: 5 } });
    dispose();
  });

  it('keeps a delayed assessment Start scoped to its original language', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: async (_name: string, callback: () => void | Promise<void>) => { await gate; await callback(); } },
    });
    const [language, setLanguage] = createSignal('ja');
    mockWordSyncState.scopeLanguage = language;
    mockWordSyncState.wordFrequency = Object.fromEntries(['ja-a', 'ja-b', 'ja-c'].map((word) => [word, { reading: word, raw_level: 5, level: 'Japanese' }]));
    mockWordSyncState.levelNames = { 5: 'Japanese' };

    await mountAssessment();
    await settle(); await settle();
    buttonByText('mlearn.LevelStudy.Placement.Start').click();
    await settle();
    expect(localStorage.getItem('mlearn-study-word-sync-assessment:ja')).toBeNull();

    setLanguage('de');
    mockWordSyncState.wordFrequency = Object.fromEntries(['de-a', 'de-b', 'de-c'].map((word) => [word, { reading: word, raw_level: 1, level: 'Deutsch' }]));
    mockWordSyncState.levelNames = { 1: 'Deutsch' };
    await settle(); await settle();
    release();
    await settle(); await settle(); await settle();

    const japanese = JSON.parse(localStorage.getItem('mlearn-study-word-sync-assessment:ja') ?? 'null');
    expect(japanese.identity).toContain('"language":"ja"');
    expect(japanese.meta.assessment.pools).toHaveLength(1);
    expect(japanese.meta.assessment.pools[0]).toMatchObject({ level: 5, label: 'Japanese' });
    expect(new Set(japanese.meta.assessment.pools[0].words)).toEqual(new Set(['ja-a', 'ja-b', 'ja-c']));
    expect(localStorage.getItem('mlearn-study-word-sync-assessment:de')).toBeNull();
    expect(container.querySelector('.word-sync-assessment-start')).not.toBeNull();
  });

  it('records interrupted active timing on an assessment rating', async () => {
    mockWordSyncState.wordFrequency = Object.fromEntries(['a', 'b', 'c'].map((word) => [word, { reading: word, raw_level: 5, level: 'Level' }]));
    mockWordSyncState.levelNames = { 5: 'Level' };
    await mountAssessment();
    await settle(); await settle();
    buttonByText('mlearn.LevelStudy.Placement.Start').click();
    await settle(); await settle();

    window.dispatchEvent(new Event('blur'));
    press('3');
    await settle(); await settle();

    expect(mockSubmitRating.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      timing: expect.objectContaining({ interrupted: true, interruptionCount: 1 }),
    }));
    window.dispatchEvent(new Event('focus'));
  });

  it('discards a malformed assessment history and starts a fresh deterministic session', async () => {
    const malformedSessionWords: Array<[string, number]> = [
      ['easy-a', 5], ['easy-b', 5], ['hard-a', 2], ['hard-b', 2],
    ];
    mockWordSyncState.wordFrequency = Object.fromEntries(malformedSessionWords.map(([word, level]) => [word, { reading: word, raw_level: level, level: String(level) }]));
    mockWordSyncState.levelNames = { 5: 'Easy', 2: 'Hard' };
    localStorage.setItem('mlearn-study-word-sync-assessment:ja', JSON.stringify({
      id: 'corrupt-order', identity: JSON.stringify({ language: 'ja' }),
      queue: [{ id: 'easy-a', level: 5 }, { id: 'easy-b', level: 5 }, { id: 'hard-a', level: 2 }, { id: 'hard-b', level: 2 }],
      index: 1, visited: [0], rated: 1, revealed: false,
      meta: {
        samplingLevel: 5, lastRating: null,
        assessment: {
          pools: [
            { level: 5, label: 'Easy', words: ['easy-a', 'easy-b'] },
            { level: 2, label: 'Hard', words: ['hard-a', 'hard-b'] },
          ],
          draws: [{ key: 'easy-a', level: 5, outcome: 'fluent' }],
        },
      },
    }));

    await mountAssessment();
    await settle(); await settle();
    expect(container.querySelector('.word-sync-assessment-start')).not.toBeNull();
    expect(container.querySelector('.word-sync-assessment-card')).toBeNull();

    buttonByText('mlearn.LevelStudy.Placement.Start').click();
    await settle(); await settle();
    const fresh = JSON.parse(localStorage.getItem('mlearn-study-word-sync-assessment:ja')!);
    expect(fresh.id).not.toBe('corrupt-order');
    expect(fresh.meta.assessment.draws).toEqual([]);
    expect(fresh.queue[fresh.index]).toMatchObject({ id: expect.stringMatching(/^(easy|hard)-/) });
  });

  let container: HTMLDivElement;

  // Digits record one selected observed outcome after reveal.
  const press = (key: string, init: KeyboardEventInit = {}) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }));
  };

  // The mocked t() renders locale keys verbatim, so controls are located by
  // their label key rather than implementation classes.
  const buttonByText = (text: string): HTMLButtonElement => {
    // TellMlearn's composer (Send/Undo) lives in a Popover Portal on
    // document.body; every other control stays inside the container.
    const scope = Array.from(container.querySelectorAll('button')).concat(
      Array.from(document.body.querySelectorAll('.popover-panel button')),
    );
    const el = scope.find((b) => (b.textContent ?? '').includes(text));
    if (!el) throw new Error(`button not found: ${text}`);
    return el;
  };

  const attemptIdOf = (callIndex: number): string =>
    ((mockRatingObservation.mock.calls[callIndex]?.[3] as { attemptId?: string } | undefined)?.attemptId ?? '');
  const allAttemptIds = (): Set<string> =>
    new Set(mockRatingObservation.mock.calls.map((call) => ((call[3] as { attemptId?: string } | undefined)?.attemptId ?? '')));

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

  const mountAssessment = async (): Promise<() => void> => {
    const { WordSyncContent } = await import('./App');
    const dispose = render(() => <WordSyncContent mode="assessment" />, container);
    disposals.push(dispose);
    return dispose;
  };

beforeEach(() => {
    let lockChain = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async <T,>(_name: string, callback: () => T | Promise<T>): Promise<T> => {
          const job = lockChain.then(callback);
          lockChain = job.then(() => undefined, () => undefined);
          return job;
        },
      },
    });
    window.localStorage.removeItem('mlearn-study-word-sync:ja');
    window.localStorage.removeItem('mlearn-study-word-sync-assessment:ja');
    container = document.createElement('div');
    document.body.appendChild(container);
    mockGetComprehensiveWordStatusWithSourceSync.mockClear();
    mockWordSyncState.scopeLanguage = null;
    mockWordSyncState.settings.language = 'ja';
    mockWordSyncState.settings.learningLanguageLevels = {};
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
    mockRatingObservation.mockClear();
    mockSubmitRating.mockClear();
    mockShowToast.mockClear();
    mockAppendRetractions.mockClear();
    mockAppendRetractions.mockResolvedValue(true);
    mockRecomputeProjection.mockClear();
    mockUpdateSettings.mockClear();
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
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: ['definition'] }] });
  });

  afterEach(() => {
    while (disposals.length) disposals.pop()!();
    container.remove();
    document.body.querySelectorAll('.popover-panel').forEach((el) => el.remove());
  });

  it('resumes its durable cursor when filter presentation IDs change on remount', async () => {
    mockWordSyncState.wordFrequency = Object.fromEntries(['赤い', '青い', '白い'].map((word) => [word, {
      reading: word, raw_level: 5, level: 'N5',
    }]));
    mockCommonState.defaultPreset = [{ instanceId: 'first-mount', kind: 'operand', field: 'status', op: 'eq', value: 'untracked' }];
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 3');
    press(' '); await settle();
    press('3'); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('1 / 3');
    const nextWord = container.querySelector('.word-sync-word')?.textContent;
    const saved = JSON.parse(localStorage.getItem('mlearn-study-word-sync:ja') ?? 'null');
    expect(saved?.rated).toBe(1);
    expect(saved.queue.every((item: Record<string, unknown>) => Object.keys(item).join() === 'id')).toBe(true);

    disposals.pop()!();
    mockWordSyncState.projectionByWord.set(saved.queue[0].id, {
      status: 'ready',
      targets: [{
        targetRef: { kind: 'surface', id: 'rated-surface' },
        applicableCapabilities: mockWordSyncState.capabilities,
        states: mockWordSyncState.capabilities.map((capability) => ({
          capability, classification: 'known', basis: 'evidence', evidence: [], evidenceSourceCounts: { manual: 1 },
        })),
      }],
    } as KnowledgeProjection);
    mockCommonState.defaultPreset = [{ instanceId: 'second-mount', kind: 'operand', field: 'status', op: 'eq', value: 'untracked' }];
    mountContent(WordSyncContent);
    await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('1 / 3');
    expect(container.querySelector('.word-sync-word')?.textContent).toBe(nextWord);
    expect(JSON.parse(localStorage.getItem('mlearn-study-word-sync:ja') ?? 'null').id).toBe(saved.id);
  });

  it('offers retry when the initial session cannot be persisted', async () => {
    const setItem = localStorage.setItem.bind(localStorage);
    let refuse = true;
    const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'mlearn-study-word-sync:ja' && refuse) throw new DOMException('quota exceeded', 'QuotaExceededError');
      setItem(key, value);
    });
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.SaveFailed');
    expect(container.querySelector('.word-sync-word')).toBeNull();

    refuse = false;
    buttonByText('mlearn.Global.TryAgain').click();
    await settle();
    expect(container.querySelector('.word-sync-word')).not.toBeNull();
    expect(localStorage.getItem('mlearn-study-word-sync:ja')).not.toBeNull();
    setItemSpy.mockRestore();
  });

  it('starts a single-window session when the host has no Web Locks API', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: null });
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle();
    expect(container.querySelector('.word-sync-word')).not.toBeNull();
    expect(localStorage.getItem('mlearn-study-word-sync:ja')).not.toBeNull();
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
    mockRatingObservation.mockImplementation((value: unknown) => { const word = String(value); words.add(word); setReady(false); return { attemptId: word }; });
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
    mockRatingObservation.mockImplementation(() => ({ attemptId: 'attempt-sync-1' }));
  });

  it('starts a clean session when the active language changes without replaying old undo state', async () => {
    const [language, setLanguage] = createSignal('ja');
    mockWordSyncState.scopeLanguage = language;
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    press(' '); await settle(); press('3'); await settle(); await settle();
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    setLanguage('third-party');
    await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 1');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    press('z', { ctrlKey: true });
    expect(mockAppendRetractions).not.toHaveBeenCalled();
    press(' '); await settle(); press('3'); await settle();
    expect(mockRatingObservation.mock.calls.at(-1)?.[3]).toMatchObject({ language: 'third-party' });
  });

  it('honors an explicit ignore change during a session without recording a response', async () => {
    const { hashWordSync } = await import('../../services/srsAlgorithm');
    const [ignored, setIgnored] = createSignal(false);
    Object.defineProperty(mockWordSyncState.ignoredWords, `ja:${hashWordSync('赤い')}`, { get: () => ignored() ? { word: '赤い', language: 'ja' } : undefined, enumerable: true });
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-word')).not.toBeNull();
    setIgnored(true);
    await settle(); await settle();
    expect(container.textContent).toContain('mlearn.WordSync.EmptyTitle');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    expect(mockRatingObservation).not.toHaveBeenCalled();
  });

  it('keeps invalid filters editable instead of trapping the session behind loading', async () => {
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    buttonByText('mlearn.WordSync.Filter').click();
    mockCommonState.filterBuilderProps!.onChange([{ kind: 'operator', op: 'AND' }]);
    await settle();
    expect(container.textContent).toContain('mlearn.WordSync.InvalidFilter');
    expect(container.querySelector('.word-sync-filter-toggle')).not.toBeNull();
    mockCommonState.filterBuilderProps!.onChange([]);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-word')).not.toBeNull();
  });

  it('offers retry for a failed current prompt query without counting it as processed', async () => {
    mockWordSyncState.projection = { status: 'error', targets: [] } as unknown as KnowledgeProjection;
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    expect(container.textContent).toContain('mlearn.WordSync.ProjectionUnavailable');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    buttonByText('mlearn.Global.TryAgain').click();
    expect(mockRetryKnowledgeProjection).toHaveBeenCalledOnce();
    expect(mockRatingObservation).not.toHaveBeenCalled();
  });

  it('recovers a failed dictionary read for the current prompt without an empty completion', async () => {
    mockFetchTranslation.mockRejectedValueOnce(new Error('dictionary unavailable'));
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    expect(container.textContent).toContain('mlearn.WordSync.ProjectionUnavailable');
    buttonByText('mlearn.Global.TryAgain').click();
    await settle(); await settle();
    expect(container.querySelector('.word-sync-word')).not.toBeNull();
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
  });

  it('visits all 43 admitted candidates even when their level has no name entry', async () => {
    mockWordSyncState.levelNames = { 5: 'Named level' };
    mockWordSyncState.wordFrequency = Object.fromEntries(Array.from({ length: 43 }, (_, index) => [`word-${index}`, { reading: '', raw_level: 2, level: '' }]));
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 43');
    expect(container.querySelector('.word-sync-word')).not.toBeNull();
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
  });

  it('does not report success when all 43 scan candidates have no testable target at presentation', async () => {
    mockWordSyncState.wordFrequency = Object.fromEntries(Array.from({ length: 43 }, (_, index) => [`word-${index}`, { reading: '', raw_level: 5, level: 'N5' }]));
    mockWordSyncState.projection = { status: 'ready', surfaceKnown: true, targets: [], evidenceSourceCounts: {} } as unknown as KnowledgeProjection;
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await vi.waitFor(() => expect(container.querySelector('.word-sync-finished')).not.toBeNull());
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedDescription');
    expect(container.textContent).toContain('mlearn.WordSync.EmptyTitle');
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 0');
    expect(mockRatingObservation).not.toHaveBeenCalled();
  });

  it('starts a package with vocabulary but no named levels instead of waiting forever', async () => {
    mockWordSyncState.levelNames = {};
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await vi.waitFor(() => expect(container.querySelector('.word-sync-word')).not.toBeNull());
    expect(container.textContent).not.toContain('mlearn.WordSync.FinishedTitle');
  });

  it('shows a retry action when the shared projection read fails instead of keeping the skeleton', async () => {
    mockWordSyncState.collectionReady = () => false;
    mockWordSyncState.collectionFailed = () => true;
    const { WordSyncContent } = await import('./App');

    mountContent(WordSyncContent);
    await settle();

    expect(container.textContent).toContain('mlearn.WordSync.ProjectionUnavailable');
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('mlearn.Global.TryAgain'));
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

    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('mlearn.Global.TryAgain'));
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
    mockRatingObservation.mockImplementation((value: unknown) => { const word = String(value); seen.add(word); setReady(false); return { attemptId: word }; });
    for (let count = 1; count <= 4; count++) {
      press(' '); await settle(); press('3'); await settle(); await settle();
      expect(container.querySelector('.word-sync-counter')?.textContent).toBe(`${count} / 4`);
    }
    expect(seen.size).toBe(4);
    expect(container.textContent).toContain('mlearn.WordSync.FinishedTitle');
    mockRatingObservation.mockReset();
  });

  it('keeps the session and progress visible while the next prompt projection settles', async () => {
    mockWordSyncState.wordFrequency = Object.fromEntries(['one', 'two'].map(word => [
      word, { reading: word, raw_level: 5, level: 'N5' },
    ]));
    const [loading, setLoading] = createSignal(false);
    mockWordSyncState.encounterLoading = loading;
    mockRatingObservation.mockImplementation(() => {
      setLoading(true);
      return { attemptId: 'warm-rating' };
    });
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');
    press(' '); await settle(); press('3'); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('1 / 2');
    expect(container.querySelector('.word-sync-card--pending')).not.toBeNull();
    expect(container.querySelector('.word-sync-filter-toggle')).not.toBeNull();
    setLoading(false);
    await settle(); await settle();
    expect(container.querySelector('.word-sync-card--pending')).toBeNull();
    expect(container.querySelector('.word-sync-word')).not.toBeNull();
  }, 10000);

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
    buttonByText('mlearn.WordSync.Filter').click();
    await settle();
    press(' '); await settle(); press('1'); await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('1 / 1');
    // The miss does not become a recency exclusion when the scope is reopened.
    buttonByText('mlearn.WordSync.Filter').click();
    await settle();
    mockCommonState.filterBuilderProps!.onChange([]);
    await settle(); await settle(); await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');
    dispose();
  });

  it('suspends study reveal while the filter popover owns keyboard input', async () => {
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle(); await settle();
    const toggle = container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle')!;
    toggle.click();
    await settle();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    press(' ');
    await settle();
    expect(container.querySelector('.word-sync-translation-toggle')?.textContent).toBe('mlearn.WordSync.ShowTranslation');

    toggle.click();
    await settle();
    press(' ');
    await settle();
    expect(container.querySelector('.word-sync-translation-toggle')?.textContent).toBe('mlearn.WordSync.HideTranslation');
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
    mockRatingObservation.mockImplementation(() => {
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
      expect(mockRatingObservation).toHaveBeenCalledTimes(3);
      expect(flushedRevisions).toEqual([3]);
      expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');
    } finally {
      mockRatingObservation.mockImplementation(() => ({ attemptId: 'attempt-sync-1' }));
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
    expect(mockRatingObservation).toHaveBeenCalledTimes(2);
    expect(mockRatingObservation).toHaveBeenCalledWith(firstShown, 'sense-recognition', 'fluent', expect.objectContaining({ language: 'ja', origin: 'word-sync' }));
    expect(mockRatingObservation).toHaveBeenCalledWith(firstShown, 'surface-reading', 'fluent', expect.objectContaining({ language: 'ja', origin: 'word-sync' }));
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
    expect(mockRatingObservation).toHaveBeenCalledTimes(4);
    expect(allAttemptIds().size).toBe(2);
    dispose();
  });

  it('keeps the same prompt after a refused journal write and retries one attempt', async () => {
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    mockSubmitRating.mockRejectedValueOnce(new Error('journal refused'));
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';

    press(' ');
    await settle();
    press('3');
    await settle();
    await settle();
    expect(container.textContent).toContain(`${firstShown}:`);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('SaveFailed');
    expect(mockRatingObservation).not.toHaveBeenCalled();

    buttonByText('mlearn.Global.TryAgain').click();
    await settle();
    await settle();
    expect(mockSubmitRating).toHaveBeenCalledTimes(2);
    expect(mockSubmitRating.mock.calls[0][2].attemptId).toBe(mockSubmitRating.mock.calls[1][2].attemptId);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');
    dispose();
  });

  it('holds the prompt and blocks a duplicate rating until the journal acknowledges', async () => {
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    let acknowledge!: () => void;
    mockSubmitRating.mockImplementationOnce((_word, _observations, options) =>
      new Promise((resolve) => { acknowledge = () => resolve({ attemptId: options.attemptId, completed: true }); }));
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();
    const firstShown = container.textContent!.includes('赤い:あかい') ? '赤い' : '青い';

    press(' ');
    await settle();
    press('3');
    await settle();
    expect(container.textContent).toContain(`${firstShown}:`);
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('SavingRating');
    press('3');
    await settle();
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);

    acknowledge();
    await settle();
    await settle();
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('1 / 2');
    expect(container.textContent).toContain(firstShown === '赤い' ? '青い:あおい' : '赤い:あかい');
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

    expect(mockRatingObservation).toHaveBeenCalledTimes(1);
    const call = mockRatingObservation.mock.calls[0]!;
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
    expect(mockRatingObservation).toHaveBeenCalledTimes(2);
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
    expect(mockRatingObservation).toHaveBeenCalledTimes(2);
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
    expect(mockRatingObservation).toHaveBeenCalledTimes(1);

    // …and clean: rating it again records a fresh attempt, not a replay.
    press(' ');
    await settle();
    await settle();
    press('3');
    await settle();
    await settle();
    expect(mockRatingObservation).toHaveBeenCalledTimes(2);
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
    expect(mockRatingObservation).toHaveBeenCalledTimes(2);

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
    expect(mockRatingObservation).not.toHaveBeenCalled();
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
    const input = document.body.querySelector<HTMLTextAreaElement>('.tell-mlearn__input')!;
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
    expect(mockRatingObservation).not.toHaveBeenCalled();
    const missing = container.querySelector<HTMLButtonElement>('[aria-label="mlearn.Knowledge.Capability.surface-recognition: mlearn.Rating.Matrix.Missed"]')!;
    missing.click(); await settle(); await settle();
    expect(mockRatingObservation).toHaveBeenCalledTimes(1);
    expect(mockRatingObservation.mock.calls[0][0]).toBe('水筒');
    expect(mockRatingObservation.mock.calls[0][1]).toBe('surface-recognition');
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
    const input = document.body.querySelector<HTMLTextAreaElement>('.tell-mlearn__input')!;
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
    expect(mockRatingObservation).not.toHaveBeenCalled();
    const summary = document.body.querySelector('.tell-mlearn__summary')!.textContent;
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

    expect(mockRatingObservation).toHaveBeenCalledTimes(2);
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.anything());
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'surface-recognition', 'fluent', expect.anything());
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
    expect(mockRatingObservation).toHaveBeenCalledWith(expect.any(String), 'sense-recognition', 'fluent', expect.objectContaining({ language: 'ja' }));
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
    expect(mockRatingObservation).toHaveBeenCalledOnce();
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'surface-reading', 'fluent', expect.objectContaining({ origin: 'word-sync' }));
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

  it.each([{ data: [] }, { data: [{ definitions: ['   '] }] }])('does not grade a missing revealed answer: %j', async ({ data }) => {
    mockFetchTranslation.mockResolvedValue({ data });
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRatingObservation).not.toHaveBeenCalled();
    expect(container.textContent).toContain('mlearn.WordSync.AnswerUnavailable');
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 1');
  });

  it('lets the session skip past a revealed word with no answer, so an unanswerable word cannot block the run', async () => {
    // A word with no dictionary entry cannot be graded, and retrying the
    // lookup does not recover it. Without an escape hatch the whole drill
    // session parks on it forever.
    mockWordSyncState.currentLangData = { textProcessing: { readingAnnotation: true } };
    mockWordSyncState.wordFrequency = {
      '紫い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '蓝い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    // Leave only the first-shown word unanswerable; whichever word the queue
    // starts on gets no definitions, the other resolves normally. The shown
    // word is read lazily because the queue order is not fixed.
    let blocked = '';
    mockFetchTranslation.mockImplementation(async (word?: string) => {
      if (!blocked && word) blocked = word;
      return word === blocked ? { data: [] } : { data: [{ definitions: ['answer'] }] };
    });
    const { WordSyncContent } = await import('./App');
    const dispose = mountContent(WordSyncContent);
    await settle(); await settle();
    press(' ');
    await settle();
    expect(blocked).not.toBe('');
    expect(container.textContent).toContain('mlearn.WordSync.AnswerUnavailable');
    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 2');

    const other = blocked === '紫い' ? '蓝い' : '紫い';
    buttonByText('mlearn.WordSync.SkipWord').click();
    await settle(); await settle();

    expect(container.querySelector('.word-sync-counter')?.textContent).toBe('0 / 1');
    expect(container.textContent).not.toContain('mlearn.WordSync.AnswerUnavailable');
    expect(container.textContent).toContain(`${other}:`);
    dispose();
  });

  it('uses a valid secondary dictionary answer when the primary entry is empty', async () => {
    mockFetchTranslation.mockResolvedValue({ data: [{ definitions: [] }, { definitions: ['red'] }] });
    const { WordSyncContent } = await import('./App');
    mountContent(WordSyncContent);
    await settle(); await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    expect(container.textContent).toContain('red');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRatingObservation).toHaveBeenCalled();
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
    expect(mockRatingObservation).not.toHaveBeenCalled();

    // A selected outcome Fluent keypress is a complete attempt on its own.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.objectContaining({
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
    expect(mockRatingObservation).not.toHaveBeenCalled();

    // A pointer user clicks the visible translation/reveal control.
    container.querySelector<HTMLButtonElement>('.word-sync-translation-toggle')!.click();
    await settle();

    // Same revealed-and-ratable state as the first Space: translation shown,
    // and a selected outcome keypress submits.
    expect(container.textContent).toContain('red');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.objectContaining({
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
    expect(mockRatingObservation).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await settle();
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'sense-recognition', 'fluent', expect.objectContaining({
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
    expect(mockRatingObservation).not.toHaveBeenCalled();

    // Now the answer is revealed; the same key records the single-access
    // profile and submits it.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await settle();
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'sense-recognition', 'missed', expect.objectContaining({
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
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'sense-recognition', 'missed', expect.objectContaining({ language: 'ja' }));
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

  it('reports a refused undo and offers a retry instead of failing silently', async () => {
    // Regression: a refused retraction used to return early through a
    // `finally` that only cleared a boolean, so undo looked exactly like it had
    // worked. The learner got no evidence and no way back. Undo is a durable
    // write and must be reported as one, the same as flashcard review does.
    mockWordSyncState.wordFrequency = {
      '赤い': { reading: 'あかい', raw_level: 5, level: 'N5' },
      '青い': { reading: 'あおい', raw_level: 5, level: 'N5' },
    };
    // Retractions succeed for the rating path's own bookkeeping, then the
    // storage layer starts refusing (the quota / private-storage failure).
    mockAppendRetractions.mockResolvedValue(false);
    const { WordSyncContent } = await import('./App');

    const dispose = mountContent(WordSyncContent);
    await settle();
    await settle();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    buttonByText('mlearn.Rating.Matrix.Fluent').click();
    await settle();
    await settle();

    // Storage refuses the retraction.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    await settle();
    await settle();

    // The failure is reported, and it is retryable.
    expect(container.textContent).toContain('mlearn.WordSync.UndoSaveFailed');
    const retry = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('mlearn.Global.TryAgain'));
    expect(retry).toBeDefined();

    // A settled failure must not strand the surface. Rating is gated by the
    // session contract (revealed encounter), never by the retraction: revealing
    // the next word must arm rating again even though the undo is still failed.
    expect(buttonByText('mlearn.Rating.Matrix.Fluent').disabled).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    expect(buttonByText('mlearn.Rating.Matrix.Fluent').disabled).toBe(false);
    expect(container.textContent).toContain('mlearn.WordSync.UndoSaveFailed');

    // Retrying re-runs the same retraction.
    retry!.click();
    await settle();
    await settle();
    expect(mockAppendRetractions.mock.calls.length).toBeGreaterThanOrEqual(2);
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
    expect(mockRatingObservation).toHaveBeenCalled();

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
    expect(mockRatingObservation).not.toHaveBeenCalled();
    (rows[1].querySelectorAll<HTMLButtonElement>('.rating-matrix__cell')[0]).click();
    await settle();

    // A reading miss fabricates no fluent evidence elsewhere: both rows hold
    // explicit misses under one attempt identity.
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'surface-reading', 'missed', expect.objectContaining({
      language: 'ja',
    }));
    expect(mockRatingObservation).toHaveBeenCalledTimes(2);
    const attemptIds = new Set(mockRatingObservation.mock.calls.map((call) => (call[3] as { attemptId?: string })?.attemptId));
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
      if (mockRatingObservation.mock.calls.length > 0) break;
    }
    await settle();

    expect(mockRatingObservation).toHaveBeenCalledWith(
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

    // No questions were answered: this is empty, not successful completion.
    expect(container.textContent).toContain('mlearn.WordSync.EmptyTitle');
    expect(container.textContent).toContain('mlearn.WordSync.ChangeFilters');
    expect(container.textContent).not.toContain('mlearn.WordSync.StartOver');
    container.querySelector<HTMLButtonElement>('.word-sync-recheck-btn')?.click();
    await settle();
    expect(mockCommonState.filterBuilderProps).not.toBeNull();
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
    expect(mockRatingObservation).toHaveBeenCalledWith('赤い', 'surface-reading', 'missed', expect.anything());

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
    expect(mockRatingObservation).not.toHaveBeenCalled();
    expect(container.textContent).toContain('赤い:あかい');

    // A fresh quality key records the selected outcome and rates exactly once.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }));
    await settle();
    expect(mockRatingObservation).toHaveBeenCalledTimes(1);
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
    expect(mockRatingObservation).toHaveBeenCalled();
    expect(mockRatingObservation.mock.calls[0][0]).toBe('يكتب');
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

  it('retains the visible filter when starting a new session after confirmation', async () => {
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
    mockCommonState.filterBuilderProps!.onChange([{ kind: 'operand', field: 'level', op: 'eq', value: '5' }]);
    await settle(); await settle();

    container.querySelector<HTMLButtonElement>('.word-sync-filter-toggle')?.click();
    await settle();

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

    expect(filterTokenShapes(mockCommonState.filterBuilderProps?.tokens ?? [])).toEqual([{ kind: 'operand', field: 'level', op: 'eq', value: '5' }]);
    expect(mockCommonState.buildWordSyncPreset).toHaveBeenCalledTimes(1);

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
