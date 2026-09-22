import { projectedWordStatus } from '../../../shared/graph/targets';
import { surfaceEntityId } from '../../../shared/graph/load';
import { getLogger } from '../../../shared/utils/logger';
import { useKnowledgeProjections } from '../../hooks/useKnowledgeProjections';
import { Component, Show, batch, createSignal, createMemo, createEffect, on, onMount, onCleanup, createResource, untrack } from 'solid-js';
import {
  WindowWrapper,
  useLocalization,
  useSettings,
  useLanguage,
  useFlashcards,
} from '../../context';
import {
  Btn,
  ConfirmDialog,
  EmptyState,
  FilterBuilder,
  PillLabel,
  Popover,
  ToggleSwitch,
  buildWordSyncFields,
  buildWordSyncPreset,
  evaluateAst,
  parseTokens,
  validateTokens,
  type ExprNode,
  type FieldConfig,
  type FieldResolver,
  type FilterToken,
  type PaletteItem,
  type ProfileObservation,
  type RateOptions,
  type ValidationError,
} from '../../components/common';
import { WordWithReading } from '../../components/language-specific';
import { WordSyncRating } from './WordSyncRating';
import { TellMlearn, type AppliedLearnerClaim } from '../../components/common/TellMlearn/TellMlearn';
import type { LearnerClaimOp } from '../../services/learnerClaimsInterpreter';
import { buildClaimPromptContext } from '../../services/learnerClaimsInterpreter';
import { CAPABILITY_LABEL_KEYS, isValidCapabilityId } from '../../../shared/graph/access';
import type { WordStatus } from '../../../shared/constants';
import { ATTEMPT_QUALITIES, type AttemptQuality } from '../../../shared/constants';
import type { CapabilityKey } from '../../../shared/graph/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { coloredProsodyAllowedOnSurface, prosodyVisible } from '../../../shared/prosodySettings';
import { hashWordSync } from '../../services/srsAlgorithm';
import { nextAttemptId, type AttemptId, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { projectionStateForCapability } from '../../components/common/WordStatusPillKnowledge/knowledgeSummary';
import { KnowledgeSkeleton } from '../../components/common';
import { fetchTranslation } from '../../hooks/useTranslation';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { getProsodyOverlayRenderer } from '../../utils/prosodyPresentation';
import { isRatingKeyIgnored, isUndoShortcut } from '../../utils/ratingShortcuts';
import type { WordProsodyOverlayData, WordRenderTextContext } from '../../utils/wordRenderText';
import {
  getFrequencyLevelLabel,
  getFrequencyLevelVisualRank,
  getLearningLanguageLevelForLanguage,
  sortFrequencyLevelsByDifficulty,
  wordNeedsReadingAnnotation,
} from '../../../shared/languageFeatures';
import { wordSyncPoolStatus, wordSyncProbe } from './wordSyncPool';
import { extractProsodyFromTranslationData } from '../../utils/readingProsody';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { useKnowledgeProjection } from '../../hooks/useKnowledgeProjection';
import { selectNextEncounter } from '../../learning/engine';
import { getWordFormCandidates } from '../../../shared/utils/wordForms';
import { wordStorageKey } from '../../utils/wordLevelStats';
import { eventsVersion, queryLanguageKeys } from '../../services/knowledgeEvents';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../shared/encounterTiming';
import './WordSync.css';

interface PoolEntry {
  word: string;
  reading: string;
  level: number;
  levelName: string;
  storageKey: string;
  weight: number;
}

interface WordSyncUndoEntry {
  word: PoolEntry;
  language: string;
  /** Attempt ids whose events must be retracted when this rating is undone. */
  attemptIds: AttemptId[];
  previousRatedCount: number;
  previousExcludedAtPresentation: number;
  previousLastRating: AttemptQuality | null;
  previousSamplingLevel: number;
  previousLevelCursors: Map<number, number>;
}

// Bounded undo history mirroring flashcard review (MAX_UNDO_STACK_SIZE there is also 50).
const MAX_UNDO_STACK_SIZE = 50;

export const WordSyncContent: Component = () => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const langCtx = useLanguage();
  const {
    store,
    isLoading,
    appendRetractions,
    recomputeWordKnowledgeFromEvidence,
    setAccessClaim,
    setWordClaim,
    clearAccessClaim,
    recordAttempt,
    isKnowledgeReady,
  } = useFlashcards();


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
  const [samplingLevel, setSamplingLevel] = createSignal<number>(0);
  const [ratedCount, setRatedCount] = createSignal(0);
  const [lastRating, setLastRating] = createSignal<AttemptQuality | null>(null);
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
    setShowAnswer(true);
    setShowTranslation(true);
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
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));

  const [undoStack, setUndoStack] = createSignal<WordSyncUndoEntry[]>([]);

  // ─── Translation for current word ───────────────────
  const [translation, { refetch: refetchTranslation }] = createResource(
    () => currentWord()?.word,
    async (word) => {
      if (!word) return null;
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
    if (!t?.data?.[0]) return '';
    const defs = t.data[0].definitions;
    return Array.isArray(defs) ? defs.join('; ') : defs;
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
  const [excludedAtPresentation, setExcludedAtPresentation] = createSignal(0);
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
      ? { language: settings.language, version: eventsVersion() }
      : undefined),
    async (source: { language: string; version: number }) => new Set(await queryLanguageKeys(source.language)),
  );
  const journalKeysHealthy = createMemo(() => journalKeysResource.state === 'ready');
  const measuredStorageKeys = createMemo(() => new Set(Object.keys(store.wordKnowledge ?? {})));
  const projectionSurfaces = createMemo(() => {
    if (!poolPrepared() || !filterPresetInitialized() || sessionQueue()) return [];
    const filter = filterAst();
    if (!filter.ok) return [];
    // An errored resource throws on access: only a ready snapshot is read.
    const keys = new Set(journalKeysResource.state === 'ready' ? journalKeysResource() ?? [] : []);
    for (const key of measuredStorageKeys()) keys.add(key);
    if (keys.size === 0) return [];
    const lang = settings.language;
    const languageData = langCtx.currentLangData();
    const canonicalize = (word: string) => langCtx.getCanonicalFormForLanguage(lang, word);
    const variants = (word: string) => langCtx.getWordVariantsForLanguage(lang, word);
    // Match the writer-side identity exactly (LevelStudyTab convention):
    // journal keys are derived from getWordFormCandidates(...), so test
    // every candidate form's storage key, not just the canonical one.
    return [...wordPool().values()].flat().filter(entry => {
      const coarse = !filter.ast || ['untracked', '0', '1', '2'].some(status =>
        evaluateAst<unknown>(filter.ast!, { status, level: entry.level }, filterResolvers()));
      if (!coarse) return false;
      const candidates = getWordFormCandidates(entry.word, canonicalize, variants, { language: lang, languageData });
      return candidates.some((candidate) => keys.has(wordStorageKey(lang, candidate)));
    }).map(entry => entry.word);
  });
  const poolProjection = useKnowledgeProjections(() => isKnowledgeReady() && filterPresetInitialized() && poolPrepared() && !sessionQueue() && journalKeysHealthy()
    ? { language: settings.language, surfaces: projectionSurfaces() } : undefined);
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
    return poolPrepared() && !sessionQueue() && poolProjection.ready() && filterPresetInitialized() && journalKeysHealthy() && filter.ok ? {
      pool: wordPool(), tokens: filterTokens(),
      entries: [...wordPool().values()].flat(), projections, filter: filter.ast, revision,
      language: settings.language, data: langCtx.currentLangData(),
    } : undefined;
  }, async (input) => {
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
    return { eligible, filtered, noPrompt, pool: input.pool, tokens: input.tokens, revision: input.revision };
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
    const pool = sessionQueue();
    if (!pool || !isKnowledgeReady()) return;
    const levels = sortedLevels();
    if (levels.length === 0) { setCurrentWord(null); setFinished(true); setShowAnswer(false); setShowTranslation(false); return; }

    let lvl = samplingLevel();
    if (!levels.includes(lvl)) lvl = levels[0];

    const idx = levels.indexOf(lvl);

    // Build directional try order: current level first, then expand
    // outward biased by the last rating direction.
    const tryOrder: number[] = [lvl];
    for (let dist = 1; dist < levels.length; dist++) {
      const easierIdx = idx - dist;
      const harderIdx = idx + dist;
      if (lastRating() === 'fluent') {
        if (harderIdx < levels.length) tryOrder.push(levels[harderIdx]);
        if (easierIdx >= 0) tryOrder.push(levels[easierIdx]);
      } else {
        if (easierIdx >= 0) tryOrder.push(levels[easierIdx]);
        if (harderIdx < levels.length) tryOrder.push(levels[harderIdx]);
      }
    }

    for (const tryLvl of tryOrder) {
      const group = pool.get(tryLvl);
      if (!group || group.length === 0) continue;
      const cursor = levelCursors.get(tryLvl) ?? 0;
      if (cursor < group.length) {
        batch(() => {
          stopWordTiming();
          levelCursors.set(tryLvl, cursor + 1);
          setSamplingLevel(tryLvl);
          setTranslationSeenAtPrompt(false);
          setShowAnswer(false);
          setShowTranslation(false);
          setPresentationCount((c) => c + 1);
          trace('next card selected', { word: group[cursor].word, cursor, total: totalAvailable() });
          setCurrentWord(group[cursor]);
        });
        return;
      }
    }
    batch(() => {
      setFinished(true);
      setTranslationSeenAtPrompt(false);
      setCurrentWord(null);
      setShowAnswer(false);
      setShowTranslation(false);
    });
  }

  // One logical attempt and one reactive update: row writes must not repeatedly
  // rebuild knowledge consumers before the next word can render.
  const handleSubmitProfile = (observations: readonly ProfileObservation[], opts?: RateOptions) => batch(() => {
    const w = currentWord();
    // Same admission rule as the encounter: a ready projection rates
    // normally; a genuinely ABSENT one is the unmeasured shape (rated
    // through its identity-backed targets); a still-loading or errored
    // projection refuses (the encounter re-presents once it settles).
    const projection = currentProjection.projection();
    const unmeasured = projection === undefined && !currentProjection.loading();
    if (!w || (projection?.status !== 'ready' && !unmeasured) || observations.length === 0
      || observations.some((observation) => !testedAccesses().some((capability) => capability === observation.capability))) return;
    // opts.easy is scheduler-only and Word Sync has no scheduler — the
    // recorded evidence (fluent) is identical either way, so it is ignored.
    void opts;
    const attemptId = nextAttemptId();
    const timing = stopWordTiming();
    for (const observation of observations) {
      recordAttempt(w.word, observation.capability, observation.quality, {
        language: settings.language,
        method: observation.method,
        attemptId,
        origin: 'word-sync',
        ...(timing ? { timing } : {}),
        scaffolds: promptScaffolds(),
      });
    }

    setUndoStack((prev) => {
      const next = [
        ...prev,
        {
          word: w,
          language: settings.language,
          attemptIds: [attemptId],
          previousRatedCount: ratedCount(),
          previousExcludedAtPresentation: excludedAtPresentation(),
          previousLastRating: lastRating(),
          previousSamplingLevel: samplingLevel(),
          previousLevelCursors: new Map(levelCursors),
        },
      ];
      if (next.length > MAX_UNDO_STACK_SIZE) next.shift();
      return next;
    });


    trace('rating write', { word: w.word });
    setRatedCount((c) => c + 1);

    // The attempt's sampling direction follows its WORST aspect (the per-aspect
    // path used the single rated quality): missed < struggled < fluent on the
    // evidence ladder; easy is a scheduler preference on fluent, not a level.
    let worstQuality: AttemptQuality = 'fluent';
    for (const observation of observations) {
      if (ATTEMPT_QUALITIES.indexOf(observation.quality) < ATTEMPT_QUALITIES.indexOf(worstQuality)) {
        worstQuality = observation.quality;
      }
    }
    setLastRating(worstQuality);

    const levels = sortedLevels();
    const idx = levels.indexOf(samplingLevel());
    if (worstQuality === 'missed') {
      if (idx > 0) setSamplingLevel(levels[idx - 1]);
    } else if (worstQuality === 'fluent') {
      if (idx < levels.length - 1) setSamplingLevel(levels[idx + 1]);
    }
    // worst: struggled — the sampling level stays put.

    setCurrentWord(null);
    pickNext();
  });

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

  function recheckAll() {
    stopWordTiming();
    setSessionQueue(undefined);
    setCurrentWord(null);
    setExcludedAtPresentation(0);
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

  function undoLastWordSyncRating() {
    const stack = undoStack();
    const undoEntry = stack[stack.length - 1];
    if (!undoEntry) return;

    setUndoStack((prev) => prev.slice(0, -1));

    // Retract the observed attempt and replay projection; corrections retain their own undo.
    appendRetractions(undoEntry.word.word, undoEntry.language, undoEntry.attemptIds);
    void recomputeWordKnowledgeFromEvidence(undoEntry.word.word, undoEntry.language);
    setRatedCount(undoEntry.previousRatedCount);
    setExcludedAtPresentation(undoEntry.previousExcludedAtPresentation);
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
  }

  // ─── Keyboard shortcuts ─────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    const target = e.target;
    const buttonTarget = target instanceof HTMLElement && target.matches('button, [role="button"]');
    if (isUndoShortcut(e)) {
      e.preventDefault();
      undoLastWordSyncRating();
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (isRatingKeyIgnored(e) && !buttonTarget) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!finished() && currentWord() && !showAnswer()) reveal();
      return;
    }
    if (isRatingKeyIgnored(e)) return;

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
    stopWordTiming();
    setSessionQueue(undefined);
    setPoolPrepared(false);
    setInitialized(false);
    setFilterPresetInitialized(false);
    setCurrentWord(null);
    setFinished(false);
    setRatedCount(0);
    setExcludedAtPresentation(0);
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
        setSessionQueue(undefined);
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

  const totalAvailable = createMemo(() => Math.max(0, [...(sessionQueue()?.values() ?? [])].reduce((total, group) => total + group.length, 0) - excludedAtPresentation()));
  createEffect(on(() => eligibleWords.state === 'ready' ? eligibleWords() : undefined, result => {
    if (!result || sessionQueue() || result.pool !== wordPool() || result.tokens !== filterTokens()
      || result.revision !== scanRevision || !isKnowledgeReady() || !poolProjection.ready()) return;
    const queue = new Map([...result.pool].map(([level, group]) => [level, group.filter(entry => result.eligible.has(entry.word))]));
    batch(() => {
      setQueueSummary({ ignored: Math.max(0, Object.keys(langCtx.getWordFrequency()).length - [...result.pool.values()].reduce((sum, group) => sum + group.length, 0)), filtered: result.filtered, noPrompt: result.noPrompt });
      setExcludedAtPresentation(0);
      setSessionQueue(queue);
      levelCursors = new Map();
      trace('session queue created', { count: [...queue.values()].reduce((n, group) => n + group.length, 0) });
      untrack(pickNext);
    });
  }));

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
      setExcludedAtPresentation(count => count + 1);
      setCurrentWord(null);
      untrack(pickNext);
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
      setExcludedAtPresentation(count => count + 1);
      setCurrentWord(null);
      untrack(pickNext);
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

  return (
    <div class="word-sync">
      <div class="word-sync-header">
        <Show when={sessionQueue()}><span class="word-sync-counter">
          {t('mlearn.WordSync.Progress', {
            rated: String(ratedCount()),
            total: String(totalAvailable()),
          })}
        </span></Show>
        <Btn
          variant="ghost"
          size="sm"
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
        </Btn>
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
            onChange={(tokens) => batch(() => {
              setSessionQueue(undefined);
              setCurrentWord(null);
              setRatedCount(0);
              setUndoStack([]);
              setFilterTokens(tokens);
              levelCursors = new Map();
              setFinished(false);
              setLastRating(null);
              rebuildWordPool();
            })}
            evaluation={filterValidation()}
          />
        </Popover>
        <Show when={currentWord()}>
          <PillLabel level={currentWord()!.level} visualLevel={currentWordVisualLevel()}>
            {levelLabel()}
          </PillLabel>
        </Show>
      </div>

    {/* Real loading only (language data or learner projection still hydrating):
        the shared skeleton owns that gap; once data is present the session
        renders exactly as before, with the body handling its own empty state. */}
    <Show when={!langCtx.isLoading() && !isLoading() && isKnowledgeReady() && !!sessionQueue() && !projectionUnavailable() && (!currentWord() || testedAccesses().length > 0)} fallback={
      <Show when={projectionUnavailable()} fallback={
        <Show when={!filterValidation().ok} fallback={<KnowledgeSkeleton variant="word-sync" />}>
          <p role="alert">{t('mlearn.WordSync.InvalidFilter')}</p>
        </Show>
      }>
        <div class="word-sync-projection-error" role="alert">
          <p>{t('mlearn.WordSync.ProjectionUnavailable')}</p>
          <Btn variant="primary" onClick={retryKnowledgeProjections}>{t('mlearn.Global.TryAgain')}</Btn>
        </div>
      </Show>
    }>
      <details class="word-sync-queue-details">
        <summary>{t('mlearn.WordSync.QueueDetails')}</summary>
        <p>{t('mlearn.WordSync.QueueExplanation')}</p>
        <p>{t('mlearn.WordSync.QueueExclusions', { ignored: String(queueSummary().ignored), filtered: String(queueSummary().filtered), unavailable: String(queueSummary().noPrompt + excludedAtPresentation()) })}</p>
      </details>
      <Show when={!finished()} fallback={
        <div class="word-sync-finished">
          <EmptyState
            title={t(ratedCount() > 0 ? 'mlearn.WordSync.FinishedTitle' : 'mlearn.WordSync.EmptyTitle')}
            description={t(ratedCount() > 0 ? 'mlearn.WordSync.FinishedDescription' : 'mlearn.WordSync.EmptyDescription', { count: String(ratedCount()) })}
            variant="card"
          />
          <Btn
            variant="secondary"
            size="md"
            onClick={() => setConfirmRecheckOpen(true)}
            class="word-sync-recheck-btn"
          >
            {t('mlearn.WordSync.StartOver')}
          </Btn>
        </div>
      }>
        <Show when={currentWord()}>
          {(w) => (
            <div class="word-sync-card">
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
              <div class="word-sync-answer-options">
                <Btn
                  variant="ghost"
                  size="sm"
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
                </Btn>
                <ToggleSwitch
                  checked={additionalInfoInAnswer()}
                  onChange={setAdditionalInfoInAnswer}
                  label={t('mlearn.WordSync.AdditionalInfoInAnswer')}
                  size="sm"
                  class="word-sync-additional-info-toggle"
                />
              </div>
            </div>
          )}
        </Show>
        <div class="word-sync-actions">
          <WordSyncRating
            accesses={testedAccesses()}
            capabilityLabels={Object.fromEntries(testedAccesses().map((capability) => {
              const label = langCtx.currentLangData()?.learning?.capabilities?.[capability]?.label;
              return [capability, label];
            }).filter((entry): entry is [string, string] => entry[1] !== undefined))}
            focusedProbe={probe()?.focused}
            claims={Object.fromEntries(testedAccesses().map((capability) => [
              capability,
              currentWord() ? projectedAccess(capability).claim : undefined,
            ]))}
            keyboardMode={settings.ratingKeyboardMode}
            resetKey={`${currentWord()?.word ?? ''}:${presentationCount()}`}
            armed={showAnswer() && !!currentWord() && !finished()
              && (currentProjection.projection()?.status === 'ready'
                || (currentProjection.projection() === undefined && !currentProjection.loading()))}
            onSubmit={handleSubmitProfile}
          />
          <Show when={currentWord()}>
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
