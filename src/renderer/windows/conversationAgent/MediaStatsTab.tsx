/**
 * Media Stats Tab
 * Stats tab for the conversation agent window showing failed words,
 * grammar points, and level distribution.
 * Loads all saved media stats and lets the user browse them.
 */

import { Component, Show, For, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import type { ConversationAgentContext, MediaStats, LevelPercentageEntry } from '../../../shared/types';
import { useLocalization, useLanguage, useFlashcards, useSettings } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { isWordMarkedFailed } from '@shared/utils/passiveWordTracking';
import {
  TabContainer,
  TabPanel,
  StatCard,
  StatsGrid,
  EmptyState,
  SelectInput,
  PillLabel,
  BarChartIcon,
} from '../../components/common';
import type { TabItem } from '../../components/common';
import { computeWordLevelPercentages, computeGrammarLevelPercentages, assessMediaLevel } from '../../utils/levelPercentages';
import { formatDurationHM } from '../../utils/timeFormatting';
import './MediaStatsTab.css';

interface MediaStatsTabProps {
  /** Context passed from the current media route (pre-selected) */
  context: ConversationAgentContext | null;
}

/** A normalized view derived from either a ConversationAgentContext or raw MediaStats */
interface MediaView {
  mediaName: string;
  mediaType: 'video' | 'book';
  mediaHash: string;
  assessedLevel: number | null;
  assessedLevelName: string;
  failedWords: Array<{ word: string; ease: number; timesSeen: number; timesHovered: number }>;
  failedGrammar: Array<{ pattern: string; ease: number; timesFailed: number }>;
  wordLevelEntries: LevelPercentageEntry[];
  grammarLevelEntries: LevelPercentageEntry[];
  totalUniqueWords: number;
  totalWords: number;
  totalGrammar: number;
  totalTimeSpent: number;
  sessions: number;
  lastAccessed: number;
}

const getEaseColor = (ease: number): string => {
  if (ease >= 4) return 'var(--color-success)';
  if (ease >= 2.5) return 'var(--text-secondary)';
  if (ease >= 1.5) return 'var(--color-warning)';
  return 'var(--color-danger)';
};

export const MediaStatsTab: Component<MediaStatsTabProps> = (props) => {
  const { t } = useLocalization();

  const formatTime = (ms: number): string => formatDurationHM(ms, t);
  const langCtx = useLanguage();
  const flashcardCtx = useFlashcards();
  const { settings } = useSettings();
  const [subTab, setSubTab] = createSignal<string>('overview');
  const [allMediaStats, setAllMediaStats] = createSignal<MediaStats[]>([]);
  const [selectedHash, setSelectedHash] = createSignal<string>('');

  // Load all saved media stats on mount
  onMount(() => {
    const cleanup = getBridge().mediaStats.onMediaStatsList((statsList: MediaStats[]) => {
      // Sort by lastAccessed descending (most recent first)
      const sorted = [...statsList].sort((a, b) => b.lastAccessed - a.lastAccessed);
      setAllMediaStats(sorted);

      // Pre-select the context media if available, otherwise first item
      if (props.context?.mediaHash) {
        setSelectedHash(props.context.mediaHash);
      } else if (sorted.length > 0) {
        setSelectedHash(sorted[0].mediaHash);
      }
    });
    getBridge().mediaStats.listMediaStats();
    if (cleanup) onCleanup(cleanup);
  });

  /** Build a normalized MediaView from a ConversationAgentContext (live context from parent route) */
  const contextView = createMemo((): MediaView | null => {
    const ctx = props.context;
    if (!ctx) return null;
    return {
      mediaName: ctx.mediaName,
      mediaType: ctx.mediaType,
      mediaHash: ctx.mediaHash,
      assessedLevel: ctx.assessedLevel,
      assessedLevelName: ctx.assessedLevelName,
      failedWords: ctx.failedWords,
      failedGrammar: ctx.failedGrammar,
      wordLevelEntries: ctx.wordLevelPercentages?.entries || [],
      grammarLevelEntries: ctx.grammarLevelPercentages?.entries || [],
      totalUniqueWords: ctx.wordLevelPercentages?.totalUnique || 0,
      totalWords: Object.keys(ctx.failedWords).length, // approximate
      totalGrammar: Object.keys(ctx.failedGrammar).length,
      totalTimeSpent: 0,
      sessions: 0,
      lastAccessed: Date.now(),
    };
  });

  /** Build a normalized MediaView from raw MediaStats (loaded from disk) */
  const buildViewFromStats = (stats: MediaStats): MediaView => {
    const freqLookup = { getFrequency: langCtx.getFrequency, getFreqLevelNames: langCtx.getFreqLevelNames };
    const grammarLookup = { getGrammarPoint: langCtx.getGrammarPoint, getGrammarLevelNames: langCtx.getGrammarLevelNames };
    const wordLevels = computeWordLevelPercentages(stats, freqLookup);
    const grammarLevels = computeGrammarLevelPercentages(stats, grammarLookup);
    const level = assessMediaLevel(wordLevels);
    const levelNames = langCtx.getFreqLevelNames();

    // Use per-media wordsEncountered only; refine ease with global wordKnowledge
    // but do NOT add words from other media that were never encountered here
    const wordKnowledge = flashcardCtx.store.wordKnowledge;
    const mediaWords = new Map<string, { word: string; ease: number; timesSeen: number; timesHovered: number }>();

    for (const entry of Object.values(stats.wordsEncountered)) {
      const lang = settings.language;
      const globalEntry = wordKnowledge[lang + ':' + entry.word] || wordKnowledge[entry.word];
      if (globalEntry) {
        // Use the lower ease (harder) between per-media and global knowledge
        mediaWords.set(entry.word, {
          word: entry.word,
          ease: Math.min(entry.ease, globalEntry.ease),
          timesSeen: Math.max(entry.timesSeen, globalEntry.timesSeen),
          timesHovered: Math.max(entry.timesHovered, globalEntry.timesHovered),
        });
      } else {
        mediaWords.set(entry.word, { ...entry });
      }
    }

    const failedWords = Array.from(mediaWords.values()).filter((word) => isWordMarkedFailed(word, settings));
    const failedGrammar = Object.values(stats.grammarEncountered).filter((g) => g.timesFailed > 0);

    return {
      mediaName: stats.mediaName,
      mediaType: stats.mediaType,
      mediaHash: stats.mediaHash,
      assessedLevel: level,
      assessedLevelName: level !== null && levelNames[String(level)] ? levelNames[String(level)] : '',
      failedWords,
      failedGrammar,
      wordLevelEntries: wordLevels.entries,
      grammarLevelEntries: grammarLevels.entries,
      totalUniqueWords: wordLevels.totalUnique,
      totalWords: Object.keys(stats.wordsEncountered).length,
      totalGrammar: Object.keys(stats.grammarEncountered).length,
      totalTimeSpent: stats.totalTimeSpent,
      sessions: stats.sessions?.length || 0,
      lastAccessed: stats.lastAccessed,
    };
  };

  /** The currently selected media view */
  const selectedView = createMemo((): MediaView | null => {
    const hash = selectedHash();
    if (!hash) return null;

    // If the selected hash matches the live context, use that (it has the most up-to-date data)
    const ctxView = contextView();
    if (ctxView && ctxView.mediaHash === hash) return ctxView;

    // Otherwise build from the saved stats
    const stats = allMediaStats().find((s) => s.mediaHash === hash);
    if (!stats) return null;
    return buildViewFromStats(stats);
  });

  /** All available media for the picker (merge live context + saved stats, deduplicate) */
  const mediaList = createMemo(() => {
    const saved = allMediaStats();
    const ctxHash = props.context?.mediaHash;

    const items: Array<{ hash: string; name: string; type: 'video' | 'book'; lastAccessed: number; isCurrent: boolean }> = [];
    const seen = new Set<string>();

    // Add context media first if present
    if (ctxHash && props.context) {
      items.push({
        hash: ctxHash,
        name: props.context.mediaName,
        type: props.context.mediaType,
        lastAccessed: Date.now(),
        isCurrent: true,
      });
      seen.add(ctxHash);
    }

    // Add all saved media
    for (const s of saved) {
      if (seen.has(s.mediaHash)) continue;
      // Only include entries that have actual word/grammar data
      if (Object.keys(s.wordsEncountered).length === 0 && Object.keys(s.grammarEncountered).length === 0) continue;
      items.push({
        hash: s.mediaHash,
        name: s.mediaName,
        type: s.mediaType,
        lastAccessed: s.lastAccessed,
        isCurrent: false,
      });
      seen.add(s.mediaHash);
    }

    return items;
  });

  const tabs = (): TabItem[] => {
    const v = selectedView();
    const items: TabItem[] = [
      { id: 'overview', label: t('mlearn.ConversationAgent.Stats.Overview') },
      { id: 'words', label: t('mlearn.ConversationAgent.Stats.FailedWords'), badge: v?.failedWords.length || undefined },
      { id: 'grammar', label: t('mlearn.ConversationAgent.Stats.Grammar'), badge: v?.failedGrammar.length || undefined },
      { id: 'levels', label: t('mlearn.ConversationAgent.Stats.Levels') },
    ];
    return items;
  };

  const view = () => selectedView();

  const mediaSelectOptions = () =>
    mediaList().map((item) => ({
      value: item.hash,
      label: `${item.name}${item.isCurrent ? ` (${t('mlearn.ConversationAgent.Stats.Current')})` : ''}`,
    }));

  return (
    <div class="ca-stats-tab">
      <Show
        when={mediaList().length > 0}
        fallback={
          <EmptyState
            icon={<BarChartIcon size={24} />}
            title={t('mlearn.ConversationAgent.Stats.NoMedia')}
            description={t('mlearn.ConversationAgent.Stats.NoMediaHint')}
          />
        }
      >
        {/* Media selector */}
        <div class="ca-stats-media-picker">
          <SelectInput
            options={mediaSelectOptions()}
            value={selectedHash()}
            onChange={(e) => {
              setSelectedHash(e.currentTarget.value);
              setSubTab('overview');
            }}
            fullWidth
          />
        </div>

        <Show when={view()}>
          {(v) => (
            <>
              {/* Media info header */}
              <div class="ca-stats-media-header">
                <span class="ca-stats-media-name">{v().mediaName}</span>
                <Show when={v().assessedLevelName}>
                  <PillLabel level={v().assessedLevel ?? undefined} class="ca-stats-level-badge">{v().assessedLevelName}</PillLabel>
                </Show>
              </div>

              {/* Sub-tab bar */}
              <TabContainer
                tabs={tabs()}
                activeTab={subTab()}
                onTabChange={setSubTab}
                variant="underline"
                size="sm"
              />

              <div class="ca-stats-content">
                {/* Overview */}
                <TabPanel tabId="overview" activeTab={subTab()}>
                  <StatsGrid columns={2} gap="sm">
                    <StatCard
                      label={t('mlearn.ConversationAgent.Stats.AssessedLevel')}
                      value={v().assessedLevelName || '—'}
                      size="sm"
                    />
                    <StatCard
                      label={t('mlearn.ConversationAgent.Stats.UnknownWords')}
                      value={v().failedWords.length}
                      size="sm"
                    />
                    <StatCard
                      label={t('mlearn.ConversationAgent.Stats.FailedGrammarCount')}
                      value={v().failedGrammar.length}
                      size="sm"
                    />
                    <StatCard
                      label={t('mlearn.ConversationAgent.Stats.UniqueWords')}
                      value={v().totalUniqueWords}
                      size="sm"
                    />
                    <Show when={v().totalTimeSpent > 0}>
                      <StatCard
                        label={t('mlearn.MediaStats.TimeSpent')}
                        value={formatTime(v().totalTimeSpent)}
                        size="sm"
                      />
                    </Show>
                    <Show when={v().sessions > 0}>
                      <StatCard
                        label={t('mlearn.MediaStats.Sessions')}
                        value={v().sessions}
                        size="sm"
                      />
                    </Show>
                  </StatsGrid>

                  {/* Level distribution bars (word) */}
                  <Show when={v().wordLevelEntries.length > 0}>
                    <h4 class="ca-stats-section-title">{t('mlearn.ConversationAgent.Stats.WordLevelDistribution')}</h4>
                    <LevelBars entries={v().wordLevelEntries} mode="unique" />
                  </Show>
                </TabPanel>

                {/* Failed Words list */}
                <TabPanel tabId="words" activeTab={subTab()}>
                  <div class="ca-stats-list">
                    <Show when={v().failedWords.length === 0}>
                      <EmptyState
                        title={t('mlearn.ConversationAgent.Stats.NoFailedWords')}
                        size="sm"
                        variant="minimal"
                      />
                    </Show>
                    <For each={[...v().failedWords].sort((a, b) => a.ease - b.ease)}>
                      {(entry) => (
                        <div class={`ca-stats-row failed-word ${entry.ease < 1.5 ? 'severe' : ''}`}>
                          <span class="ca-stats-word">{entry.word}</span>
                          <span class="ca-stats-meta">
                            <span class="ca-stats-seen">{t('mlearn.ConversationAgent.Stats.Seen')} {entry.timesSeen}x</span>
                            <Show when={entry.timesHovered > 0}>
                              <span class="ca-stats-hovered">{t('mlearn.ConversationAgent.Stats.Hovered')} {entry.timesHovered}x</span>
                            </Show>
                            <span class="ca-stats-ease" style={{ color: getEaseColor(entry.ease) }}>
                              {entry.ease.toFixed(2)}
                            </span>
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </TabPanel>

                {/* Grammar */}
                <TabPanel tabId="grammar" activeTab={subTab()}>
                  <div class="ca-stats-list">
                    <Show when={v().failedGrammar.length === 0}>
                      <EmptyState
                        title={t('mlearn.ConversationAgent.Stats.NoFailedGrammar')}
                        size="sm"
                        variant="minimal"
                      />
                    </Show>
                    <For each={[...v().failedGrammar].sort((a, b) => a.ease - b.ease)}>
                      {(entry) => (
                        <div class={`ca-stats-row failed-word ${entry.ease < 1.5 ? 'severe' : ''}`}>
                          <span class="ca-stats-word">{entry.pattern}</span>
                          <span class="ca-stats-meta">
                            <Show when={entry.timesFailed > 0}>
                              <span class="ca-stats-hovered">{t('mlearn.ConversationAgent.Stats.Failed')} {entry.timesFailed}x</span>
                            </Show>
                            <span class="ca-stats-ease" style={{ color: getEaseColor(entry.ease) }}>
                              {entry.ease.toFixed(2)}
                            </span>
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </TabPanel>

                {/* Levels */}
                <TabPanel tabId="levels" activeTab={subTab()}>
                  <Show when={v().wordLevelEntries.length > 0}>
                    <h4 class="ca-stats-section-title">{t('mlearn.ConversationAgent.Stats.WordLevels')}</h4>
                    <LevelBars entries={v().wordLevelEntries} mode="both" />
                  </Show>
                  <Show when={v().grammarLevelEntries.length > 0}>
                    <h4 class="ca-stats-section-title">{t('mlearn.ConversationAgent.Stats.GrammarLevels')}</h4>
                    <LevelBars entries={v().grammarLevelEntries} mode="both" />
                  </Show>
                  <Show when={v().wordLevelEntries.length === 0 && v().grammarLevelEntries.length === 0}>
                    <EmptyState
                      title={t('mlearn.ConversationAgent.Stats.NoLevelData')}
                      size="sm"
                      variant="minimal"
                    />
                  </Show>
                </TabPanel>
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
};

// ============ Level Bar Chart Component ============

interface LevelBarsProps {
  entries: LevelPercentageEntry[];
  mode: 'unique' | 'occurrence' | 'both';
}

const LevelBars: Component<LevelBarsProps> = (props) => {
  const { t } = useLocalization();

  return (
    <div class="ca-level-bars">
      <For each={props.entries}>
        {(entry) => (
          <div class="ca-level-row">
            <span class="ca-level-name">{entry.levelName}</span>
            <div class="ca-level-bar-container">
              {/* Unique percentage bar */}
              <div class="ca-level-bar-track">
                <div
                  class="ca-level-bar-fill unique"
                  style={{ width: `${Math.max(entry.uniquePercent, 1)}%` }}
                />
              </div>
              <Show when={props.mode === 'both'}>
                {/* Occurrence percentage bar */}
                <div class="ca-level-bar-track occurrence">
                  <div
                    class="ca-level-bar-fill occurrence"
                    style={{ width: `${Math.max(entry.occurrencePercent, 1)}%` }}
                  />
                </div>
              </Show>
            </div>
            <span class="ca-level-percent">
              {entry.uniquePercent.toFixed(0)}%
              <Show when={props.mode === 'both'}>
                <span class="ca-level-percent-occ"> / {entry.occurrencePercent.toFixed(0)}%</span>
              </Show>
            </span>
          </div>
        )}
      </For>
      <Show when={props.mode === 'both'}>
        <div class="ca-level-legend">
          <span class="ca-level-legend-item">
            <span class="ca-level-dot unique" /> {t('mlearn.ConversationAgent.Stats.Unique') || 'Unique'}
          </span>
          <span class="ca-level-legend-item">
            <span class="ca-level-dot occurrence" /> {t('mlearn.ConversationAgent.Stats.ByOccurrence') || 'By occurrence'}
          </span>
        </div>
      </Show>
    </div>
  );
};
