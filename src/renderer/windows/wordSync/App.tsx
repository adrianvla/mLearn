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
  WORD_SYNC_STATUS_UNTRACKED,
  evaluateAst,
  parseTokens,
  validateTokens,
  type ExprNode,
  type FieldConfig,
  type FieldResolver,
  type FilterToken,
  type PaletteItem,
  type ValidationError,
} from '../../components/common';
import { WordWithReading } from '../../components/language-specific';
import { SRS_EASE, WORD_STATUS, KNOWLEDGE_ASPECT_LABEL_KEYS } from '../../../shared/constants';
import type { KnowledgeAspect } from '../../../shared/types';
import { prosodyVisible } from '../../../shared/prosodySettings';
import { hashWordSync } from '../../services/srsAlgorithm';
import { ankiCacheVersion } from '../../services/ankiWordsCache';
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
  THIRTY_DAYS_MS,
} from './wordSyncPool';
import { extractProsodyFromTranslationData } from '../../utils/readingProsody';
import { getAvailableAspects, type PassiveWordKnowledge } from '../../../shared/types';
import { isReadingScriptText } from '../../../shared/languageFeatures';
import { showToast } from '../../components/common/Feedback/Toast';
import './WordSync.css';

type Rating = 'unknown' | 'learning' | 'known';

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
  previousKnowledge: Record<string, PassiveWordKnowledge | undefined>;
  previousSeenAt: Record<string, number | undefined>;
  previousRatedCount: number;
  previousLastRating: Rating | null;
  previousSamplingLevel: number;
  previousLevelCursors: Map<number, number>;
  previousShowTranslation: boolean;
}

const RATING_EASE: Record<Rating, number> = {
  unknown: SRS_EASE.MIN,
  learning: SRS_EASE.DEFAULT_LEARNING,
  known: SRS_EASE.DEFAULT_KNOWN,
};

// Bounded undo history mirroring flashcard review (MAX_UNDO_STACK_SIZE there is also 50).
const MAX_UNDO_STACK_SIZE = 50;

export const WordSyncContent: Component = () => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const langCtx = useLanguage();
  const {
    store,
    isLoading,
    setWordKnowledgeEase,
    markWordSyncSeen,
    clearAllWordSyncSeen,
    restoreWordSyncRating,
    getWordKnowledge,
    getWordKnowledgeSnapshotForForms,
    getWordSyncSeenSnapshotForForms,
    getComprehensiveWordStatusWithSourceSync,
    attributeKnowledgeFailure,
  } = useFlashcards();

  // ─── State ───────────────────────────────────────────
  const [currentWord, setCurrentWord] = createSignal<PoolEntry | null>(null);
  const [samplingLevel, setSamplingLevel] = createSignal<number>(0);
  const [ratedCount, setRatedCount] = createSignal(0);
  const [lastRating, setLastRating] = createSignal<Rating | null>(null);
  const [finished, setFinished] = createSignal(false);
  const [filterTokens, setFilterTokens] = createSignal<FilterToken[]>([]);
  const [filterPresetInitialized, setFilterPresetInitialized] = createSignal(false);
  const [showTranslation, setShowTranslation] = createSignal(false);
  const [additionalInfoInAnswer, setAdditionalInfoInAnswer] = createSignal(false);
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
  const [pendingAttribution, setPendingAttribution] = createSignal(false);

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

  function isSyncSeenRecentlyByKey(lk: string, now: number): boolean {
    const ts = store.wordSyncSeen[lk];
    if (!ts) return false;
    return (now - ts) < THIRTY_DAYS_MS;
  }

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
        const seenRecently = isSyncSeenRecentlyByKey(lk, now);
        // Delegated to the comprehensive resolver (all banks, same precedence as the
        // editor/pill): a local cascade here froze the bank list once already — the
        // anki bank was missing and known-via-anki words kept entering the rotation.
        const resolved = getComprehensiveWordStatusWithSourceSync(word, lang);
        if (resolved.status === 'known') continue;
        const record = {
          status: resolved.status === 'learning'
            ? String(WORD_STATUS.LEARNING)
            // The resolver flattens unknown and never-encountered; the pool's untracked
            // bucket distinguishes them by this form's passive entry.
            : knowledge ? String(WORD_STATUS.UNKNOWN) : WORD_SYNC_STATUS_UNTRACKED,
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
    setPendingAttribution(false);
    const levels = sortedLevels();
    if (levels.length === 0) { setFinished(true); return; }

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
      if (lastRating() === 'known') {
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
        levelCursors.set(tryLvl, cursor + 1);
        setSamplingLevel(tryLvl);
        setCurrentWord(group[cursor]);
        return;
      }
    }

    setFinished(true);
    setCurrentWord(null);
  }

  function rate(rating: Rating) {
    // Unknown gates on attribution when the word carries reading/prosody data:
    // a narrow surface failure must not squash whole-word knowledge (mirrors
    // FlashcardReview's attribution row, P3.2). Key 1 = meaning = word-level write.
    if (rating === 'unknown' && hasAttributionTargets()) {
      setPendingAttribution(true);
      return;
    }
    applyRating(rating, 'meaning');
  }

  function applyRating(rating: Rating, aspect: 'meaning' | Exclude<KnowledgeAspect, 'meaning'>) {
    const w = currentWord();
    if (!w) return;
    setPendingAttribution(false);

    const previousKnowledge = getWordKnowledgeSnapshotForForms(w.word, settings.language);
    setUndoStack((prev) => {
      const next = [
        ...prev,
        {
          word: w,
          language: settings.language,
          previousKnowledge,
          previousSeenAt: getWordSyncSeenSnapshotForForms(w.word, settings.language),
          previousRatedCount: ratedCount(),
          previousLastRating: lastRating(),
          previousSamplingLevel: samplingLevel(),
          previousLevelCursors: new Map(levelCursors),
          previousShowTranslation: showTranslation(),
        },
      ];
      if (next.length > MAX_UNDO_STACK_SIZE) next.shift();
      return next;
    });

    if (aspect === 'meaning') {
      setWordKnowledgeEase(w.word, RATING_EASE[rating], displayedReading(), settings.language);
    } else {
      // Centralized hierarchical attribution: failed aspect → unknown, coarser
      // aspects (meaning, and reading when prosody failed) get positive evidence.
      attributeKnowledgeFailure(w.word, aspect, settings.language);
      showToast({
        message: t('mlearn.Flashcards.Review.Attribution.Marked', {
          aspect: t(KNOWLEDGE_ASPECT_LABEL_KEYS[aspect]),
        }),
        variant: 'success',
      });
    }

    if (rating === 'unknown') {
      markWordSyncSeen(w.word, settings.language);
    }

    setSessionRatedSet((s) => { s.add(w.word); return s; });

    setRatedCount((c) => c + 1);
    setLastRating(rating);

    const levels = sortedLevels();
    const idx = levels.indexOf(samplingLevel());

    if (rating === 'known' && idx < levels.length - 1) {
      setSamplingLevel(levels[idx + 1]);
    } else if (rating === 'unknown' && idx > 0) {
      setSamplingLevel(levels[idx - 1]);
    }

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

    restoreWordSyncRating(
      undoEntry.word.word,
      undoEntry.previousKnowledge,
      undoEntry.previousSeenAt,
      undoEntry.language,
    );
    setSessionRatedSet((rated) => {
      const next = new Set(rated);
      next.delete(undoEntry.word.word);
      return next;
    });
    setRatedCount(undoEntry.previousRatedCount);
    setLastRating(undoEntry.previousLastRating);
    setSamplingLevel(undoEntry.previousSamplingLevel);
    levelCursors = new Map(undoEntry.previousLevelCursors);
    setShowTranslation(undoEntry.previousShowTranslation);
    setFinished(false);
    setCurrentWord(undoEntry.word);
  }

  function shouldIgnoreWordSyncShortcut(e: KeyboardEvent): boolean {
    if (isRatingKeyIgnored(e)) return true;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return false;
    // A focused rating button must not double-fire on Space (native activation
    // + the window handler's translation toggle).
    return target.matches('button');
  }

  // ─── Keyboard shortcuts ─────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    if (shouldIgnoreWordSyncShortcut(e)) return;
    if (isUndoShortcut(e)) {
      e.preventDefault();
      undoLastWordSyncRating();
      return;
    }

    if (finished()) return;
    if (e.key === ' ' || e.code === 'Space') {
      if (currentWord()) {
        e.preventDefault();
        setShowTranslation((v) => !v);
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (pendingAttribution()) {
      if (e.key === 'Escape') setPendingAttribution(false);
      else if (e.key === '1') applyRating('unknown', 'meaning');
      else if (e.key === '2' && attributionTargets().reading) applyRating('unknown', 'reading');
      else if (e.key === '3' && attributionTargets().prosody) applyRating('unknown', 'prosody');
      else if (e.key === '4' && attributionTargets().orthography) applyRating('unknown', 'orthography');
      return;
    }
    if (e.key === '1') rate('unknown');
    else if (e.key === '2') rate('learning');
    else if (e.key === '3') rate('known');
  }

  // Guard: only pick the first word once, after language data has loaded.
  const [initialized, setInitialized] = createSignal(false);

  createEffect(() => {
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
  const attributionTargets = createMemo(() => {
    if (!currentWord()) return { reading: false, prosody: false, orthography: false };
    const w = currentWord()!;
    const supported = getAvailableAspects(langCtx.currentLangData() ?? undefined);
    // A surface written entirely in the reading script (e.g. もたれる) supplies the
    // reading directly: the interaction did not test it, so it cannot have been
    // failed. Conversely, form recognition is only testable where the surface is
    // NOT reading-transparent (文脈 yes, さようなら no).
    const surfaceSuppliesReading = isReadingScriptText(w.word, langCtx.currentLangData());
    return {
      reading: supported.includes('reading') && !!displayedReading() && !surfaceSuppliesReading,
      prosody: supported.includes('prosody') && !!currentWordProsody(),
      orthography: supported.includes('orthography') && !surfaceSuppliesReading,
    };
  });
  const hasAttributionTargets = () => (
    attributionTargets().reading || attributionTargets().prosody || attributionTargets().orthography
  );

  const comprehensiveKnowledge = createMemo(() => {
    const w = currentWord();
    if (!w) return { status: 'unknown' as const, source: 'None' as const, timesSeen: 0, ease: undefined };
    return getComprehensiveWordStatusWithSourceSync(w.word, settings.language);
  });
  const wordIsKnown = createMemo(() => comprehensiveKnowledge().status === 'known');
  const wordColoredProsodyCtx: WordRenderTextContext = {
    languageData: langCtx.currentLangData,
    prosodyPosition: () => currentWordProsody()?.position ?? null,
    ease: () => comprehensiveKnowledge().ease,
    partOfSpeechColor: () => undefined,
    status: () => comprehensiveKnowledge().status,
    isKnown: wordIsKnown,
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
  const pureWordMode = createMemo(() => additionalInfoInAnswer() && !showTranslation());

  return (
    <div class="word-sync">

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
              <Show when={showTranslation() && translationText()}>
                <div class="word-sync-translation">{translationText()}</div>
              </Show>
              <div class="word-sync-answer-options">
                <Btn
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTranslation((v) => !v)}
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
          <Show when={pendingAttribution()} fallback={<>
            <Btn
              variant="danger"
              size="lg"
              onClick={() => rate('unknown')}
              class="word-sync-btn word-sync-btn--unknown"
            >
              <span class="word-sync-btn-key">1</span>
              {t('mlearn.WordSync.Unknown')}
            </Btn>
            <Btn
              variant="secondary"
              size="lg"
              onClick={() => rate('learning')}
              class="word-sync-btn word-sync-btn--learning"
            >
              <span class="word-sync-btn-key">2</span>
              {t('mlearn.WordSync.Learning')}
            </Btn>
            <Btn
              variant="primary"
              size="lg"
              onClick={() => rate('known')}
              class="word-sync-btn word-sync-btn--known"
            >
              <span class="word-sync-btn-key">3</span>
              {t('mlearn.WordSync.Known')}
            </Btn>
          </>}>
            <span class="word-sync-attribution-prompt">{t('mlearn.WordSync.AttributionPrompt')}</span>
            <Btn
              variant="danger"
              size="lg"
              onClick={() => applyRating('unknown', 'meaning')}
              class="word-sync-btn word-sync-btn--unknown"
            >
              <span class="word-sync-btn-key">1</span>
              {t('mlearn.Knowledge.Aspect.Meaning')}
            </Btn>
            <Show when={attributionTargets().reading}>
              <Btn
                variant="secondary"
                size="lg"
                onClick={() => applyRating('unknown', 'reading')}
                class="word-sync-btn word-sync-btn--learning"
              >
                <span class="word-sync-btn-key">2</span>
                {t('mlearn.Knowledge.Aspect.Reading')}
              </Btn>
            </Show>
            <Show when={attributionTargets().prosody}>
              <Btn
                variant="secondary"
                size="lg"
                onClick={() => applyRating('unknown', 'prosody')}
                class="word-sync-btn word-sync-btn--learning"
              >
                <span class="word-sync-btn-key">3</span>
                {t('mlearn.Knowledge.Aspect.Prosody')}
              </Btn>
            </Show>
            <Show when={attributionTargets().orthography}>
              <Btn
                variant="secondary"
                size="lg"
                onClick={() => applyRating('unknown', 'orthography')}
                class="word-sync-btn word-sync-btn--learning"
              >
                <span class="word-sync-btn-key">4</span>
                {t('mlearn.Knowledge.Aspect.Orthography')}
              </Btn>
            </Show>
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
