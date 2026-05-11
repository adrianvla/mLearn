import { Component, Show, createSignal, createMemo, createEffect, on, onMount, onCleanup, createResource } from 'solid-js';
import {
  WindowWrapper,
  useLocalization,
  useSettings,
  useLanguage,
  useFlashcards,
} from '../../context';
import { Btn, EmptyState, PillLabel, ToggleSwitch, WordWithReading } from '../../components/common';
import { SRS_EASE } from '../../../shared/constants';
import { hashWordSync } from '../../services/srsAlgorithm';
import { fetchTranslation } from '../../hooks/useTranslation';
import { extractKanjiChars } from '../../../shared/utils/textUtils';
import {
  wasExplicitlySyncRated,
  shouldIncludeForLevel,
  calculateKanjiBoost,
  calculateWordWeight,
  isWordEligible,
  THIRTY_DAYS_MS,
} from './wordSyncPool';
import { fetchAnkiWordsCache, isAnkiCacheFetched } from '../../services/ankiWordsCache';
import { resolveRendererWordKnowledge } from '../../services/wordKnowledge';
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

const WordSyncContent: Component = () => {
  const { t } = useLocalization();
  const { settings } = useSettings();
  const langCtx = useLanguage();
  const {
    store,
    setWordKnowledgeEase,
    markWordSyncSeen,
    getWordKnowledge,
    getCardByWordSync,
  } = useFlashcards();

  // ─── State ───────────────────────────────────────────
  const [currentWord, setCurrentWord] = createSignal<PoolEntry | null>(null);
  const [samplingLevel, setSamplingLevel] = createSignal<number>(0);
  const [ratedCount, setRatedCount] = createSignal(0);
  const [lastRating, setLastRating] = createSignal<Rating | null>(null);
  const [finished, setFinished] = createSignal(false);
  const [ignoreSeenFilter, setIgnoreSeenFilter] = createSignal(false);
  const [unknownOnly, setUnknownOnly] = createSignal(false);
  const [showTranslation, setShowTranslation] = createSignal(false);

  const [sessionRatedSet, setSessionRatedSet] = createSignal(new Set<string>(), { equals: false });
  const [ankiCacheReady, setAnkiCacheReady] = createSignal(isAnkiCacheFetched());

  createEffect(() => {
    if (!settings.use_anki) {
      setAnkiCacheReady(false);
      return;
    }

    if (isAnkiCacheFetched()) {
      setAnkiCacheReady(true);
      return;
    }

    setAnkiCacheReady(false);
    fetchAnkiWordsCache().then(() => setAnkiCacheReady(true)).catch(() => setAnkiCacheReady(true));
  });

  // ─── Translation for current word ───────────────────
  const [translation] = createResource(
    () => currentWord()?.word,
    async (word) => {
      if (!word) return null;
      return fetchTranslation(word, settings.language);
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
    Object.keys(levelNames()).map(Number).sort((a, b) => b - a),
  );

  function isSyncSeenRecently(word: string, langPrefix: string): boolean {
    const lk = langPrefix + hashWordSync(word);
    const ts = store.wordSyncSeen[lk];
    if (!ts) return false;
    return (Date.now() - ts) < THIRTY_DAYS_MS;
  }

  // ─── Known kanji set for logographic boost ──────────
  // Builds a set of distinct kanji characters from words that are
  // explicitly known (rated "known" through Word Sync). Only active
  // when the current language uses a logographic script.
  const knownKanjiSet = createMemo((): Set<string> => {
    const features = langCtx.getLanguageFeatures();
    if (!features.isLogographic) return new Set();

    const lang = settings.language;
    const prefix = lang + ':';
    const result = new Set<string>();

    for (const [key, entry] of Object.entries(store.wordKnowledge)) {
      if (!key.startsWith(prefix)) continue;
      if (!wasExplicitlySyncRated(entry)) continue;
      if (entry.ease < SRS_EASE.DEFAULT_KNOWN) continue;
      for (const ch of extractKanjiChars(entry.word)) {
        result.add(ch);
      }
    }

    return result;
  });

  // ─── Word pool ──────────────────────────────────────
   const wordPool = createMemo(() => {
    const freq = langCtx.wordFrequency;
    const names = levelNames();
    const target = settings.learningLanguageLevel ?? 0;
    const skipSeen = !ignoreSeenFilter();
    const onlyUnknown = unknownOnly();
    const staleDaysMs = settings.wordSyncStaleLearningDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const rated = sessionRatedSet();
    const kanjiSet = knownKanjiSet();
    const useAnki = settings.use_anki && ankiCacheReady();
    const { knowledgeSourceOrder, knowledgeResolutionMode } = settings;
    const getCanonicalForm = langCtx.getCanonicalForm;

    const groups = new Map<number, PoolEntry[]>();
    const lang = settings.language;
    const prefix = lang + ':';

    for (const [word, entry] of Object.entries(freq)) {
      if (!shouldIncludeForLevel(entry.raw_level, target)) continue;

      if (rated.has(word)) continue;

      const lk = prefix + hashWordSync(word);

      if (store.knownUntracked[lk]) continue;
      if (store.ignoredWords[lk]) continue;

      const knowledge = getWordKnowledge(lk);
      const resolvedKnowledge = resolveRendererWordKnowledge({
        word,
        getCanonicalForm,
        getWordVariants: langCtx.getWordVariants,
        getCardByWordSync,
        useAnki,
        ankiLearningThreshold: settings.ankiLearningThreshold,
        ankiKnownThreshold: settings.ankiKnownThreshold,
        knowledgeSourceOrder,
        knowledgeResolutionMode,
      });

      if (onlyUnknown && resolvedKnowledge.status !== 'unknown') continue;

      const seenRecently = isSyncSeenRecently(word, prefix);

      if (!isWordEligible(knowledge, seenRecently, skipSeen, staleDaysMs, now)) continue;

      const kanjiBoost = calculateKanjiBoost(word, kanjiSet);
      const weight = calculateWordWeight(knowledge?.ease, kanjiBoost);

      const lvl = entry.raw_level;
      if (!groups.has(lvl)) groups.set(lvl, []);
      groups.get(lvl)!.push({
        word,
        reading: entry.reading,
        level: lvl,
        levelName: names[String(lvl)] ?? `Level ${lvl}`,
        weight,
      });
    }

    for (const group of groups.values()) {
      weightedShuffle(group);
    }

    return groups;
  });

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

    setWordKnowledgeEase(w.word, RATING_EASE[rating], w.reading);

    if (rating === 'unknown') {
      markWordSyncSeen(w.word);
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
    setIgnoreSeenFilter(true);
    setFinished(false);
    setRatedCount(0);
    setLastRating(null);
    setSessionRatedSet(new Set<string>());
    levelCursors = new Map();

    const levels = sortedLevels();
    if (levels.length > 0) setSamplingLevel(levels[0]);
    queueMicrotask(() => pickNext());
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
    if (!langCtx.isLoading() && !initialized()) {
      setInitialized(true);
      const levels = sortedLevels();
      if (levels.length > 0) setSamplingLevel(levels[0]);
      pickNext();
    }
  });

  // Re-evaluate current word when Anki cache arrives after initial pick
  createEffect(on(ankiCacheReady, (ready) => {
    if (!ready || !initialized() || !unknownOnly() || !settings.use_anki) return;
    const word = currentWord();
    if (word) {
      const resolvedKnowledge = resolveRendererWordKnowledge({
        word: word.word,
        getCanonicalForm: langCtx.getCanonicalForm,
        getWordVariants: langCtx.getWordVariants,
        getCardByWordSync,
        useAnki: true,
        ankiLearningThreshold: settings.ankiLearningThreshold,
        ankiKnownThreshold: settings.ankiKnownThreshold,
        knowledgeSourceOrder: settings.knowledgeSourceOrder,
        knowledgeResolutionMode: settings.knowledgeResolutionMode,
      });

      if (resolvedKnowledge.status === 'unknown') {
        return;
      }

      levelCursors = new Map();
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

  const totalAvailable = createMemo(() => {
    let total = 0;
    for (const group of wordPool().values()) total += group.length;
    return total;
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
          <ToggleSwitch
            checked={unknownOnly()}
            onChange={(v) => {
              setUnknownOnly(v);
              levelCursors = new Map();
              setFinished(false);
              setLastRating(null);
              queueMicrotask(() => pickNext());
            }}
            label={t('mlearn.WordSync.UnknownOnly')}
          />
          <Show when={currentWord()}>
            <PillLabel level={currentWord()!.level}>
              {levelLabel()}
            </PillLabel>
          </Show>
        </div>

        <Show when={currentWord()}>
          {(w) => (
            <div class="word-sync-card">
              <div class="word-sync-word">
                <WordWithReading
                  word={w().word}
                  reading={w().reading}
                />
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
