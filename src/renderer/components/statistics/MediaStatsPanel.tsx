/**
 * Media Stats Sidebar
 * Fixed left sidebar showing per-media word/grammar breakdown and difficulty assessment
 */

import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import type { MediaStats } from '../../../shared/types';
import { useLocalization } from '../../context';
import { Btn, IconBtn, CloseIcon } from '../common';
import { formatDurationHM } from '../../utils/timeFormatting';
import './MediaStats.css';

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
    if (ease >= 4) return 'var(--color-success)';
    if (ease >= 2.5) return 'var(--text-secondary)';
    if (ease >= 1.5) return 'var(--color-warning)';
    return 'var(--color-danger)';
  };

  const assessedLevelName = createMemo(() => {
    const level = props.stats.assessedLevel;
    if (level === null || level === undefined) return t('mlearn.MediaStats.NotAssessed');
    const names = props.freqLevelNames || {};
    return names[String(level)] || `Level ${level}`;
  });

  const tabs: Array<{ id: StatsTab; labelKey: string }> = [
    { id: 'summary', labelKey: 'mlearn.MediaStats.Tab.Summary' },
    { id: 'words', labelKey: 'mlearn.MediaStats.Tab.Words' },
    { id: 'grammar', labelKey: 'mlearn.MediaStats.Tab.Grammar' },
    { id: 'unknown', labelKey: 'mlearn.MediaStats.Tab.Unknown' },
  ];

  return (
    <div class="media-stats-panel">
      <div class="media-stats-header">
        <h3 class="media-stats-title">{props.stats.mediaName}</h3>
        <IconBtn variant="ghost" onClick={props.onClose} aria-label={t('mlearn.Global.Aria.Close')}>
          <CloseIcon size={16} />
        </IconBtn>
      </div>

      <div class="media-stats-tabs">
        <For each={tabs}>
          {(tab) => (
            <button
              class={`media-stats-tab ${activeTab() === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {t(tab.labelKey)}
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
              <div class="stat-label">{t('mlearn.MediaStats.Difficulty')}</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{formatTime(props.stats.totalTimeSpent)}</div>
              <div class="stat-label">{t('mlearn.MediaStats.TimeSpent')}</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{sessionsCount()}</div>
              <div class="stat-label">{t('mlearn.MediaStats.Sessions')}</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{Object.keys(props.stats.wordsEncountered || {}).length}</div>
              <div class="stat-label">{t('mlearn.MediaStats.WordsSeen')}</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{unknownWords().length}</div>
              <div class="stat-label">{t('mlearn.MediaStats.UnknownWords')}</div>
            </div>
            <div class="media-stat-card">
              <div class="stat-value">{Object.keys(props.stats.grammarEncountered || {}).length}</div>
              <div class="stat-label">{t('mlearn.MediaStats.GrammarPoints')}</div>
            </div>
          </div>

          <Show when={props.onReviewWithAI}>
            <Btn variant="primary" onClick={props.onReviewWithAI} class="media-stats-review-btn">
              {t('mlearn.MediaStats.ReviewWithAI')}
            </Btn>
          </Show>
        </Show>

        <Show when={activeTab() === 'words'}>
          <div class="media-stats-list">
            <Show when={wordEntries().length === 0}>
              <div class="media-stats-empty">{t('mlearn.MediaStats.NoWordsYet')}</div>
            </Show>
            <For each={wordEntries()}>
              {(entry) => (
                <div class="media-stats-row">
                  <span class="stats-word">{entry.word}</span>
                  <span class="stats-info">
                    <span class="stats-seen">{t('mlearn.MediaStats.Seen', { count: String(entry.timesSeen) })}</span>
                    <Show when={entry.timesHovered > 0}>
                      <span class="stats-hovered">{t('mlearn.MediaStats.Hovered', { count: String(entry.timesHovered) })}</span>
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
              <div class="media-stats-empty">{t('mlearn.MediaStats.NoGrammarYet')}</div>
            </Show>
            <For each={grammarEntries()}>
              {(entry) => (
                <div class="media-stats-row">
                  <span class="stats-word">{entry.pattern}</span>
                  <span class="stats-info">
                    <Show when={entry.timesFailed > 0}>
                      <span class="stats-hovered">{t('mlearn.MediaStats.Failed', { count: String(entry.timesFailed) })}</span>
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
              <div class="media-stats-empty">{t('mlearn.MediaStats.AllWordsKnown')}</div>
            </Show>
            <For each={unknownWords()}>
              {(entry) => (
                <div class="media-stats-row unknown">
                  <span class="stats-word">{entry.word}</span>
                  <span class="stats-info">
                    <span class="stats-seen">{t('mlearn.MediaStats.Seen', { count: String(entry.timesSeen) })}</span>
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
