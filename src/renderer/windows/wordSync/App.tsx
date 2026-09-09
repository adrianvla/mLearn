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
import { ATTEMPT_QUALITIES, SRS_EASE, type AttemptQuality } from '../../../shared/constants';
import type { CapabilityKind } from '../../../shared/graph/types';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import type { GraphRelatedNode } from '../../../shared/graph/ipc';
import type { WordSyncStatement } from './WordSyncRating';
import { coloredProsodyAllowedOnSurface, prosodyVisible } from '../../../shared/prosodySettings';
import { hashWordSync } from '../../services/srsAlgorithm';
import { nextAttemptId, type AttemptId, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
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
  wordNeedsReadingAnnotation,
} from '../../../shared/languageFeatures';
import {
  wasExplicitlySyncRated,
  calculateCharacterStudyBoost,
  calculateWordWeight,
  isWordEligible,
  isWordSyncRecentlyRated,
  wordSyncPoolStatus,
  hasSurfaceRecognitionAccess,
  isBridgeCandidate,
} from './wordSyncPool';
import { extractProsodyFromTranslationData } from '../../utils/readingProsody';
import { getTestedAccesses } from '../../../shared/languageFeatures';
import { useOptionalGraph } from '../../context';
import type { RatedCapability } from '../../utils/accessKnowledge';
import { calibrationPoolItem, selectNextEncounter } from '../../learning/engine';
import './WordSync.css';

/** One graph-attested character component of the presented word. */
interface WordCharacterComponent {
  /** Graph entity id (`${language}:char:${glyph}`) — the canonical claim address. */
  id: string;
  label: string;
}

interface PoolEntry {
  word: string;
  reading: string;
  level: number;
  levelName: string;
  storageKey: string;
  weight: number;
  /** Known lexical object with a missing written-form bridge (cheap sync win). */
  bridge: boolean;
}

interface WordSyncUndoEntry {
  word: PoolEntry;
  language: string;
  previousSeenAt: Record<string, number | undefined>;
  /** Attempt ids whose events must be retracted when this rating is undone. */
  attemptIds: AttemptId[];
  /** Accesses that received a CLAIM in this rating; undo withdraws them. */
  claimedAccesses: RatedCapability[];
  /** True when this rating set the whole-word claim; undo withdraws it. */
  wordClaimed: boolean;
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
    getAccessStatus,
    setAccessStatus,
    setWordClaim,
    clearAccessClaim,
    recordAttempt,
    isKnowledgeReady,
  } = useFlashcards();
  const graph = useOptionalGraph();

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
        // Excluded words are teaching-policy removals, not knowledge — either way
        // they never enter the calibration pool. A KNOWN word with a missing
        // written-form bridge is NOT excluded: reconstructing the learner
        // overlay is exactly Word Sync's job, and re-presenting it is a cheap
        // bridge completion, not re-teaching a novel lexical object.
        if (resolved.excluded) continue;
        const writtenAccess = hasSurfaceRecognitionAccess(knowledge);
        if (resolved.status === 'known' && writtenAccess) continue;
        if (getWordTrackingSync(word, lang).tracker !== 'nothing') continue;
        const record = {
          status: wordSyncPoolStatus(resolved.status, Boolean(knowledge)),
          level: entry.raw_level,
          seenRecently,
        };

        if (ast.ok && ast.ast && !evaluateAst<unknown>(ast.ast, record, resolvers)) continue;

        if (!isWordEligible(knowledge, seenRecently, true, staleDaysMs, now)) continue;

        const characterStudyBoost = calculateCharacterStudyBoost(word, characterSet, studyScripts);
        const bridge = isBridgeCandidate(resolved.status, writtenAccess, Boolean(knowledge));
        const weight = calculateWordWeight(knowledge?.ease, characterStudyBoost, bridge);

        const lvl = entry.raw_level;
        if (!groups.has(lvl)) groups.set(lvl, []);
        groups.get(lvl)!.push({
          word,
          reading: entry.reading,
          level: lvl,
          levelName: getFrequencyLevelLabel(lvl, names, languageData),
          storageKey: lk,
          weight,
          bridge,
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
            calibrationPoolItem(entry.storageKey, entry.word, settings.language, entry.weight, { bridge: entry.bridge })
          )),
        });
        const selectedIndex = decision?.action === 'DEFER'
          ? cursor
          : group.findIndex((entry, index) => index >= cursor && entry.storageKey === decision?.candidate.key);
        const nextIndex = selectedIndex >= cursor ? selectedIndex : cursor;
        if (nextIndex !== cursor) [group[cursor], group[nextIndex]] = [group[nextIndex], group[cursor]];
        batch(() => {
          levelCursors.set(tryLvl, cursor + 1);
          setSamplingLevel(tryLvl);
          wordShownAt = Date.now();
          setTranslationSeenAtPrompt(false);
          setShowAnswer(false);
          setShowTranslation(false);
          setPresentationCount((c) => c + 1);
        });
        setCurrentWord(group[cursor]);
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
      recordAttempt(w.word, observation.capability, observation.quality, {
        language: settings.language,
        method: observation.method,
        attemptId,
        origin: 'word-sync',
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        scaffolds: promptScaffolds(),
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
          claimedAccesses: [],
          wordClaimed: false,
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

  /**
   * Natural learner corrections ("I know this word when I hear it") — the
   * USER speaks in statements; mLearn encodes the epistemics: claims stay
   * claims, observed transfer stays evidence, and an access the statement
   * does not cover stays unmeasured. Statements complete the word like a
   * rating (one undo entry) and never fabricate evidence for untouched
   * accesses.
   */
  function handleStatement(statement: WordSyncStatement) {
    const w = currentWord();
    if (!w) return;
    const lang = settings.language;
    const attemptId = nextAttemptId();
    const claimedAccesses: RatedCapability[] = [];
    let wordClaimed = false;

    switch (statement.kind) {
      // Claim: spoken-form cue → lexical identity works.
      case 'known-spoken': {
        setAccessStatus(w.word, 'spoken-recognition', 'known', 'manual', lang);
        claimedAccesses.push('spoken-recognition');
        break;
      }
      // Claims: the lexical object is known through its sense; the written
      // surface is a missing bridge, NOT a wholly unknown word.
      case 'known-meaning-unknown-form': {
        setWordClaim(w.word, 'known', lang);
        wordClaimed = true;
        setAccessStatus(w.word, 'surface-recognition', 'unknown', 'manual', lang);
        claimedAccesses.push('surface-recognition');
        break;
      }
      // Claims per component character, addressed to the graph character
      // ENTITY (character-recognition: the glyph is familiar). No-op when the
      // graph provides no components.
      case 'known-characters': {
        for (const character of componentCharacters()) {
          setAccessStatus(character.label, 'character-recognition', 'known', 'manual', lang, undefined, { kind: 'character', id: character.id });
        }
        break;
      }
      // Evidence: the learner just demonstrated compositional transfer —
      // observed inference, never retroactive knowledge of the whole.
      case 'inferred-from-parts': {
        const latencyMs = wordShownAt ? Date.now() - wordShownAt : undefined;
        for (const capability of ['sense-recognition', 'surface-recognition'] as const) {
          recordAttempt(w.word, capability, 'fluent', {
            language: lang,
            method: 'inference',
            attemptId,
            origin: 'word-sync',
            ...(latencyMs !== undefined ? { latencyMs } : {}),
            scaffolds: promptScaffolds(),
          });
        }
        break;
      }
      // Claims: the written bridge works; pitch production is the weak spot.
      case 'readable-pitch-wrong': {
        setAccessStatus(w.word, 'surface-reading', 'known', 'manual', lang);
        claimedAccesses.push('surface-reading');
        setAccessStatus(w.word, 'prosodic-pattern', 'learning', 'manual', lang);
        claimedAccesses.push('prosodic-pattern');
        break;
      }
      // Claim: the written-form bridge explicitly does not exist (yet).
      case 'never-seen-form': {
        setAccessStatus(w.word, 'surface-recognition', 'unknown', 'manual', lang);
        claimedAccesses.push('surface-recognition');
        break;
      }
    }

    setUndoStack((prev) => {
      const next = [
        ...prev,
        {
          word: w,
          language: lang,
          previousSeenAt: getWordSyncSeenSnapshotForForms(w.word, lang),
          attemptIds: [attemptId],
          claimedAccesses,
          wordClaimed,
          previousRatedCount: ratedCount(),
          previousLastRating: lastRating(),
          previousSamplingLevel: samplingLevel(),
          previousLevelCursors: new Map(levelCursors),
        },
      ];
      if (next.length > MAX_UNDO_STACK_SIZE) next.shift();
      return next;
    });

    markWordSyncSeen(w.word, lang);
    setSessionRatedSet((s) => { s.add(w.word); return s; });
    setRatedCount((c) => c + 1);
    setLastRating('fluent');
    pickNext();
  }

  /** Graph character components of the current word (empty without graph data). */
  function componentCharacters(): WordCharacterComponent[] {
    // Filled from the graph resource; a synchronous read keeps statement
    // handling simple — the resource resolves when the word is presented.
    return characterComponents() ?? [];
  }

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
          // Open-world: any valid capability id (core or namespaced package
          // id) is a legitimate claim address — the journal validates the id
          // and the projection renders unknown ids inertly. Only the
          // whole-word sense path is reserved (it has no access row).
          const isValid = isValidCapabilityId(op.capability) && op.capability !== 'sense-recognition';
          if (!isValid) break;
          const capability = op.capability as RatedCapability;
          const before = getAccessStatus(w.word, capability, lang);
          // Undo restores the PRIOR CLAIM PRESENCE exactly — it never
          // converts evidence into a claim.
          const restorePriorClaim = () => {
            if (before.claim !== undefined) {
              setAccessStatus(w.word, capability, before.claim, 'manual', lang);
            } else {
              clearAccessClaim(w.word, capability, lang);
            }
          };
          if (op.op === 'setAccessClaim') {
            if (before.claim === op.status) break; // no-op: already claimed exactly so
            setAccessStatus(w.word, capability, op.status, 'manual', lang);
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
    for (const capability of [...testedAccesses(), 'spoken-recognition' as const]) {
      accessStates[capability] = getAccessStatus(w.word, capability, settings.language).status;
    }
    return buildClaimPromptContext({
      word: w.word,
      reading: displayedReading() || undefined,
      language: settings.language,
      accessStates,
      wordClaim: store.wordKnowledge[w.storageKey]?.claim ?? null,
      componentCharacters: componentCharacters().map((character) => character.label),
    });
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

    // Epistemic state = active evidence + active claims: retract the attempt
    // events, withdraw any claims this rating made, then let the projection
    // replay rebuild wordKnowledge. Only the policy cooldown map (seen) uses
    // a snapshot restore — it is not learner truth.
    appendRetractions(undoEntry.word.word, undoEntry.language, undoEntry.attemptIds);
    for (const capability of undoEntry.claimedAccesses) {
      clearAccessClaim(undoEntry.word.word, capability, undoEntry.language);
    }
    if (undoEntry.wordClaimed) {
      setWordClaim(undoEntry.word.word, null, undoEntry.language);
    }
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
  // Matrix rows: accesses THIS interaction tests (supplied information
  // excluded — the shared gate in languageFeatures owns the tested/supplied
  // distinction).
  const testedAccesses = createMemo<CapabilityKind[]>(() => {
    const w = currentWord();
    if (!w) return ['sense-recognition'];
    return [...getTestedAccesses({
      languageData: langCtx.currentLangData(),
      surface: w.word,
      hasReadingData: !!displayedReading(),
      hasProsodyData: !!currentWordProsody(),
    })];
  });

  // A spoken representation exists (kana/pronunciation data) — enables the
  // heard-it statement; the session itself never plays audio.
  const hasSpokenForm = createMemo(() => !!displayedReading());

  // Graph character components of the current word. Empty until a graph
  // builder emits has-character structure — the statement simply hides.
  const [characterComponents] = createResource(() => currentWord()?.word, async (word): Promise<WordCharacterComponent[]> => {
    if (graph.readiness() !== 'ready') return [];
    const lookup = await graph.lookupWord({ surface: word });
    const entry = lookup?.entries[0];
    if (!entry) return [];
    const related: GraphRelatedNode[] = await graph.getRelated(entry.id, ['has-character']);
    return related
      .filter((node: GraphRelatedNode) => node.kind === 'character')
      .map((node: GraphRelatedNode) => ({ id: node.id, label: node.label ?? '' }))
      .filter((component) => component.label.length > 0);
  });
  const hasCharacterComponents = createMemo(() => (characterComponents() ?? []).length > 0);

  const wordColoredProsodyCtx: WordRenderTextContext = {
    languageData: langCtx.currentLangData,
    prosodyPosition: () => currentWordProsody()?.position ?? null,
    prosodyKnowledge: () => getAccessStatus(currentWord()?.word ?? '', 'prosodic-pattern', settings.language),
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
            accesses={testedAccesses()}
            keyboardMode={settings.ratingKeyboardMode}
            resetKey={`${currentWord()?.word ?? ''}:${presentationCount()}`}
            scaffolds={promptScaffolds()}
            armed={showAnswer() && !!currentWord() && !finished()}
            hasSpokenForm={hasSpokenForm()}
            hasCharacterComponents={hasCharacterComponents()}
            onSubmit={handleSubmitProfile}
            onStatement={handleStatement}
          />
          <Show when={currentWord()}>
            <TellMlearn
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
