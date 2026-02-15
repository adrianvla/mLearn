/**
 * Media Stats Panel
 * Displays per-media word/grammar breakdown and difficulty assessment
 */

import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import type { MediaStats } from '../../../shared/types';
import { useLocalization } from '../../context';
import { formatDurationHM } from '../../utils/timeFormatting';
import '../../../renderer/styles/media-stats.css';

type StatsTab = 'summary' | 'words' | 'grammar' | 'unknown';

interface MediaStatsPanelProps {
  stats: MediaStats;
  freqLevelNames?: Record<string, string>;
  grammarLevelNames?: Record<string, string>;
  onClose: () => void;
  onReviewWithAI?: () => void;
}

export const MediaStatsPanel: Component<MediaStatsPanelProps> = (props) => {
  const { t } = useLocalization();
  const [activeTab, setActiveTab] = createSignal<StatsTab>('summary');

  const wordEntries = createMemo(() => {
    const entries = Object.values(props.stats.wordsEncountered || {});
    return entries.sort((a, b) => a.ease - b.ease);
  });

  const grammarEntries = createMemo(() => {
    const entries = Object.values(props.stats.grammarEncountered || {});
    return entries.sort((a, b) => a.ease - b.ease);
  });

  const unknownWords = createMemo(() => {
    return wordEntries().filter(w => w.ease < 2.5);
  });

  const sessionsCount = createMemo(() => props.stats.sessions?.length || 0);

  const formatTime = (ms: number): string => formatDurationHM(ms, t);

  const getEaseColor = (ease: number): string => {
    if (ease >= 4) return 'var(--color-success, #4caf50)';
    if (ease >= 2.5) return 'var(--text-secondary, #888)';
    if (ease >= 1.5) return 'var(--color-warning, #ff9800)';
    return 'var(--color-danger, #f44336)';
  };

  const assessedLevelName = createMemo(() => {
    const level = props.stats.assessedLevel;
    if (level === null || level === undefined) return 'Not assessed';
    const names = props.freqLevelNames || {};
    return names[String(level)] || `Level ${level}`;
  });

  const tabs: Array<{ id: StatsTab; label: string }> = [
    { id: 'summary', label: 'Summary' },
    { id: 'words', label: 'Words' },
    { id: 'grammar', label: 'Grammar' },
    { id: 'unknown', label: 'Unknown' },
  ];

  return (
    <div class="media-stats-panel">
      <div class="media-stats-header">
        <h3 class="media-stats-title">{props.stats.mediaName}</h3>
        <button class="media-stats-close" onClick={props.onClose}>&times;</button>
      </div>

      <div class="media-stats-tabs">
        <For each={tabs}>
          {(tab) => (
            <button
              class={`media-stats-tab ${activeTab() === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <Show when={tab.id === 'unknown'}>
                <span class="media-stats-badge">{unknownWords().length}</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      <div class="media-stats-content">
        <Show when={activeTab() === 'summary'}>
          <div class="media-stats-grid">
            <div class="media-stat-card">
              <div class="stat-value">{assessedLevelName()}</div>
              <div class="stat-label">Difficulty</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{formatTime(props.stats.totalTimeSpent)}</div>
              <div class="stat-label">Time Spent</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{sessionsCount()}</div>
              <div class="stat-label">Sessions</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{Object.keys(props.stats.wordsEncountered || {}).length}</div>
              <div class="stat-label">Words Seen</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{unknownWords().length}</div>
              <div class="stat-label">Unknown Words</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{Object.keys(props.stats.grammarEncountered || {}).length}</div>
              <div class="stat-label">Grammar Points</div>
            </div>
          </div>

          <Show when={props.onReviewWithAI}>
            <button class="media-stats-review-btn" onClick={props.onReviewWithAI}>
              Review with AI
            </button>
          </Show>
        </Show>

        <Show when={activeTab() === 'words'}>
          <div class="media-stats-list">
            <Show when={wordEntries().length === 0}>
              <div class="media-stats-empty">No words encountered yet.</div>
            </Show>
            <For each={wordEntries()}>
              {(entry) => (
                <div class="media-stats-row">
                  <span class="stats-word">{entry.word}</span>
                  <span class="stats-info">
                    <span class="stats-seen">seen {entry.timesSeen}x</span>
                    <Show when={entry.timesHovered > 0}>
                      <span class="stats-hovered">hovered {entry.timesHovered}x</span>
                    </Show>
                    <span class="stats-ease" style={{ color: getEaseColor(entry.ease) }}>
                      {entry.ease.toFixed(2)}
                    </span>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={activeTab() === 'grammar'}>
          <div class="media-stats-list">
            <Show when={grammarEntries().length === 0}>
              <div class="media-stats-empty">No grammar points detected yet.</div>
            </Show>
            <For each={grammarEntries()}>
              {(entry) => (
                <div class="media-stats-row">
                  <span class="stats-word">{entry.pattern}</span>
                  <span class="stats-info">
                    <Show when={entry.timesFailed > 0}>
                      <span class="stats-hovered">failed {entry.timesFailed}x</span>
                    </Show>
                    <span class="stats-ease" style={{ color: getEaseColor(entry.ease) }}>
                      {entry.ease.toFixed(2)}
                    </span>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={activeTab() === 'unknown'}>
          <div class="media-stats-list">
            <Show when={unknownWords().length === 0}>
              <div class="media-stats-empty">All words are known!</div>
            </Show>
            <For each={unknownWords()}>
              {(entry) => (
                <div class="media-stats-row unknown">
                  <span class="stats-word">{entry.word}</span>
                  <span class="stats-info">
                    <span class="stats-seen">seen {entry.timesSeen}x</span>
                    <span class="stats-ease" style={{ color: getEaseColor(entry.ease) }}>
                      {entry.ease.toFixed(2)}
                    </span>
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
