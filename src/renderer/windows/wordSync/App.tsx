/**
 * Word Sync Window
 *
 * Presents frequency-list words one at a time for the user to rate.
 * Ratings: Unknown (1), Learning (2), Known (3), Seen (4).
 *
 * Unknown / Learning / Known set the word's passive ease AND mark the word
 * as "sync-seen" so it won't be re-asked for ~30 days.
 * "Seen" only marks the word as sync-seen (no ease change).
 *
 * Adaptive sampling:
 *   - Starts at the easiest level (highest raw_level).
 *   - "Known" → moves toward harder words (lower raw_level).
 *   - "Unknown" → moves toward easier words (higher raw_level).
 *   - "Learning" / "Seen" → no level change.
 *
 * Only words at or below the "Target exam level" setting are shown.
 * preparedExam === 0 means no target (show all levels).
 *
 * "All done" is shown only when every eligible word has been rated in
 * this session — i.e. the session cursors have exhausted every group.
 *
 * A "Recheck all" button lets the user ignore the 30-day seen filter.
 */

import { Component, Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import {
  WindowWrapper,
  useLocalization,
  useSettings,
  useLanguage,
  useFlashcards,
} from '../../context';
import { Btn, EmptyState, PillLabel } from '../../components/common';
import { SRS_EASE } from '../../../shared/constants';
import { hashWordSync } from '../../services/srsAlgorithm';
import './WordSync.css';

/** Rating the user can assign to a word. */
type Rating = 'unknown' | 'learning' | 'known' | 'seen';

/** An entry in the pool of words eligible for sampling. */
interface PoolEntry {
  word: string;
  reading: string;
  level: number;
  levelName: string;
  /** Weight for sampling priority — words seen more often get higher weight. */
  weight: number;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const RATING_EASE: Record<Exclude<Rating, 'seen'>, number> = {
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
  } = useFlashcards();

  // ─── State ───────────────────────────────────────────
  const [currentWord, setCurrentWord] = createSignal<PoolEntry | null>(null);
  const [samplingLevel, setSamplingLevel] = createSignal<number>(0);
  const [ratedCount, setRatedCount] = createSignal(0);
  const [lastRating, setLastRating] = createSignal<Rating | null>(null);
  const [finished, setFinished] = createSignal(false);
  const [ignoreSeenFilter, setIgnoreSeenFilter] = createSignal(false);

  // ─── Pool of eligible words grouped by level ────────
  const levelNames = createMemo(() => langCtx.getFreqLevelNames());
  const sortedLevels = createMemo(() =>
    Object.keys(levelNames()).map(Number).sort((a, b) => b - a),
  );

  /** Check if a word was sync-seen within the last 30 days. */
  function isSyncSeenRecently(word: string, langPrefix: string): boolean {
    const lk = langPrefix + hashWordSync(word);
    const ts = store.wordSyncSeen[lk];
    if (!ts) return false;
    return (Date.now() - ts) < THIRTY_DAYS_MS;
  }

  /** All words in the frequency list at/below target level, grouped by raw_level. */
  const wordPool = createMemo(() => {
    const freq = langCtx.wordFrequency;
    const names = levelNames();
    const target = settings.preparedExam;
    const skipSeen = !ignoreSeenFilter();

    const groups = new Map<number, PoolEntry[]>();
    const lang = settings.language;
    const prefix = lang + ':';

    for (const [word, entry] of Object.entries(freq)) {
      // Respect "Target exam level" filter.
      if (target > 0 && entry.raw_level > target) continue;

      // Skip words seen in the sync window within the last 30 days.
      if (skipSeen && isSyncSeenRecently(word, prefix)) continue;

      // Weight: base 1 + timesSeen from passive knowledge.
      const lk = prefix + hashWordSync(word);
      const knowledge = getWordKnowledge(lk);
      const timesSeen = knowledge?.timesSeen ?? 0;

      const lvl = entry.raw_level;
      if (!groups.has(lvl)) groups.set(lvl, []);
      groups.get(lvl)!.push({
        word,
        reading: entry.reading,
        level: lvl,
        levelName: names[String(lvl)] ?? `Level ${lvl}`,
        weight: 1 + timesSeen,
      });
    }

    // Weighted shuffle: words seen more often appear earlier.
    for (const group of groups.values()) {
      weightedShuffle(group);
    }

    return groups;
  });

  /** Index into the current level's array so we don't repeat words in a session. */
  let levelCursors = new Map<number, number>();

  /**
   * Weighted shuffle: sorts the array so that entries with higher weight
   * are more likely to appear earlier. Uses the algorithm:
   *   sortKey = -weight * random^(1/weight)  (reservoir-style weighted sampling)
   * This produces a full ordering where higher-weight items land near the front
   * proportionally more often, while still visiting every item eventually.
   */
  function weightedShuffle(arr: PoolEntry[]) {
    arr.sort((a, b) => {
      const ka = -Math.pow(Math.random(), 1 / a.weight);
      const kb = -Math.pow(Math.random(), 1 / b.weight);
      return ka - kb;
    });
  }

  /** Pick the next word to show from the current sampling level. */
  function pickNext() {
    const levels = sortedLevels(); // easiest first (highest number)
    if (levels.length === 0) { setFinished(true); return; }

    let lvl = samplingLevel();
    // Clamp to valid range.
    if (!levels.includes(lvl)) lvl = levels[0];

    const pool = wordPool();

    // Try the current level first, then expand outward.
    const tryOrder = [lvl, ...levels.filter((l) => l !== lvl)];

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

    // All words exhausted.
    setFinished(true);
    setCurrentWord(null);
  }

  /** Handle a user rating. */
  function rate(rating: Rating) {
    const w = currentWord();
    if (!w) return;

    if (rating !== 'seen') {
      setWordKnowledgeEase(w.word, RATING_EASE[rating], w.reading);
    }

    // Always mark the word as sync-seen so it's skipped for 30 days.
    markWordSyncSeen(w.word);

    setRatedCount((c) => c + 1);
    setLastRating(rating);

    // Adjust sampling level.
    const levels = sortedLevels();
    const idx = levels.indexOf(samplingLevel());

    if (rating === 'known' && idx < levels.length - 1) {
      // Move toward harder words (lower raw_level = further in sorted array).
      setSamplingLevel(levels[idx + 1]);
    } else if (rating === 'unknown' && idx > 0) {
      // Move toward easier words (higher raw_level = earlier in sorted array).
      setSamplingLevel(levels[idx - 1]);
    }
    // 'learning' / 'seen' → no level change.

    pickNext();
  }

  /** Reset the pool to include all words, ignoring the seen filter. */
  function recheckAll() {
    setIgnoreSeenFilter(true);
    setFinished(false);
    setRatedCount(0);
    setLastRating(null);
    levelCursors = new Map();

    // Re-initialise sampling.
    const levels = sortedLevels();
    if (levels.length > 0) setSamplingLevel(levels[0]);
    // wordPool memo will recompute because ignoreSeenFilter changed.
    // We need to wait for the next micro-task so the memo updates.
    queueMicrotask(() => pickNext());
  }

  // ─── Keyboard shortcuts ─────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    if (finished()) return;
    if (e.key === '1') rate('unknown');
    else if (e.key === '2') rate('learning');
    else if (e.key === '3') rate('known');
    else if (e.key === '4') rate('seen');
  }

  onMount(() => {
    // Initialise sampling at the easiest available level.
    const levels = sortedLevels();
    if (levels.length > 0) setSamplingLevel(levels[0]);
    pickNext();
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
      <div class="word-sync-drag-region" />

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
        {/* Progress bar */}
        <div class="word-sync-header">
          <span class="word-sync-counter">
            {t('mlearn.WordSync.Progress', {
              rated: String(ratedCount()),
              total: String(totalAvailable()),
            })}
          </span>
          <Show when={currentWord()}>
            <PillLabel level={currentWord()!.level}>
              {levelLabel()}
            </PillLabel>
          </Show>
        </div>

        {/* Word display */}
        <Show when={currentWord()}>
          {(w) => (
            <div class="word-sync-card">
              <div class="word-sync-word">{w().word}</div>
              <Show when={w().reading && w().reading !== w().word}>
                <div class="word-sync-reading">{w().reading}</div>
              </Show>
            </div>
          )}
        </Show>

        {/* Rating buttons */}
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
          <Btn
            variant="ghost"
            size="lg"
            onClick={() => rate('seen')}
            class="word-sync-btn word-sync-btn--seen"
          >
            <span class="word-sync-btn-key">4</span>
            {t('mlearn.WordSync.Seen')}
          </Btn>
        </div>

        {/* Last rating feedback */}
        <Show when={lastRating()}>
          <div class={`word-sync-feedback word-sync-feedback--${lastRating()}`}>
            {t(`mlearn.WordSync.Rated.${lastRating()!.charAt(0).toUpperCase() + lastRating()!.slice(1)}`)}
          </div>
        </Show>
      </Show>
    </div>
  );
};

export const WordSyncApp: Component = () => {
  return (
    <WindowWrapper showDragRegion={false}>
      <WordSyncContent />
    </WindowWrapper>
  );
};
