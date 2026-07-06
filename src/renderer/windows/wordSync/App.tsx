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
  EmptyState,
  FilterBuilder,
  PillLabel,
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
import { SRS_EASE, WORD_STATUS } from '../../../shared/constants';
import { hashWordSync } from '../../services/srsAlgorithm';
import { fetchTranslation } from '../../hooks/useTranslation';
import { getDictionaryTargetLanguageForSettings } from '../../utils/dictionaryTargetLanguage';
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
import { fetchAnkiWordsCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { FlashcardWordTitle } from '../../components/flashcard/FlashcardWordTitle';
import { extractProsodyFromTranslationData } from '../../utils/readingProsody';
import './WordSync.css';

type Rating = 'unknown' | 'learning' | 'known';

interface PoolEntry {
  word: string;
  reading: string;
  level: number;
  levelName: string;
  weight: number;
}

const RATING_EASE: Record<Rating, number> = {
  unknown: SRS_EASE.MIN,
  learning: SRS_EASE.DEFAULT_LEARNING,
  known: SRS_EASE.DEFAULT_KNOWN,
};

export const WordSyncContent: Component = () => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const langCtx = useLanguage();
  const {
    store,
    setWordKnowledgeEase,
    markWordSyncSeen,
    clearAllWordSyncSeen,
    getWordKnowledge,
    getComprehensiveWordStatusWithSourceSync,
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
  const dictionaryTargetLanguage = createMemo(() => getDictionaryTargetLanguageForSettings(settings));

  const [sessionRatedSet, setSessionRatedSet] = createSignal(new Set<string>(), { equals: false });
  const ankiCacheOptions = createMemo(() => ({
    language: settings.language,
    languageData: langCtx.currentLangData(),
  }));
  const [ankiCacheReady, setAnkiCacheReady] = createSignal(isAnkiCacheFetched(ankiCacheOptions()));

  createEffect(() => {
    if (!settings.use_anki) {
      setAnkiCacheReady(false);
      return;
    }

    const options = ankiCacheOptions();
    if (isAnkiCacheFetched(options)) {
      setAnkiCacheReady(true);
      return;
    }

    setAnkiCacheReady(false);
    fetchAnkiWordsCache(options).then(() => setAnkiCacheReady(true)).catch(() => setAnkiCacheReady(true));
  });

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

  function getWordSyncStorageKey(word: string, language: string): string {
    const storageWord = langCtx.getCanonicalFormForLanguage(language, word);
    return `${language}:${hashWordSync(storageWord)}`;
  }

  function isSyncSeenRecently(word: string, language: string): boolean {
    const lk = getWordSyncStorageKey(word, language);
    const ts = store.wordSyncSeen[lk];
    if (!ts) return false;
    return (Date.now() - ts) < THIRTY_DAYS_MS;
  }

  function isSyncSeenRecentlyByKey(lk: string, now: number): boolean {
    const ts = store.wordSyncSeen[lk];
    if (!ts) return false;
    return (now - ts) < THIRTY_DAYS_MS;
  }

  const wordStatusToNumeric = (status: string): number => {
    if (status === 'known') return WORD_STATUS.KNOWN;
    if (status === 'learning') return WORD_STATUS.LEARNING;
    return WORD_STATUS.UNKNOWN;
  };

  function resolveWordSyncFilterStatus(word: string, lk: string, knowledge: ReturnType<typeof getWordKnowledge>): string {
    if (store.knownUntracked[lk] || store.ignoredWords[lk]) return String(WORD_STATUS.KNOWN);

    const cardIds = store.wordToCardMap?.[lk] ?? [];
    for (const cardId of cardIds) {
      const card = store.flashcards?.[cardId];
      if (!card) continue;
      if (card.state === 'review') return String(WORD_STATUS.KNOWN);
      if (card.state === 'learning' || card.state === 'relearning') return String(WORD_STATUS.LEARNING);
    }

    if (knowledge) {
      if (knowledge.ease >= settings.easeThresholdKnown) return String(WORD_STATUS.KNOWN);
      if (knowledge.ease >= settings.easeThresholdLearning) return String(WORD_STATUS.LEARNING);
      return String(WORD_STATUS.UNKNOWN);
    }

    if (settings.use_anki) {
      const comprehensive = getComprehensiveWordStatusWithSourceSync(word, settings.language);
      if (comprehensive.source !== 'None') {
        return String(wordStatusToNumeric(comprehensive.status));
      }
    }

    return WORD_SYNC_STATUS_UNTRACKED;
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
    const ankiReady = ankiCacheReady();
    void ankiReady;

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

        if (store.knownUntracked[lk]) continue;
        if (store.ignoredWords[lk]) continue;

        const knowledge = getWordKnowledge(lk);
        const seenRecently = isSyncSeenRecentlyByKey(lk, now);
        const record = {
          status: resolveWordSyncFilterStatus(word, lk, knowledge),
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
    const w = currentWord();
    if (!w) return;

    setWordKnowledgeEase(w.word, RATING_EASE[rating], w.reading, settings.language);

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
    setSessionRatedSet(new Set<string>());
    levelCursors = new Map();

    const levels = sortedLevels();
    if (levels.length > 0) setSamplingLevel(levels[0]);
    queueMicrotask(() => {
      rebuildWordPool();
      pickNext();
    });
  }

  // ─── Keyboard shortcuts ─────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    if (finished()) return;
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

    if (!langCtx.isLoading() && !initialized()) {
      setInitialized(true);
      const levels = sortedLevels();
      if (levels.length > 0) setSamplingLevel(levels[0]);
      rebuildWordPool();
      pickNext();
    }
  });

  // Re-evaluate current word when Anki cache arrives after initial pick
  createEffect(on(ankiCacheReady, (ready) => {
    if (!ready || !initialized() || !settings.use_anki) return;
    const word = currentWord();
    if (word) {
      const ast = filterAst();
      if (!ast.ok || !ast.ast) return;
      const lk = getWordSyncStorageKey(word.word, settings.language);

      const record = {
        status: resolveWordSyncFilterStatus(word.word, lk, getWordKnowledge(lk)),
        level: word.level,
        seenRecently: isSyncSeenRecently(word.word, settings.language),
      };

      if (evaluateAst<unknown>(ast.ast, record, filterResolvers())) {
        return;
      }

      levelCursors = new Map();
      rebuildWordPool();
      pickNext();
    }
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

  const currentWordProsody = createMemo(() => {
    const w = currentWord();
    if (!w) return undefined;
    return extractProsodyFromTranslationData(translation() ?? undefined, langCtx.currentLangData(), w.reading);
  });

  const currentWordContent = createMemo(() => {
    const w = currentWord();
    if (!w) return null;
    return {
      type: 'word' as const,
      front: w.word,
      back: translationText(),
      reading: w.reading,
      level: w.level,
      prosody: currentWordProsody(),
    };
  });

  return (
    <div class="word-sync">

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
            onClick={recheckAll}
            class="word-sync-recheck-btn"
          >
            {t('mlearn.WordSync.RecheckAll')}
          </Btn>
        </div>
      }>
        <div class="word-sync-header">
          <span class="word-sync-counter">
            {t('mlearn.WordSync.Progress', {
              rated: String(ratedCount()),
              total: String(totalAvailable()),
            })}
          </span>
          <FilterBuilder
            fields={filterContext().fields}
            paletteItems={filterContext().paletteItems}
            tokens={filterTokens()}
            onChange={(tokens) => {
              setFilterTokens(tokens);
              levelCursors = new Map();
              setFinished(false);
              setLastRating(null);
              queueMicrotask(() => {
                rebuildWordPool();
                pickNext();
              });
            }}
            evaluation={filterValidation()}
          />
          <Show when={currentWord()}>
            <PillLabel level={currentWord()!.level} visualLevel={currentWordVisualLevel()}>
              {levelLabel()}
            </PillLabel>
          </Show>
        </div>

        <Show when={currentWord()}>
          {(w) => (
            <div class="word-sync-card">
              <div class="word-sync-word">
                <Show
                  when={currentWordContent()}
                  fallback={<WordWithReading word={w().word} reading={w().reading} />}
                >
                  {(content) => (
                    <FlashcardWordTitle
                      content={content()}
                      language={settings.language}
                    />
                  )}
                </Show>
              </div>
              <Show when={showTranslation() && translationText()}>
                <div class="word-sync-translation">{translationText()}</div>
              </Show>
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
            </div>
          )}
        </Show>

        <div class="word-sync-actions">
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
        </div>


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
