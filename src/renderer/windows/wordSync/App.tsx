import { projectedWordStatus } from '../../../shared/graph/targets';
import { pushUndo } from '../../learning/undoHistory';
import { surfaceEntityId } from '../../../shared/graph/load';
import { getLogger } from '../../../shared/utils/logger';
import { useKnowledgeProjections } from '../../hooks/useKnowledgeProjections';
import { Component, Show, batch, createSignal, createMemo, createEffect, on, onMount, onCleanup, createResource, untrack, For } from 'solid-js';
import {
  WindowWrapper,
  useLocalization,
  useSettings,
  useLanguage,
  useFlashcards,
} from '../../context';
import { Button, ConfirmDialog, EmptyState, FilterBuilder, Panel, PillLabel, Popover, RatingMatrix, ToggleSwitch, buildWordSyncFields, buildWordSyncPreset, evaluateAst, parseTokens, validateTokens, type ExprNode, type FieldConfig, type FieldResolver, type FilterToken, type PaletteItem, type ProfileObservation, type RateOptions, type ValidationError } from '../../components/common';
import { WordWithReading } from '../../components/language-specific';
import { TellMlearn, type AppliedLearnerClaim } from '../../components/common/TellMlearn/TellMlearn';
import type { LearnerClaimOp } from '../../services/learnerClaimsInterpreter';
import { buildClaimPromptContext } from '../../services/learnerClaimsInterpreter';
import { CAPABILITY_LABEL_KEYS, isValidCapabilityId } from '../../../shared/graph/access';
import type { WordStatus } from '../../../shared/constants';
import { worstAttemptQuality, type AttemptQuality } from '../../../shared/constants';
import type { CapabilityKey } from '../../../shared/graph/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { PendingRetraction } from '../../../shared/retractionRecovery';
import type { RetractionProjection } from '../../context/FlashcardContext';
import { coloredProsodyAllowedOnSurface, prosodyVisible } from '../../../shared/prosodySettings';
import { hashWordSync } from '../../services/srsAlgorithm';
import { openKnowledgeInspector } from '../../services/openKnowledgeInspector';
import { surfaceKnowledgeInspection } from '../../services/surfaceKnowledgeInspection';
import { type AttemptId, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { projectionStateForCapability } from '../../components/common/WordStatusPillKnowledge/knowledgeSummary';
import { KnowledgeLoadError, KnowledgeSkeleton } from '../../components/common';
import { fetchTranslation } from '../../hooks/useTranslation';
import { extractDefinitionValues } from '../../utils/translationCacheParsers';
import { useDictionaryTargetLanguage } from '../../hooks/useDictionaryTargetLanguage';
import { getProsodyOverlayRenderer } from '../../utils/prosodyPresentation';
import { isBlockedByPendingWrite, isNativeActivationTarget, isRatingKeyIgnored, isRevealKey, isUndoShortcut } from '../../utils/ratingShortcuts';
import type { WordProsodyOverlayData, WordRenderTextContext } from '../../utils/wordRenderText';
import {
  getFrequencyLevelLabel,
  getFrequencyLevelVisualRank,
  getLearningLanguageLevelForLanguage,
  isFrequencyLevelAtOrEasierThanTarget,
  sortFrequencyLevelsByDifficulty,
  wordNeedsReadingAnnotation,
} from '../../../shared/languageFeatures';
import { wordSyncPoolStatus, wordSyncProbe } from './wordSyncPool';
import { extractProsodyFromTranslationData } from '../../utils/readingProsody';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { useKnowledgeProjection } from '../../hooks/useKnowledgeProjection';
import { selectNextEncounter } from '../../learning/engine';
import { studySessionState } from '../../learning/studySession';
import { canRetryRetraction, isRetractionWriteBlocking, type RetractionWriteState } from '../../learning/undoHistory';
import { WriteStatusBanner } from '../../components/common';
import { createStudySessionController, inProcessStudySessionLocks, type StudySessionController, type StudySessionRecord } from '../../learning/studySessionController';
import { queryLanguageKeys, wordEventsVersion } from '../../services/knowledgeEvents';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../shared/encounterTiming';
import { getWordLevelStatus } from '../../utils/wordLevelStats';
import {
  createWordSyncAssessmentQueue,
  firstWordSyncAssessmentIndex,
  nextWordSyncAssessmentIndex,
  replayWordSyncAssessment,
  wordSyncAssessmentResult,
  type WordSyncAssessmentPool,
  type WordSyncAssessmentState,
} from '../../learning/wordSyncAssessment';
import type { DiagnosticQuality } from '../../learning/diagnosticSampling';
import './WordSync.css';

interface PoolEntry {
  word: string;
  reading: string;
  level: number;
  levelName: string;
  storageKey: string;
  weight: number;
}

interface WordQueueEntry { id: string; level?: number }

interface WordSessionMeta {
  samplingLevel: number;
  lastRating: AttemptQuality | null;
  assessment?: WordSyncAssessmentState;
}

interface WordAttemptPayload {
  language: string;
  observations: readonly ProfileObservation[];
  timing: AttemptTiming | null;
  scaffolds: AttemptScaffolds;
  assessmentQuality?: DiagnosticQuality;
}

type WordSession = StudySessionRecord<WordQueueEntry, WordAttemptPayload, never, WordSessionMeta>;
type WordController = StudySessionController<WordQueueEntry, WordAttemptPayload, never, WordSessionMeta>;

interface RatingWrite {
  word: PoolEntry;
  language: string;
  presentation: number;
  attemptId: AttemptId;
  observations: readonly ProfileObservation[];
  timing: AttemptTiming | null;
  scaffolds: AttemptScaffolds;
}

/**
 * The projection a Word Sync Undo puts back: the learner returned to the
 * position they were at before the rating being taken back.
 *
 * Opaque to the store and to the shared retraction protocol — this is
 * Word Sync's own vocabulary, carried inside the shared record so a reloaded
 * window can finish the Undo without one.
 */
interface WordSyncProjection {
  session: WordSession;
  ratedCount: number;
  lastRating: AttemptQuality | null;
  samplingLevel: number;
  levelCursors: [number, number][];
}

interface WordSyncUndoEntry {
  word: PoolEntry;
  language: string;
  /** Attempt ids whose events must be retracted when this rating is undone. */
  attemptIds: AttemptId[];
  previousRatedCount: number;
  previousLastRating: AttemptQuality | null;
  previousSamplingLevel: number;
  previousLevelCursors: Map<number, number>;
  previousSession?: WordSession;
}


export interface WordSyncContentProps {
  mode?: 'study' | 'assessment';
}

export const WordSyncContent: Component<WordSyncContentProps> = (props) => {
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const assessmentMode = () => props.mode === 'assessment';
  const langCtx = useLanguage();
  const {
    store,
    isLoading,
    recordPendingRetraction,
    completePendingRetraction,
    recoverPendingRetraction,
    registerRetractionProjection,
    recomputeWordKnowledgeFromEvidence,
    wordRetractionTarget,
    setAccessClaim,
    setWordClaim,
    clearAccessClaim,
    submitRating,
    isKnowledgeReady,
  } = useFlashcards();


  /** A retraction that is still being filed blocks the actions that would
   *  rewrite the same journal; a settled failure does not, so the learner's
   *  only route forward stays open. */
  const undoBlocking = () => isRetractionWriteBlocking(retractionWrite());

  /**
   * Whether there is a rating this surface could still take back.
   *
   * The stack is the memory signal, and `undoLastWordSyncRating` additionally
   * requires a live session and a prompt on screen, so the visible control
   * asks the same question the command does rather than a looser one. A
   * button that appears where the command would decline is a worse lie than
   * no button: the review surface gates on the same reason.
   */
  const canUndo = () => {
    if (undoStack().length === 0) return false;
    const controller = sessionController();
    return !!controller?.current() && !controller.current()?.pending && currentWord() !== null;
  };

  // ─── State ───────────────────────────────────────────
  const [currentWord, setCurrentWord] = createSignal<PoolEntry | null>(null);
  // Bumped on every word presentation (pickNext), not merely on word changes:
  // a filter reselection can re-present the same word, and the rating control
  // must reset its drafts each presentation regardless.
  const [presentationCount, setPresentationCount] = createSignal(0);
  // Active-engagement timer for the current prompt: blur/hidden pauses are
  // excluded from the recorded latency (shared encounter instrumentation).
  let wordTimer: EncounterTimer | null = null;

  const stopWordTiming = (): AttemptTiming | null => {
    const timing = wordTimer?.stop() ?? null;
    wordTimer?.dispose();
    wordTimer = null;
    return timing;
  };
  const [, setSamplingLevel] = createSignal<number>(0);
  const [ratedCount, setRatedCount] = createSignal(0);
  const [ratingWrite, setRatingWrite] = createSignal<RatingWrite | null>(null);
  // Undo is a durable write (it appends a retraction) and is reported as
  // one, through the same vocabulary as a rating. It previously collapsed to a
  // boolean that reset in a `finally`, so a refused retraction vanished with no
  // evidence and no retry.
  const [retractionWrite, setRetractionWrite] = createSignal<RetractionWriteState>(null);
  const [sessionController, setSessionController] = createSignal<WordController | null>(null);
  /**
   * Why the durable session write was refused, or null when it is fine.
   *
   * This used to be a bare boolean rendered as `WordSync.SaveFailed` — copy
   * for a *rating* that could not be saved. A refused session start has
   * nothing to do with a rating, so the learner was told "this rating could
   * not be saved" before answering anything. It is also set when a refused
   * assessment dismissal cannot be reported by the study fallback at all,
   * because a finished assessment keeps the shell gate true. One state, two
   * named reasons, each rendered where it actually happens.
   */
  const [sessionWriteFailure, setSessionWriteFailure] = createSignal<'start' | 'dismiss' | null>(null);
  const [assessmentReady, setAssessmentReady] = createSignal(false);
  const [assessmentPlan, setAssessmentPlan] = createSignal<WordSyncAssessmentPool[]>([]);
  let retrySessionStart: (() => void) | null = null;
  const [, setLastRating] = createSignal<AttemptQuality | null>(null);
  const [finished, setFinished] = createSignal(false);
  const [filterTokens, setFilterTokens] = createSignal<FilterToken[]>([]);
  const [filterPresetInitialized, setFilterPresetInitialized] = createSignal(false);
  const [showTranslation, setShowTranslation] = createSignal(false);
  // Reveal-first gate: the prompt word is shown first; the first
  // Space/Enter reveals the answer, the second submits the profile rating.
  const [showAnswer, setShowAnswer] = createSignal(false);
  const [additionalInfoInAnswer, setAdditionalInfoInAnswer] = createSignal(false);
  // Single reveal transition shared by keyboard (first Space/Enter) and pointer
  // (the visible translation/reveal control): arms the rating control and shows
  // the translation together, so both input paths reach the same ratable state.
  const reveal = () => {
    const controller = sessionController();
    const record = controller?.current();
    if (!controller || !record) return;
    void controller.reveal(record).then((accepted) => {
      if (accepted) {
        setShowAnswer(true);
        setShowTranslation(true);
      }
    });
  };
  // Whether the translation was visible BEFORE the reveal — part of the
  // retrieval-time scaffold snapshot below.
  const [translationSeenAtPrompt, setTranslationSeenAtPrompt] = createSignal(false);
  createEffect(() => {
    if (showTranslation() && !showAnswer()) setTranslationSeenAtPrompt(true);
  });
  const [filterOpen, setFilterOpen] = createSignal(false);
  const [confirmRecheckOpen, setConfirmRecheckOpen] = createSignal(false);
  let filterTriggerRef: HTMLButtonElement | undefined;
  const closeFilter = () => {
    setFilterOpen(false);
    filterTriggerRef?.focus();
  };
  const dictionaryTargetLanguage = useDictionaryTargetLanguage();

  const [undoStack, setUndoStack] = createSignal<WordSyncUndoEntry[]>([]);

  // ─── Translation for current word ───────────────────
  const [translation, { refetch: refetchTranslation }] = createResource(
    () => currentWord()?.word,
    async (word) => {
      if (!word || assessmentMode()) return null;
      return fetchTranslation(word, settings.language, {
        getCanonicalForm: langCtx.getCanonicalForm,
        getWordVariants: langCtx.getWordVariants,
        dictionaryTargetLanguage,
        languageData: langCtx.currentLangData,
      });
    },
  );

  const translationText = createMemo(() => {
    const t = translation.state === 'ready' ? translation() : undefined;
    return extractDefinitionValues(t?.data?.slice(0, 2), langCtx.currentLangData()).join('; ').trim();
  });

  // ─── Pool of eligible words grouped by level ────────
  const levelNames = createMemo(() => langCtx.getFreqLevelNames());

  const filterContext = createMemo<{ fields: FieldConfig<unknown>[]; paletteItems: PaletteItem[] }>(() =>
    buildWordSyncFields(levelNames(), t, langCtx.currentLangData()),
  );

  const filterResolvers = createMemo<Record<string, FieldResolver<unknown>>>(() => {
    const resolvers: Record<string, FieldResolver<unknown>> = {};
    for (const field of filterContext().fields) {
      resolvers[field.field] = field.resolver;
    }
    return resolvers;
  });

  const filterAst = createMemo<
    | { ok: true; ast: ExprNode | null }
    | { ok: false; errors: ValidationError[] }
  >(() => {
    const tokens = filterTokens();
    if (tokens.length === 0) return { ok: true, ast: null };

    const validation = validateTokens(tokens);
    if (!validation.ok) return { ok: false, errors: validation.errors };

    try {
      return { ok: true, ast: parseTokens(tokens) };
    } catch {
      return { ok: false, errors: [{ index: -1, message: 'parse_error' }] };
    }
  });

  const filterValidation = createMemo(() => {
    const result = filterAst();
    if (result.ok) return { ok: true as const };
    return { ok: false as const, errors: result.errors };
  });

  // ─── Word pool ──────────────────────────────────────
  const log = getLogger('renderer.wordSync');
  const trace = (phase: string, details: Record<string, unknown> = {}) => log.debug('session lifecycle', { phase, at: performance.now(), ...details });
  const [poolPrepared, setPoolPrepared] = createSignal(false);
  const [sessionQueue, setSessionQueue] = createSignal<Map<number, PoolEntry[]>>();
  const [wordPool, setWordPool] = createSignal<Map<number, PoolEntry[]>>(new Map(), { equals: false });
  // Level labels describe a package; they are not the inventory of its queue.
  const sortedLevels = createMemo(() => sortFrequencyLevelsByDifficulty([...wordPool().keys()], langCtx.currentLangData()));
  const [queueSummary, setQueueSummary] = createSignal({ ignored: 0, filtered: 0, noPrompt: 0 });

  // ─── F-N1 request bound: projections ONLY for evidence-bearing surfaces ──
  // A pool word without stored state is unmeasured by definition — its
  // projection is empty and materializing it wastes an IPC round-trip per
  // word per reload (≈49k surfaces on the German package → the archived
  // renderer OOM). The candidate set is the JOURNAL keys (epistemic source
  // of truth) unioned with the materialized store keys (conservative
  // superset over pre-journal legacy rows), intersected with the pool
  // surfaces that survive the filter's coarse status pre-check. Projections
  // are requested only AFTER the journal snapshot settles; while it loads
  // no request is issued and the session stays behind the shared skeleton.
  // If the snapshot query FAILS, the scan does not run (a journal-only
  // measured word must never look untracked and be re-taught) and the
  // resource retries on the next eventsVersion change — the LevelStudyTab
  // placement precedent for the same bound.
  const [journalKeysResource, { refetch: refetchJournalKeys }] = createResource(
    // The journal key snapshot is language-scoped and independent of the
    // package metadata: it needs the learning language and knowledge
    // readiness only — a ready pool must never stay blocked on nullable
    // metadata.
    () => (isKnowledgeReady() && !sessionQueue()
      ? { language: settings.language, version: wordEventsVersion() }
      : undefined),
    async (source: { language: string; version: number }) => new Set(await queryLanguageKeys(source.language)),
  );
  const journalKeysHealthy = createMemo(() => journalKeysResource.state === 'ready');
  const measuredStorageKeys = createMemo(() => new Set(Object.keys(store.wordKnowledge ?? {})));
  const evidenceKeys = createMemo(() => {
    const keys = new Set(journalKeysResource.state === 'ready' ? journalKeysResource() ?? [] : []);
    for (const key of measuredStorageKeys()) keys.add(key);
    return keys;
  });
  const projectionSurfaces = createMemo(() => {
    if (!poolPrepared() || !filterPresetInitialized() || sessionQueue()) return [];
    if (assessmentMode()) return [...wordPool().values()].flat().map((entry) => entry.word);
    const filter = filterAst();
    if (!filter.ok) return [];
    // Filter by package-declared level before asking the graph which pool
    // surfaces share evidence with a realized entry.
    return [...wordPool().values()].flat().filter(entry => {
      const coarse = !filter.ast || ['untracked', '0', '1', '2'].some(status =>
        evaluateAst<unknown>(filter.ast!, { status, level: entry.level }, filterResolvers()));
      return coarse;
    }).map(entry => entry.word);
  });
  const poolProjection = useKnowledgeProjections(() => isKnowledgeReady() && filterPresetInitialized() && poolPrepared() && !sessionQueue() && journalKeysHealthy()
    ? { language: settings.language, surfaces: projectionSurfaces(), evidenceKeys: [...evidenceKeys()] } : undefined);
  const projectionUnavailable = () => translation.state === 'errored' || journalKeysResource.state === 'errored' || eligibleWords.state === 'errored' || poolProjection.failed() || currentProjection.projection()?.status === 'error' || currentProjection.projection()?.status === 'not-installed';
  const retryKnowledgeProjections = () => {
    if (translation.state === 'errored') void Promise.resolve(refetchTranslation()).catch(() => {});
    if (journalKeysResource.state === 'errored') {
      void Promise.resolve(refetchJournalKeys()).catch(() => {});
    }
    if (eligibleWords.state === 'errored') void Promise.resolve(refetchEligibleWords()).catch(() => {});
    if (currentWord()) currentProjection.retry();
    else poolProjection.retry();
  };
  let scanRevision = 0;
  onCleanup(() => { scanRevision++; });
  const [eligibleWords, { refetch: refetchEligibleWords }] = createResource(() => {
    const revision = ++scanRevision;
    const projections = poolProjection.projections();
    const filter = filterAst();
    return poolPrepared() && !sessionQueue() && poolProjection.ready() && filterPresetInitialized() && journalKeysHealthy() && (filter.ok || assessmentMode()) ? {
      pool: wordPool(), tokens: filterTokens(),
      entries: [...wordPool().values()].flat(), projections, filter: filter.ok ? filter.ast : null, revision,
      language: settings.language, data: langCtx.currentLangData(), assessment: assessmentMode(),
    } : undefined;
  }, async (input) => {
    if (input.assessment) {
      const byLevel = new Map<number, string[]>();
      for (const level of sortedLevels()) byLevel.set(level, []);
      for (const entry of input.entries) {
        if (input.revision !== scanRevision) break;
        const projection = input.projections.get(entry.word);
        if (projection?.status === 'error') throw new Error('Knowledge projection unavailable');
        const status = projection ? getWordLevelStatus(projectedWordStatus(projection)) : 'untracked';
        if (status !== 'untracked') continue;
        const bucket = byLevel.get(entry.level);
        if (bucket && bucket.length < 6) bucket.push(entry.word);
      }
      const assessmentPools: WordSyncAssessmentPool[] = sortedLevels()
        .map((level) => ({
          level,
          label: input.pool.get(level)?.[0]?.levelName ?? String(level),
          words: byLevel.get(level) ?? [],
        }))
        .filter((pool) => pool.words.length > 0);
      const eligible = new Set(assessmentPools.flatMap((pool) => pool.words));
      return { eligible, assessmentPools, filtered: 0, noPrompt: 0, pool: input.pool, tokens: input.tokens, revision: input.revision };
    }
    trace('accelerator ready', { surfaces: input.projections.size });
    trace('filters applied', { tokens: input.tokens });
    const eligible = new Set<string>();
    let filtered = 0;
    let noPrompt = 0;
    let cursor = 0;
    const entries = input.entries;
    await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
      while (input.revision === scanRevision && cursor < entries.length) {
        const entry = entries[cursor++];
        const projection = input.projections.get(entry.word);
        // An explicit error/materialization failure is a real failure: never
        // admit on it. An ABSENT projection is an unmeasured surface — the
        // exact candidate Word Sync exists to teach — admitted via
        // identity-backed constructed targets (F-N1 bounded fan-out), with
        // possible derived from the pool's own reading so no translation is
        // fetched for absent entries (prosody is re-probed at presentation).
        if (projection?.status === 'error') throw new Error('Knowledge projection unavailable');
        const summary = projectedWordStatus(projection);
        if (input.filter && !evaluateAst<unknown>(input.filter, { status: wordSyncPoolStatus(summary.status, summary.basis), level: entry.level }, filterResolvers())) { filtered++; continue; }
        // ABSENT projection (unmeasured surface): admitted WITHOUT a
        // translation fetch — `possible` derives from the pool's own
        // reading; prosody is re-probed at presentation.
        if (!projection) {
          const absentPossible = getTestedAccesses({ languageData: input.data, surface: entry.word, hasReadingData: !!entry.reading, hasProsodyData: false });
          if (absentPossible.length === 0) { noPrompt++; continue; }
          const probe = wordSyncProbe(undefined, absentPossible, surfaceEntityId(input.language, hashWordSync(entry.word)));
          if (probe.targets.length && (!input.filter || evaluateAst<unknown>(input.filter, { status: probe.status, level: entry.level }, filterResolvers()))) eligible.add(entry.word);
          else noPrompt++;
          continue;
        }
        const reference = await fetchTranslation(entry.word, input.language, {
          getCanonicalForm: langCtx.getCanonicalForm, getWordVariants: langCtx.getWordVariants,
          dictionaryTargetLanguage, languageData: langCtx.currentLangData,
        });
        const reading = reference?.data?.[0]?.reading || entry.reading;
        const prosody = extractProsodyFromTranslationData(reference ?? undefined, input.data, reading);
        const possible = getTestedAccesses({ languageData: input.data, surface: entry.word, hasReadingData: !!reading, hasProsodyData: !!prosody });
        const probe = wordSyncProbe(projection, possible, surfaceEntityId(input.language, hashWordSync(entry.word)));
        if (probe.targets.length && (!input.filter || evaluateAst<unknown>(input.filter, { status: probe.status, level: entry.level }, filterResolvers()))) eligible.add(entry.word);
        else noPrompt++;
      }
    }));
    trace('candidate count', { count: eligible.size, revision: input.revision });
    return { eligible, assessmentPools: [] as WordSyncAssessmentPool[], filtered, noPrompt, pool: input.pool, tokens: input.tokens, revision: input.revision };
  });

  function buildWordPoolSnapshot(): Map<number, PoolEntry[]> {
    const freq = langCtx.getWordFrequency();
    const names = levelNames();
    const lang = settings.language;
    const languageData = langCtx.currentLangData();

    return untrack(() => {
      const groups = new Map<number, PoolEntry[]>();

      for (const [word, entry] of Object.entries(freq)) {

        const storageWord = langCtx.getCanonicalFormForLanguage(lang, word);
        const lk = `${lang}:${hashWordSync(storageWord)}`;

        // Structural/policy pool only. Knowledge admission waits for the same
        // on-demand projection as Inspect; no materialized-status fallback.
        if (store.ignoredWords[lk]) continue;

        const lvl = entry.raw_level;
        if (!groups.has(lvl)) groups.set(lvl, []);
        groups.get(lvl)!.push({
          word,
          reading: entry.reading,
          level: lvl,
          levelName: getFrequencyLevelLabel(lvl, names, languageData),
          storageKey: lk,
          weight: 1,
        });
      }

      for (const group of groups.values()) {
        weightedShuffle(group);
      }

      return groups;
    });
  }

  function rebuildWordPool(): Map<number, PoolEntry[]> {
    const groups = buildWordPoolSnapshot();
    batch(() => { setWordPool(groups); setPoolPrepared(true); });
    return groups;
  }

  function buildDefaultFilterPreset(): FilterToken[] {
    return buildWordSyncPreset(
      levelNames(),
      getLearningLanguageLevelForLanguage(settings, settings.language),
      langCtx.currentLangData(),
    );
  }

  let levelCursors = new Map<number, number>();
  let sessionEntriesByWord = new Map<string, PoolEntry>();

  // Reservoir-style weighted sampling: sortKey = -weight * random^(1/weight).
  // Higher-weight items land near the front proportionally more often
  // while still visiting every item eventually.
  function weightedShuffle(arr: PoolEntry[]) {
    arr.sort((a, b) => {
      const ka = -Math.pow(Math.random(), 1 / a.weight);
      const kb = -Math.pow(Math.random(), 1 / b.weight);
      return ka - kb;
    });
  }

  function pickNext() {
    const record = sessionController()?.current();
    if (!record || !isKnowledgeReady()) return;
    const selected = sessionEntriesByWord.get(record.queue[record.index]?.id ?? '') ?? null;
    if (selected && selected.word === currentWord()?.word) {
      setShowAnswer(record.revealed);
      return;
    }
    batch(() => {
      stopWordTiming();
      setCurrentWord(selected);
      setFinished(selected === null);
      setRatedCount(record.rated);
      setSamplingLevel(record.meta.samplingLevel);
      setLastRating(record.meta.lastRating);
      setTranslationSeenAtPrompt(false);
      setShowAnswer(record.revealed);
      setShowTranslation(false);
      if (selected) setPresentationCount((c) => c + 1);
    });
  }

  function skipCurrentWord() {
    const controller = sessionController();
    const record = controller?.current();
    if (!controller || !record) return;
    void controller.skip(record).then((accepted) => {
      if (accepted) pickNext();
    });
  }

  function nextWord(record: WordSession, outcome: 'rated' | 'skipped' | 'advanced', entriesByWord: Map<string, PoolEntry>): { index: number; meta: WordSessionMeta } {
    if (record.meta.assessment) {
      if (outcome === 'advanced') return { index: record.queue.length, meta: record.meta };
      const assessmentQueue = record.queue.map(({ id, level }) => {
        if (level === undefined) throw new Error('Word Sync assessment queue is missing its package level');
        return { id, level };
      });
      const next = nextWordSyncAssessmentIndex(
        assessmentQueue,
        record.index,
        record.meta.assessment,
        outcome,
        record.pending?.payload.assessmentQuality,
      );
      if (!next) throw new Error('Word Sync assessment history is invalid');
      return { index: next.index, meta: { ...record.meta, assessment: next.state } };
    }
    const levels = sortedLevels();
    if (levels.length === 0) return { index: record.queue.length, meta: record.meta };

    let lvl = record.meta.samplingLevel;
    if (!levels.includes(lvl)) lvl = levels[0];

    let quality = record.meta.lastRating;
    if (outcome === 'rated' && record.pending) {
      quality = worstAttemptQuality(record.pending.payload.observations.map((observation) => observation.quality));
      const previousLevel = levels.indexOf(lvl);
      if (quality === 'missed' && previousLevel > 0) lvl = levels[previousLevel - 1];
      else if (quality === 'fluent' && previousLevel < levels.length - 1) lvl = levels[previousLevel + 1];
    }

    const idx = levels.indexOf(lvl);

    // Build directional try order: current level first, then expand
    // outward biased by the last rating direction.
    const tryOrder: number[] = [lvl];
    for (let dist = 1; dist < levels.length; dist++) {
      const easierIdx = idx - dist;
      const harderIdx = idx + dist;
      if (quality === 'fluent') {
        if (harderIdx < levels.length) tryOrder.push(levels[harderIdx]);
        if (easierIdx >= 0) tryOrder.push(levels[easierIdx]);
      } else {
        if (easierIdx >= 0) tryOrder.push(levels[easierIdx]);
        if (harderIdx < levels.length) tryOrder.push(levels[harderIdx]);
      }
    }

    const visited = new Set(record.visited);
    const firstByLevel = new Map<number, number>();
    record.queue.forEach((item, index) => {
      const level = entriesByWord.get(item.id)?.level;
      if (level !== undefined && !visited.has(index) && !firstByLevel.has(level)) firstByLevel.set(level, index);
    });
    for (const tryLvl of tryOrder) {
      const nextIndex = firstByLevel.get(tryLvl);
      if (nextIndex !== undefined) return { index: nextIndex, meta: { samplingLevel: tryLvl, lastRating: quality } };
    }
    return { index: record.queue.length, meta: { samplingLevel: lvl, lastRating: quality } };
  }

  function createWordController(
    identity: string,
    storageKey: string,
    entryByWord: Map<string, PoolEntry>,
    assessment: boolean,
  ): WordController {
    return createStudySessionController<WordQueueEntry, WordAttemptPayload, never, WordSessionMeta>({
      storageKey,
      lockKey: storageKey,
      locks: globalThis.navigator?.locks ?? inProcessStudySessionLocks,
      storage: globalThis.localStorage,
      validate: (record) => record.identity === identity
        && (assessment ? record.meta.assessment !== undefined : record.meta.assessment === undefined)
        && (!assessment || (record.meta.assessment !== undefined
          && replayWordSyncAssessment(record.meta.assessment) !== null
          && JSON.stringify(record.queue) === JSON.stringify(createWordSyncAssessmentQueue(record.meta.assessment.pools))))
        && record.queue.every((item) => entryByWord.has(item.id)),
      shouldSkipAttempt: (_pending, record) => {
        const word = entryByWord.get(record.queue[record.index]?.id ?? '');
        return !word || !!store.ignoredWords[word.storageKey];
      },
      writeAttempt: async (pending, record) => {
        const word = record.queue[pending.index]?.id;
        if (!word) throw new Error('Reserved Word Sync item is missing');
        const isAssessment = record.meta.assessment !== undefined;
        await submitRating(word, pending.payload.observations, {
          language: pending.payload.language,
          attemptId: pending.attemptId,
          origin: isAssessment ? 'placement' : 'word-sync',
          ...(isAssessment ? { taskType: 'placement' } : {}),
          ...(pending.payload.timing ? { timing: pending.payload.timing } : {}),
          scaffolds: pending.payload.scaffolds,
        });
      },
      next: (record, outcome) => nextWord(record, outcome, entryByWord),
      onAcknowledged: (before, _after, pending) => {
        const word = entryByWord.get(before.queue[before.index].id);
        if (!word) return;
        setUndoStack((previous) => pushUndo(previous, {
          word,
          language: pending.payload.language,
          attemptIds: [pending.attemptId],
          previousRatedCount: before.rated,
          previousLastRating: before.meta.lastRating,
          previousSamplingLevel: before.meta.samplingLevel,
          previousLevelCursors: new Map(levelCursors),
          previousSession: { ...before, pending: undefined, revealed: false },
        }));
      },
    });
  }

  // One logical attempt and one reactive update: row writes must not repeatedly
  // rebuild knowledge consumers before the next word can render.
  const commitProfileRating = async (write: Pick<RatingWrite, 'word' | 'language' | 'observations' | 'timing' | 'scaffolds'>): Promise<void> => {
    if (undoBlocking()) return;
    const controller = sessionController();
    const current = controller?.current();
    if (!controller || !current || current.queue[current.index]?.id !== write.word.word) return;
    const assessmentQuality = assessmentMode()
      ? write.observations.find((observation) => observation.capability === 'surface-recognition')?.quality as DiagnosticQuality | undefined
      : undefined;
    if (current.pending) {
      await controller.retry(current);
    } else {
      await controller.reserve(current, {
        language: write.language,
        observations: write.observations,
        timing: write.timing,
        scaffolds: write.scaffolds,
        ...(assessmentQuality ? { assessmentQuality } : {}),
      }, 'advance');
    }
    pickNext();
  };

  createEffect(on(() => sessionController()?.current()?.pending, (pending) => {
    if (!pending) { setRatingWrite(null); return; }
    const record = sessionController()?.current();
    const word = sessionEntriesByWord.get(record?.queue[pending.index]?.id ?? '');
    if (!word) return;
    setRatingWrite({
      word,
      language: pending.payload.language,
      presentation: presentationCount(),
      attemptId: pending.attemptId,
      observations: pending.payload.observations,
      timing: pending.payload.timing,
      scaffolds: pending.payload.scaffolds,
    });
  }));

  const handleSubmitProfile = (observations: readonly ProfileObservation[], opts?: RateOptions) => {
    const w = currentWord();
    const revealed = assessmentMode() ? sessionController()?.current()?.revealed === true : showAnswer();
    // Same admission rule as the encounter: a ready projection rates
    // normally; a genuinely ABSENT one is the unmeasured shape (rated
    // through its identity-backed targets); a still-loading or errored
    // projection refuses (the encounter re-presents once it settles).
    const projection = currentProjection.projection();
    const unmeasured = projection === undefined && !currentProjection.loading();
    if (!w || !revealed || (!assessmentMode() && (!translationText() || translation.state !== 'ready')) || ratingWrite() !== null || (projection?.status !== 'ready' && !unmeasured) || observations.length === 0
      || observations.some((observation) => !testedAccesses().some((capability) => capability === observation.capability))) return;
    // opts.easy is scheduler-only and Word Sync has no scheduler — the
    // recorded evidence (fluent) is identical either way, so it is ignored.
    void opts;
    void commitProfileRating({
      word: w,
      language: settings.language,
      observations: observations.map((observation) => ({ ...observation })),
      timing: stopWordTiming(),
      scaffolds: promptScaffolds(),
    });
  };

  // ─── "Tell mLearn…" — natural-language claim escape hatch ──────────
  // Statements become typed CLAIM ops; nothing here fabricates evidence,
  // and every applied op carries its inverse through the claim model.
  const STATUS_LABEL_KEYS: Record<WordStatus, string> = {
    known: 'mlearn.TellMlearn.Status.Known',
    learning: 'mlearn.TellMlearn.Status.Learning',
    unknown: 'mlearn.TellMlearn.Status.Unknown',
  };

  function applyLearnerClaims(ops: readonly LearnerClaimOp[]): AppliedLearnerClaim[] {
    const w = currentWord();
    if (!w) return [];
    const lang = settings.language;
    const applied: AppliedLearnerClaim[] = [];
    for (const op of ops) {
      switch (op.op) {
        case 'setAccessClaim':
        case 'clearAccessClaim': {
          // Every graph-applicable access, including Meaning, uses the same
          // claim path. A meaning claim must not become a whole-profile claim.
          const isValid = isValidCapabilityId(op.capability) && currentProjection.capabilities().includes(op.capability);
          if (!isValid) break;
          const capability = op.capability;
          const before = projectedAccess(capability);
          // Undo restores the PRIOR CLAIM PRESENCE exactly — it never
          // converts evidence into a claim.
          const restorePriorClaim = () => {
            if (before.claim !== undefined) {
              setAccessClaim(w.word, capability, before.claim, lang);
            } else {
              clearAccessClaim(w.word, capability, lang);
            }
          };
          if (op.op === 'setAccessClaim') {
            if (before.claim === op.status) break; // no-op: already claimed exactly so
            setAccessClaim(w.word, capability, op.status, lang);
            applied.push({
              labelKey: CAPABILITY_LABEL_KEYS[capability] ?? capability,
              statusKey: STATUS_LABEL_KEYS[op.status],
              undo: restorePriorClaim,
            });
          } else {
            if (before.claim === undefined) break; // nothing claimed — clearing would change nothing
            clearAccessClaim(w.word, capability, lang);
            applied.push({
              labelKey: CAPABILITY_LABEL_KEYS[capability] ?? capability,
              undo: restorePriorClaim,
            });
          }
          break;
        }
        case 'setWordClaim': {
          const previousClaim = store.wordKnowledge[w.storageKey]?.claim ?? null;
          if (previousClaim === op.status) break; // no-op: already claimed exactly so
          setWordClaim(w.word, op.status, lang);
          applied.push({
            labelKey: 'mlearn.TellMlearn.Word',
            statusKey: STATUS_LABEL_KEYS[op.status],
            undo: () => setWordClaim(w.word, previousClaim, lang),
          });
          break;
        }
        case 'clearWordClaim': {
          const previousClaim = store.wordKnowledge[w.storageKey]?.claim ?? null;
          if (previousClaim === null) break; // nothing claimed — clearing would change nothing
          setWordClaim(w.word, null, lang);
          applied.push({
            labelKey: 'mlearn.TellMlearn.Word',
            undo: () => setWordClaim(w.word, previousClaim, lang),
          });
          break;
        }
      }
    }
    return applied;
  }

  function currentClaimContext(): string {
    const w = currentWord();
    if (!w) return '';
    const accessStates: Record<string, WordStatus | undefined> = {};
    for (const capability of currentProjection.capabilities()) {
      accessStates[capability] = projectedAccess(capability).status;
    }
    return buildClaimPromptContext({
      word: w.word,
      reading: displayedReading() || undefined,
      language: settings.language,
      accessStates,
      wordClaim: store.wordKnowledge[w.storageKey]?.claim ?? null,
    });
  }

  async function recheckAll() {
    const controller = sessionController();
    const record = controller?.current();
    if (controller && record && !await controller.clear(record)) return;
    controller?.dispose();
    setSessionController(null);
    setSessionWriteFailure(null);
    retrySessionStart = null;
    stopWordTiming();
    setRatingWrite(null);
    setSessionQueue(undefined);
    setAssessmentReady(false);
    setAssessmentPlan([]);
    setCurrentWord(null);
    setFinished(false);
    setRatedCount(0);
    setLastRating(null);
    setUndoStack([]);
    setShowAnswer(false);
    setShowTranslation(false);
    levelCursors = new Map();

    const levels = sortedLevels();
    if (levels.length > 0) setSamplingLevel(levels[0]);
    rebuildWordPool();
  }

  async function undoLastWordSyncRating() {
    if (ratingWrite() !== null || undoBlocking()) return;
    const stack = undoStack();
    const undoEntry = stack[stack.length - 1];
    const controller = sessionController();
    const current = controller?.current();
    if (!undoEntry?.previousSession || !controller || !current || current.pending) return;
    setRetractionWrite('pending');
    try {
      // The observation is durable first; retrying uses the same persisted
      // attempt ids and the journal append is idempotent.
      //
      // A refusal here is a real, recoverable outcome, not an early return:
      // the rating stays applied and the learner must be able to see that and
      // try again. This write used to fall through a `finally` that simply
      // cleared a boolean, so a failed undo looked identical to a successful
      // one — the keystroke did nothing and said nothing.
      // Record the decision BEFORE retracting, so a reload between here and
      // completion can finish it. The undo stack is a memory signal: without
      // this the retraction was reachable only from the window that decided
      // it, and reloading left the rating applied with nothing able to take it
      // back — the retraction looked like it had simply never happened.
      const previousSession = undoEntry.previousSession;
      const record = wordSyncRetraction({ ...undoEntry, previousSession });
      if (!await recordPendingRetraction(record)) {
        // The record itself was refused: nothing has been retracted yet, so the
        // rating is untouched and the learner must be told rather than left
        // believing the undo landed.
        setRetractionWrite('failed');
        return;
      }
      // The session rewind is this surface's projection, and it goes through
      // the same protocol the recovery path uses — one owner, so an interactive
      // Undo and a recovered one cannot drift apart.
      const outcome = await completePendingRetraction(
        record,
        () => wordSyncProjection(controller, {
          session: previousSession,
          ratedCount: undoEntry.previousRatedCount,
          lastRating: undoEntry.previousLastRating,
          samplingLevel: undoEntry.previousSamplingLevel,
          levelCursors: [...undoEntry.previousLevelCursors.entries()],
        }),
      );
      if (outcome !== 'completed') {
        // Refused or superseded. Either way the rating is still applied and the
        // record is still there, so the learner is told and can try again —
        // which finishes this exact Undo, not a new one.
        setRetractionWrite('failed');
        return;
      }
      setRetractionWrite(null);

      setUndoStack((prev) => prev.slice(0, -1));

      // Retract the observed attempt and replay projection; corrections retain their own undo.
      await recomputeWordKnowledgeFromEvidence(undoEntry.word.word, undoEntry.language);
      setRatedCount(undoEntry.previousRatedCount);
      setLastRating(undoEntry.previousLastRating);
      setSamplingLevel(undoEntry.previousSamplingLevel);
      levelCursors = new Map(undoEntry.previousLevelCursors);
      batch(() => {
        setTranslationSeenAtPrompt(false);
        setShowTranslation(false);
        setShowAnswer(false);
        setFinished(false);
        setCurrentWord(undoEntry.word);
        // Re-presenting the same word: bump the resetKey so the rating control
        // comes back collapsed with no stale drafts from the retracted attempt.
        setPresentationCount((c) => c + 1);
      });
    } catch (error) {
      // Reported, not thrown: the failure is already durable state the banner
      // renders and can retry. Rethrowing would only add an unhandled rejection
      // on top of the same information.
      log.warn('Failed to persist Word Sync undo:', error);
      setRetractionWrite('failed');
    }
  }

  /**
   * This surface's projection: the learner goes back to where they were before
   * the rating being taken back.
   *
   * One definition, used by the interactive Undo and by a reloaded window
   * finishing an interrupted one. Building it is where the session rewind
   * happens — before the retraction record is cleared — so a rewind that
   * cannot be applied leaves the record standing and the next load retries,
   * rather than the Undo looking finished with the learner somewhere they
   * never chose.
   */
  const wordSyncProjection = async (
    controller: WordController,
    projection: WordSyncProjection,
  ): Promise<RetractionProjection> => {
    const session = controller.current();
    if (!session || !await controller.undo(session, projection.session)) {
      throw new Error('Word Sync undo could not restore the session position');
    }
    return () => {
      batch(() => {
        setRatedCount(projection.ratedCount);
        setLastRating(projection.lastRating);
        setSamplingLevel(projection.samplingLevel);
        levelCursors = new Map(projection.levelCursors);
        setFinished(false);
        setShowAnswer(false);
        setShowTranslation(false);
        setTranslationSeenAtPrompt(false);
        setPresentationCount((c) => c + 1);
      });
    };
  };

  /** This surface's record for a decided Undo. */
  const wordSyncRetraction = (undoEntry: WordSyncUndoEntry & { previousSession: WordSession }): PendingRetraction => ({
    attemptId: undoEntry.attemptIds.join(','),
    surface: 'word-sync',
    word: undoEntry.word.word,
    language: undoEntry.language,
    attemptIds: [...undoEntry.attemptIds],
    // Taken from the context rather than re-derived here, so a window finishing
    // an interrupted Undo writes its tombstones to the same form-family keys
    // this attempt actually landed under.
    target: wordRetractionTarget(undoEntry.word.word, undoEntry.language),
    restore: {
      session: undoEntry.previousSession,
      ratedCount: undoEntry.previousRatedCount,
      lastRating: undoEntry.previousLastRating,
      samplingLevel: undoEntry.previousSamplingLevel,
      levelCursors: [...undoEntry.previousLevelCursors.entries()],
    } satisfies WordSyncProjection,
  });

  /**
   * Finish an Undo that a previous window decided but did not complete.
   *
   * The undo stack is a memory signal, so a window that reloaded mid-undo used
   * to lose the ability to take that rating back entirely — the attempt stayed
   * in the journal and no surface could retract it. The durable record written
   * before the retraction is what makes the promise hold across a reload: the
   * retraction is completed here, and the session is put back where the learner
   * left it.
   *
   * It waits for the controller because restoring a session position is the
   * controller's write, and it is deliberately not offered as a choice — the
   * learner already asked for this undo; finishing it is completing their
   * request, not starting new work.
   */
  // How this surface puts its own state back. Registered rather than passed to
  // recovery so a reloaded window finishes an interrupted Undo by claiming the
  // record under its own tag, exactly as the review surface does — the shared
  // protocol does not need to know which surface an Undo came from.
  createEffect(() => {
    const controller = sessionController();
    if (!controller) return;
    const unregister = registerRetractionProjection('word-sync', async (record) => {
      const projection = record.restore as WordSyncProjection;
      // Rewinding the session is this surface's own durable write, so it
      // happens while the projection is being built — before the retraction
      // record is cleared. A refusal here throws, the record survives, and the
      // next load tries again, rather than the Undo looking finished with the
      // learner left somewhere they never chose.
      const session = controller.current();
      if (!session || !await controller.undo(session, projection.session)) {
        throw new Error('Word Sync undo recovery could not restore the session position');
      }
      return () => {
        batch(() => {
          setRatedCount(projection.ratedCount);
          setLastRating(projection.lastRating);
          setSamplingLevel(projection.samplingLevel);
          levelCursors = new Map(projection.levelCursors);
          setFinished(false);
          setShowAnswer(false);
          setShowTranslation(false);
          setTranslationSeenAtPrompt(false);
          setPresentationCount((c) => c + 1);
        });
      };
    });
    if (unregister) onCleanup(unregister);
  });

  // Finish an Undo a previous window decided but did not complete.
  createEffect(on(() => [isKnowledgeReady(), sessionController()] as const, ([ready, controller]) => {
    if (!ready || !controller) return;
    void recoverPendingRetraction();
  }));

  // ─── Keyboard shortcuts ─────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    if (isRatingKeyIgnored(e)) return;
    // A pending write blocks undo only; the rest of the surface stays live.
    if (isUndoShortcut(e)) {
      e.preventDefault();
      if (isBlockedByPendingWrite('undo', ratingWrite() !== null || undoBlocking())) return;
      void undoLastWordSyncRating();
      return;
    }
    if (isRevealKey(e)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!finished() && currentWord() && !showAnswer()) reveal();
      return;
    }
    if (ratingWrite() !== null || undoBlocking()) return;
    if (isNativeActivationTarget(e)) return;

    if (finished()) return;
    // Rating keys (whole-word digits and chords) belong to the rating control
    // only after reveal.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') {
      if (currentWord()) {
        e.preventDefault();
        if (!showAnswer()) reveal();
        else setShowTranslation((v) => !v);
      }
    }
  }

  // Guard: only pick the first word once, after language data AND the learner
  // projection have loaded — pool eligibility reads must not run against a
  // half-migrated store.
  const [initialized, setInitialized] = createSignal(false);
  // A session belongs to one language/package/target scope. Journal updates
  // revalidate the current prompt; a different scope starts a new session.
  createEffect(on(() => [settings.language, langCtx.getWordFrequency(), langCtx.currentLangData(), getLearningLanguageLevelForLanguage(settings, settings.language)] as const, () => batch(() => {
    sessionController()?.dispose();
    setSessionController(null);
    setSessionWriteFailure(null);
    retrySessionStart = null;
    stopWordTiming();
    setRatingWrite(null);
    setSessionQueue(undefined);
    setAssessmentReady(false);
    setAssessmentPlan([]);
    setPoolPrepared(false);
    setInitialized(false);
    setFilterPresetInitialized(false);
    setCurrentWord(null);
    setFinished(false);
    setRatedCount(0);
    setLastRating(null);
    setUndoStack([]);
    setShowAnswer(false);
    setShowTranslation(false);
    levelCursors = new Map();
  }), { defer: true }));

  createEffect(() => {
    // A store re-delivery re-opens the readiness gate: drop the session so the
    // pool and presented word rebuild from the reconciled store instead of
    // surviving stale.
    if (!isKnowledgeReady() || langCtx.isLoading() || isLoading()) {
      if (initialized()) {
        // Reopen the session CLEAN: a store re-delivery reconciled the
        // knowledge the old session state was derived from — preserving part
        // of it (rated set without count, undo without snapshots) would mix
        // inconsistent state.
        trace('projection not ready');
        sessionController()?.dispose();
        setSessionController(null);
        setSessionWriteFailure(null);
        retrySessionStart = null;
        setRatingWrite(null);
        setSessionQueue(undefined);
        setAssessmentReady(false);
        setAssessmentPlan([]);
        setPoolPrepared(false);
        setInitialized(false);
        setCurrentWord(null);
        setFinished(false);
        setRatedCount(0);
        setLastRating(null);
        setUndoStack([]);
        setShowAnswer(false);
        setShowTranslation(false);
        levelCursors = new Map();
      }
      return;
    }

    if (!filterPresetInitialized()) {
      setFilterTokens(buildDefaultFilterPreset());
      setFilterPresetInitialized(true);
      return;
    }

    if (!langCtx.isLoading() && !isLoading() && !initialized()) {
      trace('projection ready');
      setInitialized(true);
      const levels = sortedLevels();
      if (levels.length > 0) setSamplingLevel(levels[0]);
      rebuildWordPool();
      pickNext();
    }
  });

  onMount(() => window.addEventListener('keydown', handleKeyDown));
  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
    stopWordTiming();
    sessionController()?.dispose();
  });

  // ─── Derived display state ──────────────────────────
  const levelLabel = createMemo(() => {
    const w = currentWord();
    if (!w) return '';
    return w.levelName;
  });

  const currentWordVisualLevel = createMemo(() => {
    const w = currentWord();
    if (!w) return undefined;
    return getFrequencyLevelVisualRank(w.level, langCtx.getFreqLevelNames(), langCtx.currentLangData());
  });

  const skippedCount = createMemo(() => {
    const record = sessionController()?.current();
    return record ? Math.max(0, record.visited.length - record.rated) : 0;
  });
  const totalAvailable = createMemo(() => Math.max(0,
    (sessionController()?.current()?.queue.length
      ?? [...(sessionQueue()?.values() ?? [])].reduce((total, group) => total + group.length, 0)) - skippedCount(),
  ));
  const sessionPresentation = createMemo(() => studySessionState({
    ready: !!sessionController()?.current(),
    index: sessionController()?.current()?.rated ?? 0,
    total: totalAvailable(),
    revealed: sessionController()?.current()?.revealed ?? false,
    write: sessionController()?.current()?.pending?.state ?? null,
  }));
  createEffect(on(() => eligibleWords.state === 'ready' ? eligibleWords() : undefined, result => {
    if (!result || sessionQueue() || result.pool !== wordPool() || result.tokens !== filterTokens()
      || result.revision !== scanRevision || !isKnowledgeReady() || !poolProjection.ready()) return;
    const entryByWord = new Map([...result.pool.values()].flat().map((entry) => [entry.word, entry]));
    sessionEntriesByWord = entryByWord;

    if (assessmentMode()) {
      const pools = result.assessmentPools ?? [];
      setAssessmentPlan(pools);
      const entries = createWordSyncAssessmentQueue(pools);
      const queue = new Map<number, PoolEntry[]>(pools.map((pool) => [
        pool.level,
        pool.words.map((word) => entryByWord.get(word)).filter((entry): entry is PoolEntry => entry !== undefined),
      ]));
      const identity = JSON.stringify({
        language: settings.language,
        provider: settings.frequencyProviderSelections?.[settings.language],
        packageVersion: langCtx.currentLangData()?.languageData?.version,
      });
      const storageKey = `mlearn-study-word-sync-assessment:${settings.language}`;
      const controller = createWordController(identity, storageKey, entryByWord, true);
      setSessionController(controller);
      setAssessmentReady(true);
      setSessionWriteFailure(null);
      retrySessionStart = null;
      setQueueSummary({ ignored: 0, filtered: 0, noPrompt: 0 });
      const existing = controller.current();
      if (existing?.meta.assessment) {
        setAssessmentPlan(existing.meta.assessment.pools);
        const resumedQueue = new Map<number, PoolEntry[]>();
        for (const item of existing.queue) {
          const entry = entryByWord.get(item.id);
          if (!entry) continue;
          const group = resumedQueue.get(entry.level) ?? [];
          group.push(entry);
          resumedQueue.set(entry.level, group);
        }
        setSessionQueue(resumedQueue);
        pickNext();
      } else {
        setSessionQueue(queue);
        setCurrentWord(null);
        setFinished(false);
      }
      retrySessionStart = () => {
        const activeController = sessionController();
        if (!activeController || activeController.current()) return;
        if (pools.length === 0 || entries.length === 0) return;
        const state: WordSyncAssessmentState = { pools, draws: [] };
        const index = firstWordSyncAssessmentIndex(entries, state);
        void activeController.start(identity, entries, index, {
          samplingLevel: pools[0]?.level ?? 0,
          lastRating: null,
          assessment: state,
        }).then((accepted) => {
          setSessionWriteFailure(!accepted && !activeController.current() ? 'start' : null);
          if (activeController.current()) pickNext();
        });
      };
      return;
    }

    const queue = new Map([...result.pool].map(([level, group]) => [level, group.filter(entry => result.eligible.has(entry.word))]));
    const entries: WordQueueEntry[] = [...queue.values()].flat().map((entry) => ({ id: entry.word }));
    const identity = JSON.stringify({
      language: settings.language,
      provider: settings.frequencyProviderSelections?.[settings.language],
      // FilterBuilder IDs are presentation identities regenerated on mount.
      // Only the filter expression itself defines a durable study session.
      tokens: filterTokens().map(({ instanceId: _instanceId, ...token }) => token),
      packageVersion: langCtx.currentLangData()?.languageData?.version,
    });
    const controller = createWordController(identity, `mlearn-study-word-sync:${settings.language}`, entryByWord, false);
    setSessionController(controller);
    batch(() => {
      setQueueSummary({ ignored: Math.max(0, Object.keys(langCtx.getWordFrequency()).length - [...result.pool.values()].reduce((sum, group) => sum + group.length, 0)), filtered: result.filtered, noPrompt: result.noPrompt });
      setSessionQueue(queue);
      levelCursors = new Map();
      trace('session queue created', { count: [...queue.values()].reduce((n, group) => n + group.length, 0) });
    });
    const existing = controller.current();
    if (existing) {
      pickNext();
    } else {
      retrySessionStart = () => {
      void controller.start(identity, entries, entries.length > 0 ? 0 : entries.length, {
          samplingLevel: sortedLevels()[0] ?? 0,
          lastRating: null,
        }).then((accepted) => {
          setSessionWriteFailure(!accepted && !controller.current() ? 'start' : null);
          if (controller.current()) pickNext();
        });
      };
      retrySessionStart();
    }
  }));

  createEffect(on(() => sessionController()?.current(), () => untrack(pickNext)));

  // The definition comes from the dictionary's chosen entry; pair it with that
  // entry's own reading (data[0].reading) so reading and definition belong to
  // the same sense. The freq-list primary may be a different sense (仏: ほとけ
  // Buddha vs ふつ France) and must not be glued to the wrong definition.
  const displayedReading = createMemo(() => {
    const w = currentWord();
    if (!w) return '';
    return (translation.state === 'ready' ? translation() : undefined)?.data?.[0]?.reading || w.reading;
  });

  const currentWordProsody = createMemo(() => {
    const w = currentWord();
    if (!w) return undefined;
    return extractProsodyFromTranslationData((translation.state === 'ready' ? translation() : undefined) ?? undefined, langCtx.currentLangData(), displayedReading());
  });

  // Word Sync renders the word with the shared WordWithReading primitive and
  // its own decoration context — no flashcard-display components/classes.
  // Matrix rows: accesses THIS interaction tests (supplied information
  // excluded — the shared gate in languageFeatures owns the tested/supplied
  // distinction).
  const currentProjection = useKnowledgeProjection(() => {
    const word = currentWord();
    return word ? { language: settings.language, surface: word.word } : undefined;
  });
  // The encounter owns its tested set once admitted. Journal updates during
  // an active response must not silently change which question was asked.
  const [probe, setProbe] = createSignal<{ presentation: number; capabilities: CapabilityKey[]; focused: boolean }>();
  const testedAccesses = createMemo(() => probe()?.presentation === presentationCount() ? probe()!.capabilities : []);
  createEffect(on(() => [currentProjection.projection(), currentProjection.loading(), translation.loading, presentationCount(), store.ignoredWords[currentWord()?.storageKey ?? '']] as const, ([projection, projectionLoading, loading, presentation, ignored]) => {
    const w = currentWord();
    if (w && ignored) {
      skipCurrentWord();
      return;
    }
    if (assessmentMode()) {
      if (!w || projectionLoading || (projection?.status === 'error')) return;
      stopWordTiming();
      wordTimer = createEncounterTimer();
      wordTimer.start();
      setProbe({ presentation, capabilities: ['surface-recognition'], focused: false });
      const controller = sessionController();
      const record = controller?.current();
      if (controller && record && !record.revealed && !record.pending) {
        void controller.reveal(record).then((accepted) => {
          if (accepted && currentWord()?.word === w.word) setShowAnswer(true);
        });
      }
      return;
    }
    // Transient gate (F-N1): the single-surface hook resets its projection
    // to undefined while (re)materializing — an undefined value is only the
    // unmeasured shape once the hook has SETTLED (loading false). While it
    // loads the encounter waits instead of mis-admitting a measured word as
    // untracked.
    if (!w || loading || translation.state === 'errored' || projectionLoading
      || (probe()?.presentation === presentation && showAnswer())) return;
    // An explicit error/materialization failure is a real failure: never
    // admit on it (unchanged rule).
    if (projection?.status === 'error') return;
    const possible = getTestedAccesses({
      languageData: langCtx.currentLangData(), surface: w.word,
      hasReadingData: !!displayedReading(), hasProsodyData: !!currentWordProsody(),
    });
    trace('projection update', { word: w.word });
    // UNMEASURED admission (F-N1): wordSyncProbe treats an ABSENT projection
    // — and a ready graph-unmapped surface with unmeasured lexical state —
    // as unmeasured when the canonical entity id is supplied, constructing
    // identity-backed targets so a scan-admitted word is ratable at the
    // encounter too (previously an absent projection died silently here and
    // the word could never be rated).
    const admitted = wordSyncProbe(projection, possible, surfaceEntityId(settings.language, hashWordSync(w.word)));
    const targets = admitted.targets;
    const ast = filterAst();
    const record = { status: admitted.status, level: w.level };
    const decision = selectNextEncounter({
      preset: 'CALIBRATION', nowMs: Date.now(),
      wordSyncPoolItems: [{ key: w.storageKey, word: w.word, language: settings.language, targets, scores: { novelty: 1 } }],
    });
    if (targets.length === 0 || decision?.action === 'DEFER' || (ast.ok && ast.ast && !evaluateAst<unknown>(ast.ast, record, filterResolvers()))) {
      skipCurrentWord();
      return;
    }
    stopWordTiming();
    wordTimer = createEncounterTimer();
    wordTimer.start();
    trace('card rendered', { word: w.word, presentation, targets: targets.length });
    setProbe({ presentation: presentationCount(), capabilities: [...new Set(targets.map(target => target.capability))], focused: admitted.focused });
  }));

  const projectedAccess = (capability: string) => {
    const state = projectionStateForCapability(currentProjection.projection(), capability);
    const status: WordStatus = state?.classification === 'known' || state?.classification === 'learning' ? state.classification : 'unknown';
    return { status, ease: state?.strength?.ease ?? 0, claim: state?.basis === 'claim' ? status : undefined };
  };

  const wordColoredProsodyCtx: WordRenderTextContext = {
    languageData: langCtx.currentLangData,
    prosodyPosition: () => currentWordProsody()?.position ?? null,
    prosodyKnowledge: () => projectedAccess('prosodic-pattern'),
    partOfSpeechColor: () => undefined,
    surface: 'other',
    settings: () => settings,
  };
  const wordProsodyOverlay = createMemo<WordProsodyOverlayData | null>(() => {
    const prosody = currentWordProsody();
    if (!prosody || !prosodyVisible(settings)) return null;
    if (getProsodyOverlayRenderer(langCtx.currentLangData(), prosody.type) === null) return null;
    return {
      position: prosody.position ?? null,
      type: prosody.type,
      homogenous: true,
    };
  });

  // Retrieval-time scaffold snapshot: what the prompt actually SUPPLIED while
  // the learner retrieved (pre-reveal), recorded on every attempt so cued
  // accesses stay unmeasured instead of fabricating recall evidence. Prosody
  // errs conservative: faded/limited coloring still marks the scaffold (a
  // cued skip loses one probe; a fabricated recall would poison evidence).
  const promptScaffolds = createMemo<AttemptScaffolds>(() => {
    if (assessmentMode()) return {};
    const w = currentWord();
    if (!w) return {};
    const scaffolds: AttemptScaffolds = {};
    if (!additionalInfoInAnswer()) {
      if (displayedReading() && wordNeedsReadingAnnotation(w.word, displayedReading(), langCtx.currentLangData())) {
        scaffolds.reading = true;
      }
      if (
        currentWordProsody() !== undefined
        && (wordProsodyOverlay() !== null
          || (prosodyVisible(settings)
            && (settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled)
            && coloredProsodyAllowedOnSurface(settings, 'other')))
      ) {
        scaffolds.prosody = true;
      }
    }
    if (translationSeenAtPrompt()) scaffolds.translation = true;
    return scaffolds;
  });
  // "Additional information part of answer": when the answer is hidden, the
  // word itself renders as pure text — no prosody coloring, no reading.
  const pureWordMode = createMemo(() => additionalInfoInAnswer() && !showAnswer());
  const assessmentState = createMemo(() => sessionController()?.current()?.meta.assessment ?? null);
  const assessmentResult = createMemo(() => {
    const state = assessmentState();
    return state ? wordSyncAssessmentResult(state) : null;
  });
  const assessmentSampled = createMemo(() => assessmentState()?.draws.filter((draw) => draw.outcome !== 'skipped').length ?? 0);
  const assessmentLevel = createMemo(() => {
    const categoryId = assessmentResult()?.placement?.categoryId;
    if (categoryId === undefined) return null;
    const level = Number(categoryId);
    return Number.isFinite(level) ? level : null;
  });
  const assessmentMovesAhead = createMemo(() => {
    const level = assessmentLevel();
    const declaredLevel = getLearningLanguageLevelForLanguage(settings, settings.language);
    return level !== null && declaredLevel !== null
      && !isFrequencyLevelAtOrEasierThanTarget(level, declaredLevel, langCtx.currentLangData());
  });

  const applyAssessmentRecommendation = () => {
    const level = assessmentLevel();
    if (level === null) return;
    updateSettings({
      learningLanguageLevels: {
        ...(settings.learningLanguageLevels ?? DEFAULT_SETTINGS.learningLanguageLevels),
        [settings.language]: level,
      },
    });
  };

  const dismissAssessment = async () => {
    const controller = sessionController();
    const record = controller?.current();
    if (controller && record && !await controller.clear(record)) {
      // A refused clear discards nothing, so say so where the learner is
      // looking (the summary they just pressed Dismiss on) instead of
      // silently doing nothing.
      setSessionWriteFailure('dismiss');
      return;
    }
    setUndoStack([]);
    setCurrentWord(null);
    setFinished(false);
    setRatedCount(0);
    setShowAnswer(false);
    setShowTranslation(false);
    setSessionWriteFailure(null);
  };

  return (
    <div class="word-sync">
      <div class="word-sync-header">
        <Show when={assessmentMode()}><span class="word-sync-mode-title">{t('mlearn.LearningPlan.Assess')}</span></Show>
        <Show when={sessionQueue() && (!assessmentMode() || !!sessionController()?.current())}><span class="word-sync-counter">
          <Show when={assessmentMode()} fallback={t('mlearn.WordSync.Progress', {
            rated: String(sessionPresentation().completed),
            total: String(sessionPresentation().total),
          })}>
            {t('mlearn.LevelStudy.Placement.LiveProgress', { count: assessmentSampled() })}
          </Show>
        </span></Show>
        <Show when={!assessmentMode()}>
        <Button
          variant="default"
          size="sm"
          disabled={ratingWrite() !== null}
          ref={(element) => { filterTriggerRef = element; }}
          onClick={(e) => {
            filterTriggerRef = e.currentTarget;
            setFilterOpen((open) => !open);
          }}
          active={filterOpen()}
          aria-haspopup="true"
          aria-expanded={filterOpen()}
          class="word-sync-filter-toggle"
        >
          {t('mlearn.WordSync.Filter')}
        </Button>
        <Popover
          open={filterOpen}
          anchor={() => filterTriggerRef}
          onClose={closeFilter}
          label={t('mlearn.WordSync.Filter')}
          class="word-sync-filter-popover"
        >
          <FilterBuilder
            fields={filterContext().fields}
            paletteItems={filterContext().paletteItems}
            tokens={filterTokens()}
            onChange={(tokens) => {
              const controller = sessionController();
              const record = controller?.current();
              void (async () => {
                if (controller && record && !await controller.clear(record)) return;
                controller?.dispose();
                batch(() => {
                  setSessionController(null);
                  setSessionWriteFailure(null);
                  retrySessionStart = null;
                  setRatingWrite(null);
                  setSessionQueue(undefined);
                  setCurrentWord(null);
                  setRatedCount(0);
                  setUndoStack([]);
                  setFilterTokens(tokens);
                  levelCursors = new Map();
                  setFinished(false);
                  setLastRating(null);
                  rebuildWordPool();
                });
              })();
            }}
            evaluation={filterValidation()}
          />
        </Popover>
        </Show>
        <Show when={currentWord()}>
          <PillLabel level={currentWord()!.level} visualLevel={currentWordVisualLevel()}>
            {levelLabel()}
          </PillLabel>
        </Show>
        <Show when={currentWord()}>
          {(word) => <Button variant="default" size="sm" class="word-sync-inspect" onClick={() => {
            const surface = word().word;
            openKnowledgeInspector(surfaceKnowledgeInspection(settings.language, surface));
          }}>{t('mlearn.Knowledge.Popup.Inspect')}</Button>}
        </Show>
        <Show when={currentWord() && !assessmentMode()}>
          <TellMlearn
              resetKey={`${settings.language}:${currentWord()?.word ?? ''}:${presentationCount()}`}
              label={t('mlearn.TellMlearn.Label')}
              placeholder={t('mlearn.TellMlearn.Placeholder')}
              sendLabel={t('mlearn.TellMlearn.Send')}
              undoLabel={t('mlearn.TellMlearn.Undo')}
              updatedLabel={t('mlearn.TellMlearn.Updated')}
              noChangeLabel={t('mlearn.TellMlearn.NoChange')}
              errorLabel={t('mlearn.TellMlearn.Error')}
              buildContext={currentClaimContext}
              onApply={applyLearnerClaims}
              translate={t}
          />
        </Show>
      </div>

    {/* Keep the session shell mounted while the next prompt materializes. */}
    <Show when={!langCtx.isLoading() && !isLoading() && isKnowledgeReady() && !!sessionQueue()
      && (assessmentMode() ? assessmentReady() : !!sessionController()?.current()) && !projectionUnavailable()} fallback={
      <Show when={sessionWriteFailure() === 'start'} fallback={
        <Show when={projectionUnavailable()} fallback={
          <Show when={!assessmentMode() && !filterValidation().ok} fallback={<KnowledgeSkeleton variant="word-sync" />}>
            <p role="alert">{t('mlearn.WordSync.InvalidFilter')}</p>
          </Show>
        }>
          <KnowledgeLoadError
            message={t('mlearn.WordSync.ProjectionUnavailable')}
            onRetry={retryKnowledgeProjections}
            class="word-sync-projection-error"
          />
        </Show>
      }>
        <div class="word-sync-projection-error" role="alert">
          {/* Session start is not a rating: the saved answers are untouched
              and no word was ever shown, so the rating copy would be a lie. */}
          <p>{t('mlearn.WordSync.SessionStartFailed')}</p>
          <Button variant="primary" onClick={() => retrySessionStart?.()}>{t('mlearn.Global.TryAgain')}</Button>
        </div>
      </Show>
    }>
      <Show when={!assessmentMode()}>
      <details class="word-sync-queue-details">
        <summary>{t('mlearn.WordSync.QueueDetails')}</summary>
        <p>{t('mlearn.WordSync.QueueExplanation')}</p>
        <p>{t('mlearn.WordSync.QueueExclusions', { ignored: String(queueSummary().ignored), filtered: String(queueSummary().filtered), unavailable: String(queueSummary().noPrompt + skippedCount()) })}</p>
      </details>
      </Show>
      <Show when={assessmentMode() && !sessionController()?.current()}>
        <Panel class="word-sync-assessment-start" padding="md">
          <Show when={assessmentPlan().length > 0} fallback={
            <EmptyState title={t('mlearn.LevelStudy.Placement.EmptyPools')} variant="minimal" />
          }>
            <p>{t('mlearn.LevelStudy.Placement.Description')}</p>
            <Button variant="primary" size="md" onClick={() => retrySessionStart?.()}>
              {t('mlearn.LevelStudy.Placement.Start')}
            </Button>
          </Show>
        </Panel>
      </Show>
      <Show when={assessmentMode() && finished() && assessmentResult()}>
        {(result) => (
          <Panel class="word-sync-assessment-panel" padding="md">
          <section class="word-sync-assessment-summary" data-testid="word-sync-assessment-summary" aria-label={t('mlearn.LevelStudy.Placement.Title')}>
            <Show when={result().placement} fallback={
              <p class="word-sync-assessment-summary__placement word-sync-assessment-summary__placement--lowest">
                {t('mlearn.LevelStudy.Placement.PlacementLowest')}
              </p>
            }>
              <p class="word-sync-assessment-summary__placement">
                {t('mlearn.LevelStudy.Placement.Placement', { level: result().placement?.label ?? '' })}
              </p>
            </Show>
            <Show when={assessmentMovesAhead()}>
              <p>{t('mlearn.LevelStudy.Placement.MoveAhead')}</p>
            </Show>
            <ul class="word-sync-assessment-summary__trace">
              <For each={result().categories}>
                {(category) => (
                  <li data-category={category.categoryId}>
                    {t('mlearn.LevelStudy.Placement.TraceRow', {
                      label: category.label,
                      sampled: category.sampled,
                      hits: category.hits,
                      misses: category.misses,
                      skipped: category.skipped,
                    })}
                  </li>
                )}
              </For>
            </ul>
            <p>{t('mlearn.LevelStudy.Placement.EvidenceNote', { count: result().sampledCount })}</p>
            {/* A refused dismissal keeps this summary mounted, so the study
                layout's fallback never renders and the refusal would be
                invisible. It is reported here, next to the button that caused
                it, with a retry that is the same button. */}
            <Show when={sessionWriteFailure() === 'dismiss'}>
              <div class="word-sync-projection-error" role="alert">
                <p>{t('mlearn.WordSync.DismissFailed')}</p>
                <Button variant="primary" onClick={() => void dismissAssessment()}>
                  {t('mlearn.Global.TryAgain')}
                </Button>
              </div>
            </Show>
            <div class="word-sync-assessment-summary__actions">
              <Show when={assessmentLevel() !== null}>
                <Button variant="primary" onClick={applyAssessmentRecommendation}>
                  {t('mlearn.LevelStudy.Placement.UseLevel')}
                </Button>
              </Show>
              <Button variant="secondary" onClick={() => void dismissAssessment()}>
                {t('mlearn.LevelStudy.Placement.Dismiss')}
              </Button>
            </div>
          </section>
          </Panel>
        )}
      </Show>
      <Show when={assessmentMode() && !!sessionController()?.current() && !finished()}>
        <Show when={currentWord()}>
          {(word) => (
            <Panel class="word-sync-assessment-panel" padding="md">
            <section class="word-sync-assessment-card" aria-label={t('mlearn.LevelStudy.Placement.Title')}>
              <p class="word-sync-assessment-card__prompt" data-word={word().word}>
                {t('mlearn.LevelStudy.Placement.Prompt', { word: word().word })}
              </p>
              <WriteStatusBanner
                status={sessionPresentation().write}
                savingLabelKey="mlearn.WordSync.SavingRating"
                failedLabelKey="mlearn.WordSync.SaveFailed"
                canRetry={ratingWrite() !== null}
                onRetry={() => { const failed = ratingWrite(); if (failed) void commitProfileRating(failed); }}
              />
              <Show when={canUndo()}>
                <Button
                  buttonType="default"
                  variant="ghost"
                  size="xs"
                  disabled={ratingWrite() !== null || undoBlocking()}
                  onClick={() => { void undoLastWordSyncRating(); }}
                  title={t('mlearn.WordSync.UndoTooltip')}
                >
                  {t('mlearn.WordSync.Undo')}
                </Button>
              </Show>
              {/* Undo is reachable in assessment mode too (it shares the undo
                  stack), so its write must be reported here as well. */}
              <WriteStatusBanner
                status={retractionWrite()}
                savingLabelKey="mlearn.WordSync.SavingUndo"
                failedLabelKey="mlearn.WordSync.UndoSaveFailed"
                canRetry={canRetryRetraction(retractionWrite())}
                onRetry={() => { void undoLastWordSyncRating(); }}
              />
              <RatingMatrix
                capabilities={testedAccesses()}
                capabilityLabels={{}}
                keyboardMode={settings.ratingKeyboardMode}
                resetKey={`${word().word}:${presentationCount()}`}
                armed={sessionPresentation().canRate && !!currentWord() && !finished()
                  && ratingWrite() === null && !undoBlocking()
                  && (currentProjection.projection()?.status === 'ready'
                    || (currentProjection.projection() === undefined && !currentProjection.loading()))}
                onSubmit={handleSubmitProfile}
              />
              <Button variant="ghost" disabled={!sessionPresentation().canRate || ratingWrite() !== null || undoBlocking()} onClick={skipCurrentWord}>
                {t('mlearn.LevelStudy.Placement.Skip')}
              </Button>
            </section>
            </Panel>
          )}
        </Show>
      </Show>
      <Show when={!assessmentMode()}>
      <Show when={!finished()} fallback={
        <Panel class="word-sync-finished" padding="lg">
          <EmptyState
            title={t(ratedCount() > 0 ? 'mlearn.WordSync.FinishedTitle' : 'mlearn.WordSync.EmptyTitle')}
            description={t(ratedCount() > 0 ? 'mlearn.WordSync.FinishedDescription' : 'mlearn.WordSync.EmptyDescription', { count: String(ratedCount()) })}
            variant="minimal"
          />
          <Show when={ratedCount() > 0} fallback={
            <Button variant="primary" size="md" onClick={() => setFilterOpen(true)} class="word-sync-recheck-btn">
              {t('mlearn.WordSync.ChangeFilters')}
            </Button>
          }>
            <Button variant="secondary" size="md" onClick={() => setConfirmRecheckOpen(true)} class="word-sync-recheck-btn">
              {t('mlearn.WordSync.StartOver')}
            </Button>
          </Show>
        </Panel>
      }>
        <Show when={testedAccesses().length > 0} fallback={
          <Panel class="word-sync-card word-sync-card--pending" padding="none" role="status" aria-live="polite">
            <div class="word-sync-card__body word-sync-card__body--pending">{t('mlearn.Global.Loading')}</div>
          </Panel>
        }>
        <Show when={currentWord()}>
          {(w) => (
            <Panel class="word-sync-card" padding="none">
            <div class="word-sync-card__body">
              <div class="word-sync-word">
                <Show
                  when={pureWordMode()}
                  fallback={
                    <WordWithReading
                      word={w().word}
                      reading={displayedReading()}
                      language={settings.language}
                      languageData={langCtx.currentLangData()}
                      coloredProsody={wordColoredProsodyCtx}
                      prosodyOverlay={wordProsodyOverlay()}
                    />
                  }
                >
                  <span>{w().word}</span>
                </Show>
              </div>
              <Show when={showAnswer() && showTranslation() && translationText()}>
                <div class="word-sync-translation">{translationText()}</div>
              </Show>
              <Show when={showAnswer() && translation.state === 'ready' && !translationText()}>
                <div role="alert">
                  <p>{t('mlearn.WordSync.AnswerUnavailable')}</p>
                  {/* An unanswerable word cannot be rated, so retrying alone
                      leaves the session parked on it. Skipping is the way out,
                      the same escape the assessment surface offers. */}
                  <div class="word-sync-unavailable-actions">
                    <Button onClick={() => refetchTranslation()}>{t('mlearn.Global.TryAgain')}</Button>
                    <Button variant="ghost" onClick={skipCurrentWord}>{t('mlearn.WordSync.SkipWord')}</Button>
                  </div>
                </div>
              </Show>
              <div class="word-sync-answer-options">
                <Button
                  variant="default"
                  size="md"
                  onClick={() => {
                    if (!showAnswer()) {
                      reveal();
                    } else {
                      setShowTranslation((v) => !v);
                    }
                  }}
                  class="word-sync-translation-toggle"
                >
                  {showTranslation()
                    ? t('mlearn.WordSync.HideTranslation')
                    : t('mlearn.WordSync.ShowTranslation')}
                </Button>
                <ToggleSwitch
                  checked={additionalInfoInAnswer()}
                  onChange={setAdditionalInfoInAnswer}
                  label={t('mlearn.WordSync.AdditionalInfoInAnswer')}
                  size="sm"
                  class="word-sync-additional-info-toggle"
                />
              </div>
            </div>
            </Panel>
          )}
        </Show>
        <div class="word-sync-actions">
          {/* One rating model, one visible way to take it back. The review
              surface has always shown this; Word Sync had the machinery and
              only the keyboard, so the same action read as absent. */}
          <Show when={canUndo()}>
            <Button
              buttonType="default"
              variant="ghost"
              size="xs"
              class="word-sync-undo"
              disabled={ratingWrite() !== null || undoBlocking()}
              onClick={() => { void undoLastWordSyncRating(); }}
              title={t('mlearn.WordSync.UndoTooltip')}
            >
              {t('mlearn.WordSync.Undo')}
            </Button>
          </Show>
          <WriteStatusBanner
            status={sessionPresentation().write}
            savingLabelKey="mlearn.WordSync.SavingRating"
            failedLabelKey="mlearn.WordSync.SaveFailed"
            canRetry={ratingWrite() !== null}
            onRetry={() => { const failed = ratingWrite(); if (failed) void commitProfileRating(failed); }}
            class="word-sync-rating-write"
            failedClass="word-sync-rating-write--failed"
          />
          <WriteStatusBanner
            status={retractionWrite()}
            savingLabelKey="mlearn.WordSync.SavingUndo"
            failedLabelKey="mlearn.WordSync.UndoSaveFailed"
            canRetry={canRetryRetraction(retractionWrite())}
            onRetry={() => { void undoLastWordSyncRating(); }}
            class="word-sync-rating-write"
            failedClass="word-sync-rating-write--failed"
          />
          <RatingMatrix
            capabilities={testedAccesses()}
            capabilityLabels={Object.fromEntries(testedAccesses().map((capability) => {
              const label = langCtx.currentLangData()?.learning?.capabilities?.[capability]?.label;
              return [capability, label];
            }).filter((entry): entry is [string, string] => entry[1] !== undefined))}
            initiallyExpanded={probe()?.focused}
            claims={Object.fromEntries(testedAccesses().map((capability) => [
              capability,
              currentWord() ? projectedAccess(capability).claim : undefined,
            ]))}
            keyboardMode={settings.ratingKeyboardMode}
            resetKey={`${currentWord()?.word ?? ''}:${presentationCount()}`}
            armed={sessionPresentation().canRate && translation.state === 'ready' && !!translationText() && !!currentWord() && !finished()
              && ratingWrite() === null && !undoBlocking()
              && (currentProjection.projection()?.status === 'ready'
                || (currentProjection.projection() === undefined && !currentProjection.loading()))}
            onSubmit={handleSubmitProfile}
          />
        </div>

        </Show>


      </Show>
      </Show>

      <ConfirmDialog
        isOpen={confirmRecheckOpen()}
        onClose={() => setConfirmRecheckOpen(false)}
        onConfirm={recheckAll}
        title={t('mlearn.WordSync.RestartConfirmTitle')}
        message={t('mlearn.WordSync.RestartConfirmMessage')}
        variant="warning"
        confirmText={t('mlearn.WordSync.StartOver')}
      />
    </Show>
    </div>
  );
};

export const WordSyncApp: Component = () => {
  return (
    <WindowWrapper showDragRegion={true}>
      <WordSyncContent />
    </WindowWrapper>
  );
};
