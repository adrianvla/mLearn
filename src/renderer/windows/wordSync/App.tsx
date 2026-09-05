import { Component, Show, createSignal, createMemo, createEffect, on, onMount, onCleanup, createResource, untrack } from 'solid-js';
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
import { ATTEMPT_QUALITIES, SRS_EASE, type AttemptQuality } from '../../../shared/constants';
import { prosodyVisible } from '../../../shared/prosodySettings';
import { hashWordSync } from '../../services/srsAlgorithm';
import { nextAttemptId, type AttemptId } from '../../../shared/knowledgeEvents';
import { ankiCacheVersion, isAnkiCacheFetched, refreshAnkiWordsCache } from '../../services/ankiWordsCache';
import { KnowledgeSkeleton } from '../../components/common';
import { getLogger } from '../../../shared/utils/logger';
import { fetchTranslation } from '../../hooks/useTranslation';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
import { getProsodyOverlayRenderer } from '../../utils/prosodyPresentation';
import { isRatingKeyIgnored, isUndoShortcut } from '../../utils/ratingShortcuts';
import type { WordProsodyOverlayData, WordRenderTextContext } from '../../utils/wordRenderText';
import {
  extractStudyCharacters,
  getCharacterStudyScripts,
  getFrequencyLevelLabel,
  getFrequencyLevelVisualRank,
  getLearningLanguageLevelForLanguage,
  sortFrequencyLevelsByDifficulty,
} from '../../../shared/languageFeatures';
import {
  wasExplicitlySyncRated,
  calculateCharacterStudyBoost,
  calculateWordWeight,
  isWordEligible,
  isWordSyncRecentlyRated,
  wordSyncPoolStatus,
} from './wordSyncPool';
import { extractProsodyFromTranslationData } from '../../utils/readingProsody';
import { getTestedAspects } from '../../../shared/languageFeatures';
import { calibrationPoolItem, selectNextEncounter } from '../../learning/engine';
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
  previousSeenAt: Record<string, number | undefined>;
  /** Attempt ids whose events must be retracted when this rating is undone. */
  attemptIds: AttemptId[];
  previousRatedCount: number;
  previousLastRating: AttemptQuality | null;
  previousSamplingLevel: number;
  previousLevelCursors: Map<number, number>;
}

// Bounded undo history mirroring flashcard review (MAX_UNDO_STACK_SIZE there is also 50).
const MAX_UNDO_STACK_SIZE = 50;

export const WordSyncContent: Component = () => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const log = getLogger('renderer.wordSync');
  const langCtx = useLanguage();
  const {
    store,
    isLoading,
    markWordSyncSeen,
    clearAllWordSyncSeen,
    restoreWordSyncRating,
    appendRetractions,
    recomputeWordKnowledgeFromEvidence,
    getWordKnowledge,
    getWordTrackingSync,
    getWordSyncSeenSnapshotForForms,
    getComprehensiveWordStatusWithSourceSync,
    getAspectStatus,
    recordAttempt,
    isKnowledgeReady,
  } = useFlashcards();

  // ─── State ───────────────────────────────────────────
  const [currentWord, setCurrentWord] = createSignal<PoolEntry | null>(null);
  // Bumped on every word presentation (pickNext), not merely on word changes:
  // a filter reselection can re-present the same word, and the rating control
  // must reset its drafts each presentation regardless.
  const [presentationCount, setPresentationCount] = createSignal(0);
  let wordShownAt = 0;
  const [samplingLevel, setSamplingLevel] = createSignal<number>(0);
  const [ratedCount, setRatedCount] = createSignal(0);
  const [lastRating, setLastRating] = createSignal<AttemptQuality | null>(null);
  const [finished, setFinished] = createSignal(false);
  const [filterTokens, setFilterTokens] = createSignal<FilterToken[]>([]);
  const [filterPresetInitialized, setFilterPresetInitialized] = createSignal(false);
  const [showTranslation, setShowTranslation] = createSignal(false);
  // Reveal-first gate (Anki-style): the prompt word is shown first; the first
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
  const [filterOpen, setFilterOpen] = createSignal(false);
  const [confirmRecheckOpen, setConfirmRecheckOpen] = createSignal(false);
  let filterTriggerRef: HTMLButtonElement | undefined;
  const closeFilter = () => {
    setFilterOpen(false);
    filterTriggerRef?.focus();
  };
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));

  const [sessionRatedSet, setSessionRatedSet] = createSignal(new Set<string>(), { equals: false });
  const [undoStack, setUndoStack] = createSignal<WordSyncUndoEntry[]>([]);

  // ─── Translation for current word ───────────────────
  const [translation] = createResource(
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
    const t = translation();
    if (!t?.data?.[0]) return '';
    const defs = t.data[0].definitions;
    return Array.isArray(defs) ? defs.join('; ') : defs;
  });

  // ─── Pool of eligible words grouped by level ────────
  const levelNames = createMemo(() => langCtx.getFreqLevelNames());
  const sortedLevels = createMemo(() =>
    sortFrequencyLevelsByDifficulty(Object.keys(levelNames()).map(Number), langCtx.currentLangData()),
  );

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

  // ─── Known character set for language-defined study scripts ─────
  const characterStudyScripts = createMemo(() => getCharacterStudyScripts(langCtx.currentLangData()));
  function buildKnownCharacterSetSnapshot(scripts: readonly string[], lang: string): Set<string> {
    if (scripts.length === 0) return new Set();

    const prefix = lang + ':';
    const result = new Set<string>();

    for (const [key, entry] of Object.entries(store.wordKnowledge)) {
      if (!key.startsWith(prefix)) continue;
      if (!wasExplicitlySyncRated(entry)) continue;
      if (entry.ease < SRS_EASE.DEFAULT_KNOWN) continue;
      for (const ch of extractStudyCharacters(entry.word, scripts)) {
        result.add(ch);
      }
    }

    return result;
  }

  // ─── Word pool ──────────────────────────────────────
  const [wordPool, setWordPool] = createSignal<Map<number, PoolEntry[]>>(new Map(), { equals: false });

  function buildWordPoolSnapshot(): Map<number, PoolEntry[]> {
    const freq = langCtx.getWordFrequency();
    const names = levelNames();
    const staleDaysMs = settings.wordSyncStaleLearningDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const studyScripts = characterStudyScripts();
    const ast = filterAst();
    const resolvers = filterResolvers();
    const lang = settings.language;
    const languageData = langCtx.currentLangData();

    return untrack(() => {
      const rated = sessionRatedSet();
      const characterSet = buildKnownCharacterSetSnapshot(studyScripts, lang);
      const groups = new Map<number, PoolEntry[]>();

      for (const [word, entry] of Object.entries(freq)) {
        if (rated.has(word)) continue;

        const storageWord = langCtx.getCanonicalFormForLanguage(lang, word);
        const lk = `${lang}:${hashWordSync(storageWord)}`;

        const knowledge = getWordKnowledge(lk);
        const seenRecently = isWordSyncRecentlyRated(knowledge, store.wordSyncSeen[lk], staleDaysMs, now);
        // Tier-2: the comprehensive resolver reads ONLY the evidence journal +
        // claims (wordKnowledge). There is no "anki bank" to delegate to — live
        // Anki matching is tracking, not knowledge. Words scheduled by another
        // tracker (built-in SRS flashcards or Anki) are excluded here as
        // teaching policy: Word Sync calibrates untracked words, and re-quizzing
        // words another scheduler already owns would double-schedule them.
        const resolved = getComprehensiveWordStatusWithSourceSync(word, lang);
        // Excluded words are teaching-policy removals, not knowledge — either way they
        // never enter the calibration pool.
        if (resolved.status === 'known' || resolved.excluded) continue;
        if (getWordTrackingSync(word, lang).tracker !== 'nothing') continue;
        const record = {
          status: wordSyncPoolStatus(resolved.status, Boolean(knowledge)),
          level: entry.raw_level,
          seenRecently,
        };

        if (ast.ok && ast.ast && !evaluateAst<unknown>(ast.ast, record, resolvers)) continue;

        if (!isWordEligible(knowledge, seenRecently, true, staleDaysMs, now)) continue;

        const characterStudyBoost = calculateCharacterStudyBoost(word, characterSet, studyScripts);
        const weight = calculateWordWeight(knowledge?.ease, characterStudyBoost);

        const lvl = entry.raw_level;
        if (!groups.has(lvl)) groups.set(lvl, []);
        groups.get(lvl)!.push({
          word,
          reading: entry.reading,
          level: lvl,
          levelName: getFrequencyLevelLabel(lvl, names, languageData),
          storageKey: lk,
          weight,
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
    setWordPool(groups);
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
    const levels = sortedLevels();
    if (levels.length === 0) { setFinished(true); setShowAnswer(false); setShowTranslation(false); return; }

    let lvl = samplingLevel();
    if (!levels.includes(lvl)) lvl = levels[0];

    const pool = wordPool();
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
        const decision = selectNextEncounter({
          preset: 'CALIBRATION',
          nowMs: Date.now(),
          wordSyncPoolItems: group.slice(cursor).map((entry) => (
            calibrationPoolItem(entry.storageKey, entry.word, settings.language, entry.weight)
          )),
        });
        const selectedIndex = decision?.action === 'DEFER'
          ? cursor
          : group.findIndex((entry, index) => index >= cursor && entry.storageKey === decision?.candidate.key);
        const nextIndex = selectedIndex >= cursor ? selectedIndex : cursor;
        if (nextIndex !== cursor) [group[cursor], group[nextIndex]] = [group[nextIndex], group[cursor]];
        levelCursors.set(tryLvl, cursor + 1);
        setSamplingLevel(tryLvl);
        wordShownAt = Date.now();
        setShowAnswer(false);
        setShowTranslation(false);
        setPresentationCount((c) => c + 1);
        setCurrentWord(group[cursor]);
        return;
      }
    }

    setFinished(true);
    setCurrentWord(null);
    setShowAnswer(false);
    setShowTranslation(false);
  }

  // Profile-mode submit: ONE logical attempt (one attemptId, one undo entry,
  // one advance) carrying N aspect observations. Every tested aspect has an
  // explicit claim here, so no prerequisite demonstration is inferred.
  function handleSubmitProfile(observations: readonly ProfileObservation[], opts?: RateOptions) {
    const w = currentWord();
    if (!w || observations.length === 0) return;
    // opts.easy is scheduler-only and Word Sync has no scheduler — the
    // recorded evidence (fluent) is identical either way, so it is ignored.
    void opts;

    const attemptId = nextAttemptId();
    const latencyMs = wordShownAt ? Date.now() - wordShownAt : undefined;
    let anyMissed = false;
    for (const observation of observations) {
      if (observation.quality === 'missed') anyMissed = true;
      recordAttempt(w.word, observation.aspect, observation.quality, {
        language: settings.language,
        method: observation.method,
        attemptId,
        origin: 'word-sync',
        ...(latencyMs !== undefined ? { latencyMs } : {}),
      });
    }

    setUndoStack((prev) => {
      const next = [
        ...prev,
        {
          word: w,
          language: settings.language,
          previousSeenAt: getWordSyncSeenSnapshotForForms(w.word, settings.language),
          attemptIds: [attemptId],
          previousRatedCount: ratedCount(),
          previousLastRating: lastRating(),
          previousSamplingLevel: samplingLevel(),
          previousLevelCursors: new Map(levelCursors),
        },
      ];
      if (next.length > MAX_UNDO_STACK_SIZE) next.shift();
      return next;
    });

    if (anyMissed) markWordSyncSeen(w.word, settings.language);

    setSessionRatedSet((s) => { s.add(w.word); return s; });
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

    pickNext();
  }

  function recheckAll() {
    clearAllWordSyncSeen();
    setFilterTokens(buildDefaultFilterPreset());
    setFinished(false);
    setRatedCount(0);
    setLastRating(null);
    setUndoStack([]);
    setSessionRatedSet(new Set<string>());
    setShowAnswer(false);
    setShowTranslation(false);
    levelCursors = new Map();

    const levels = sortedLevels();
    if (levels.length > 0) setSamplingLevel(levels[0]);
    queueMicrotask(() => {
      rebuildWordPool();
      pickNext();
    });
  }

  function undoLastWordSyncRating() {
    const stack = undoStack();
    const undoEntry = stack[stack.length - 1];
    if (!undoEntry) return;

    setUndoStack((prev) => prev.slice(0, -1));

    // Epistemic state = active evidence: retract, then let the projection
    // replay rebuild wordKnowledge. Only the policy cooldown map (seen) uses
    // a snapshot restore — it is not learner truth.
    appendRetractions(undoEntry.word.word, undoEntry.language, undoEntry.attemptIds);
    void recomputeWordKnowledgeFromEvidence(undoEntry.word.word, undoEntry.language);
    restoreWordSyncRating(undoEntry.previousSeenAt, undoEntry.language);
    setSessionRatedSet((rated) => {
      const next = new Set(rated);
      next.delete(undoEntry.word.word);
      return next;
    });
    setRatedCount(undoEntry.previousRatedCount);
    setLastRating(undoEntry.previousLastRating);
    setSamplingLevel(undoEntry.previousSamplingLevel);
    levelCursors = new Map(undoEntry.previousLevelCursors);
    setShowTranslation(false);
    setShowAnswer(false);
    setFinished(false);
    setCurrentWord(undoEntry.word);
    // Re-presenting the same word: bump the resetKey so the rating control
    // comes back collapsed with no stale drafts from the retracted attempt.
    setPresentationCount((c) => c + 1);
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

  createEffect(() => {
    // A store re-delivery re-opens the readiness gate: drop the session so the
    // pool and presented word rebuild from the reconciled store instead of
    // surviving stale.
    if (!isKnowledgeReady()) {
      if (initialized()) {
        // Reopen the session CLEAN: a store re-delivery reconciled the
        // knowledge the old session state was derived from — preserving part
        // of it (rated set without count, undo without snapshots) would mix
        // inconsistent state.
        setInitialized(false);
        setCurrentWord(null);
        setFinished(false);
        setRatedCount(0);
        setLastRating(null);
        setUndoStack([]);
        setSessionRatedSet(new Set<string>());
        setShowAnswer(false);
        setShowTranslation(false);
        levelCursors = new Map();
      }
      return;
    }

    if (!filterPresetInitialized() && Object.keys(levelNames()).length > 0) {
      setFilterTokens(buildDefaultFilterPreset());
      setFilterPresetInitialized(true);
      return;
    }

    if (!langCtx.isLoading() && !isLoading() && !initialized()) {
      setInitialized(true);
      const levels = sortedLevels();
      if (levels.length > 0) setSamplingLevel(levels[0]);
      rebuildWordPool();
      pickNext();
    }
  });

  // The pool snapshot is built untracked; anki syncs must refresh it or words the
  // cache just marked known keep appearing (and counts keep regressing) until restart.
  // defer + untracked guard: never rebuild on the init flip itself — pickNext has
  // already advanced cursors, and a reshuffle would re-present already-rated words.
  createEffect(on(ankiCacheVersion, () => {
    if (untrack(() => !initialized())) return;
    levelCursors = new Map();
    rebuildWordPool();
  }, { defer: true }));

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    // This window owns its pool exclusions, so it cannot wait for another
    // window to populate the Anki cache: without it, tracked words slip into
    // the pool until some other surface happens to refresh the cache. The
    // options must match the resolver's lookup signature (language + language
    // data + thresholds) or the primed entry misses the pool's own lookups.
    // The cache service deduplicates concurrent fetches and backs off failures.
    if (settings.use_anki && !isAnkiCacheFetched({
      language: settings.language,
      languageData: langCtx.currentLangData(),
      ankiLearningThreshold: settings.ankiLearningThreshold,
      ankiKnownThreshold: settings.ankiKnownThreshold,
    })) {
      void refreshAnkiWordsCache({
        language: settings.language,
        languageData: langCtx.currentLangData(),
        ankiLearningThreshold: settings.ankiLearningThreshold,
        ankiKnownThreshold: settings.ankiKnownThreshold,
      }).catch((e) => log.warn('anki cache refresh failed:', e));
    }
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
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

  const totalAvailable = createMemo(() => {
    let total = 0;
    for (const group of wordPool().values()) total += group.length;
    return total;
  });

  // The definition comes from the dictionary's chosen entry; pair it with that
  // entry's own reading (data[0].reading) so reading and definition belong to
  // the same sense. The freq-list primary may be a different sense (仏: ほとけ
  // Buddha vs ふつ France) and must not be glued to the wrong definition.
  const displayedReading = createMemo(() => {
    const w = currentWord();
    if (!w) return '';
    return translation()?.data?.[0]?.reading || w.reading;
  });

  const currentWordProsody = createMemo(() => {
    const w = currentWord();
    if (!w) return undefined;
    return extractProsodyFromTranslationData(translation() ?? undefined, langCtx.currentLangData(), displayedReading());
  });

  // Word Sync renders the word with the shared WordWithReading primitive and
  // its own decoration context — no flashcard-display components/classes.
  // Matrix rows: aspects THIS interaction tests (supplied aspects excluded — the
  // shared gate in languageFeatures owns the tested/supplied distinction).
  const testedAspects = createMemo(() => {
    const w = currentWord();
    if (!w) return ['meaning'] as const;
    return getTestedAspects({
      languageData: langCtx.currentLangData(),
      surface: w.word,
      hasReadingData: !!displayedReading(),
      hasProsodyData: !!currentWordProsody(),
    });
  });

  const wordColoredProsodyCtx: WordRenderTextContext = {
    languageData: langCtx.currentLangData,
    prosodyPosition: () => currentWordProsody()?.position ?? null,
    prosodyKnowledge: () => getAspectStatus(currentWord()?.word ?? '', 'prosody', settings.language),
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

  // "Additional information part of answer": when the answer is hidden, the
  // word itself renders as pure text — no prosody coloring, no reading.
  const pureWordMode = createMemo(() => additionalInfoInAnswer() && !showAnswer());

  return (
    <div class="word-sync">
    {/* Real loading only (language data or learner projection still hydrating):
        the shared skeleton owns that gap; once data is present the session
        renders exactly as before, with the body handling its own empty state. */}
    <Show when={!langCtx.isLoading() && !isLoading() && isKnowledgeReady()} fallback={<KnowledgeSkeleton variant="word-sync" />}>
      <div class="word-sync-header">
        <span class="word-sync-counter">
          {t('mlearn.WordSync.Progress', {
            rated: String(ratedCount()),
            total: String(totalAvailable()),
          })}
        </span>
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
            onChange={(tokens) => {
              setFilterTokens(tokens);
              levelCursors = new Map();
              setFinished(false);
              setLastRating(null);
              setUndoStack([]);
              queueMicrotask(() => {
                rebuildWordPool();
                pickNext();
              });
            }}
            evaluation={filterValidation()}
          />
        </Popover>
        <Show when={currentWord()}>
          <PillLabel level={currentWord()!.level} visualLevel={currentWordVisualLevel()}>
            {levelLabel()}
          </PillLabel>
        </Show>
      </div>

      <Show when={!finished()} fallback={
        <div class="word-sync-finished">
          <EmptyState
            title={t('mlearn.WordSync.FinishedTitle')}
            description={t('mlearn.WordSync.FinishedDescription', { count: String(ratedCount()) })}
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
            aspects={testedAspects()}
            keyboardMode={settings.ratingKeyboardMode}
            resetKey={`${currentWord()?.word ?? ''}:${presentationCount()}`}
            armed={showAnswer() && !!currentWord() && !finished()}
            onSubmit={handleSubmitProfile}
          />
        </div>


      </Show>

      <ConfirmDialog
        isOpen={confirmRecheckOpen()}
        onClose={() => setConfirmRecheckOpen(false)}
        onConfirm={recheckAll}
        title={t('mlearn.WordSync.RestartConfirmTitle')}
        message={t('mlearn.WordSync.RestartConfirmMessage')}
        variant="danger"
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
