/**
 * WelcomeFeaturePreviews
 * Bespoke tactile mini-app surfaces for the welcome feature grid. Each surface
 * reflects real app state and hands off to existing workflows via callbacks.
 */

import { Component, createSignal, For, Show } from 'solid-js';
import type { Flashcard } from '../../../../../shared/types';
import type { RecentItem } from '../../../../services/thumbnailService';
import type { LevelStats } from '../../../../utils/wordLevelStats';
import type { RecentWordRow, WeekStatDay } from '../welcomeSelectors';
import './WelcomeFeaturePreviews.css';

export interface WelcomeMediaPreviewProps {
  /** Most recent item of the matching type, or null when none exists */
  item: RecentItem | null;
  emptyLabel: string;
  continueLabel: string;
  onResume: (item: RecentItem) => void;
}

/** Mini player surface for the most recent video; empty keeps a physical player shell. */
export const WelcomeVideoPreview: Component<WelcomeMediaPreviewProps> = (props) => {
  return (
    <div class="wfv-video">
      <Show
        when={props.item}
        fallback={
          <div class="wfv-player wfv-player-empty">
            <svg class="wfv-player-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            <p class="wfv-empty">{props.emptyLabel}</p>
          </div>
        }
      >
        {(item) => (
          <>
            <div class="wfv-player">
              <Show when={item().thumbnail}>
                <img class="wfv-video-thumb" src={item().thumbnail} alt="" />
              </Show>
              <span class="wfv-player-title">{item().name}</span>
              <button
                type="button"
                class="wfv-play"
                aria-label={props.continueLabel}
                onClick={() => props.onResume(item())}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </button>
            </div>
            <progress class="wfv-progress" max="100" value={item().progress} />
          </>
        )}
      </Show>
    </div>
  );
};

/** Layered reader page for the most recent book; the whole page is the resume button. */
export const WelcomeReaderPreview: Component<WelcomeMediaPreviewProps> = (props) => {
  return (
    <div class="wfv-reader">
      <Show
        when={props.item}
        fallback={
          <div class="wfv-page-stack">
            <span class="wfv-page-sheet" aria-hidden="true" />
            <span class="wfv-page-sheet" aria-hidden="true" />
            <div class="wfv-page">
              <p class="wfv-empty">{props.emptyLabel}</p>
            </div>
          </div>
        }
      >
        {(item) => (
          <div class="wfv-page-stack">
            <span class="wfv-page-sheet" aria-hidden="true" />
            <span class="wfv-page-sheet" aria-hidden="true" />
            <button
              type="button"
              class="wfv-page wfv-page-button"
              aria-label={props.continueLabel}
              onClick={() => props.onResume(item())}
            >
              <span class="wfv-page-title">{item().name}</span>
              <Show
                when={item().thumbnail}
                fallback={
                  <span class="wfv-page-body">
                    <span class="wfv-page-line" />
                    <span class="wfv-page-line" />
                    <span class="wfv-page-line wfv-page-line-short" />
                  </span>
                }
              >
                <img class="wfv-page-cover" src={item().thumbnail} alt="" />
              </Show>
              <progress class="wfv-progress" max="100" value={item().progress} />
            </button>
          </div>
        )}
      </Show>
    </div>
  );
};

export interface WelcomeFlashcardPreviewProps {
  card: Flashcard | null;
  loading: boolean;
  dueCount: number;
  dueLabel: string;
  emptyLabel: string;
  loadingLabel: string;
  openLabel: string;
  onOpen: () => void;
}

/** Stacked 3D deck: click flips the newest real card; empty/loading keeps a deck shell. */
export const WelcomeFlashcardPreview: Component<WelcomeFlashcardPreviewProps> = (props) => {
  const [flipped, setFlipped] = createSignal(false);

  const cardShell = (label: string) => (
    <div class="wfv-flashcard-shell">
      <span class="wfv-flashcard-shell-card wfv-flashcard-shell-card-back" aria-hidden="true" />
      <span class="wfv-flashcard-shell-card wfv-flashcard-shell-card-front">
        <span class="wfv-flashcard-text">{label}</span>
      </span>
    </div>
  );

  return (
    <div class="wfv-flashcard">
      <Show
        when={props.loading}
        fallback={
          <Show
            when={props.card}
            fallback={cardShell(props.emptyLabel)}
          >
            {(card) => (
              <button
                type="button"
                class="wfv-flashcard-stage"
                onClick={() => setFlipped((f) => !f)}
                aria-label={flipped() ? card().content.back : card().content.front}
                aria-pressed={flipped()}
              >
                <span
                  class="wfv-flashcard-inner"
                  classList={{ flipped: flipped() }}
                >
                  <span class="wfv-flashcard-face wfv-flashcard-front">
                    <span class="wfv-flashcard-text">{card().content.front}</span>
                    <Show when={card().content.reading}>
                      <span class="wfv-flashcard-reading">{card().content.reading}</span>
                    </Show>
                  </span>
                  <span class="wfv-flashcard-face wfv-flashcard-back">
                    <span class="wfv-flashcard-text">{card().content.back}</span>
                  </span>
                </span>
              </button>
            )}
          </Show>
        }
      >
        {cardShell(props.loadingLabel)}
      </Show>
      <div class="wfv-flashcard-row">
        <span class="wfv-flashcard-due">{props.dueLabel}: {props.dueCount}</span>
        <button type="button" class="wfv-tactile wfv-flashcard-open" onClick={props.onOpen}>
          {props.openLabel}
        </button>
      </div>
    </div>
  );
};

export interface WelcomeSettingsPreviewProps {
  generalLabel: string;
  appearanceLabel: string;
  aiLabel: string;
  shortcutsLabel: string;
  onOpen: () => void;
}

/** Compact settings menu: each row opens the existing Settings window. */
export const WelcomeSettingsPreview: Component<WelcomeSettingsPreviewProps> = (props) => {
  const rows = () => [
    props.generalLabel,
    props.appearanceLabel,
    props.aiLabel,
    props.shortcutsLabel,
  ];

  return (
    <div class="wfv-settings">
      <For each={rows()}>
        {(label) => (
          <button type="button" class="wfv-settings-row" onClick={props.onOpen}>
            <span class="wfv-settings-label">{label}</span>
            <svg class="wfv-settings-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        )}
      </For>
    </div>
  );
};

export interface WelcomeStatsPreviewProps {
  days: WeekStatDay[];
  newTotal: number;
  reviewsTotal: number;
  newLabel: string;
  reviewsLabel: string;
  weekdayLabels: string[];
  onOpen: () => void;
}

/** Seven-day activity chart from real study history; the whole chart opens statistics. */
export const WelcomeStatsPreview: Component<WelcomeStatsPreviewProps> = (props) => {
  const maxTotal = () => Math.max(...props.days.map((day) => day.total), 1);
  const point = (index: number, total: number) => ({
    x: 14 + index * 28,
    y: 46 - Math.round((total / maxTotal()) * 38),
  });
  const points = () => props.days.map((day, index) => point(index, day.total));
  const linePoints = () => points().map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <button
      type="button"
      class="wfv-week"
      onClick={props.onOpen}
      aria-label={`${props.newLabel} ${props.newTotal}, ${props.reviewsLabel} ${props.reviewsTotal}`}
    >
      <div class="wfv-week-body">
        <div class="wfv-week-plot">
          <svg class="wfv-week-chart" viewBox="0 0 200 52" role="img" aria-hidden="true">
            <polyline class="wfv-week-line" points={linePoints()} />
            <For each={points()}>
              {(p) => <circle class="wfv-week-point" cx={p.x} cy={p.y} r="3" />}
            </For>
          </svg>
          <div class="wfv-week-axis">
            <For each={props.weekdayLabels}>
              {(label) => <span class="wfv-week-day">{label}</span>}
            </For>
          </div>
        </div>
        <div class="wfv-week-totals">
          <span class="wfv-week-total">
            <span>{props.newLabel}</span>
            <strong>{props.newTotal}</strong>
          </span>
          <span class="wfv-week-total">
            <span>{props.reviewsLabel}</span>
            <strong>{props.reviewsTotal}</strong>
          </span>
        </div>
      </div>
    </button>
  );
};

export interface WelcomeLookupPreviewProps {
  mobile: boolean;
  draft: string;
  placeholder: string;
  searchLabel: string;
  emptyHint: string;
  rows: RecentWordRow[];
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onOpenDatabase: () => void;
  onLookupWord: (word: string) => void;
}

/** Custom search console plus real recent word rows; rows open a quick lookup. */
export const WelcomeLookupPreview: Component<WelcomeLookupPreviewProps> = (props) => {
  return (
    <div class="wfv-lookup">
      <Show
        when={props.mobile}
        fallback={
          <div class="wfv-lookup-console">
            <form
              class="wfv-lookup-form"
              onSubmit={(e) => {
                e.preventDefault();
                props.onSubmit();
              }}
            >
              <input
                class="wfv-lookup-input"
                type="text"
                value={props.draft}
                onInput={(e) => props.onDraftChange(e.currentTarget.value)}
                placeholder={props.placeholder}
                aria-label={props.searchLabel}
              />
              <button type="submit" class="wfv-tactile wfv-lookup-submit">
                <svg class="wfv-lookup-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
                <span>{props.searchLabel}</span>
              </button>
            </form>
            <Show
              when={props.rows.length > 0}
              fallback={<p class="wfv-empty wfv-lookup-empty">{props.emptyHint}</p>}
            >
              <div class="wfv-word-rows">
                <For each={props.rows}>
                  {(row) => (
                    <button
                      type="button"
                      class="wfv-word-row"
                      onClick={() => props.onLookupWord(row.word)}
                    >
                      <span class="wfv-word-front">{row.word}</span>
                      <Show when={row.reading}>
                        <span class="wfv-word-reading">{row.reading}</span>
                      </Show>
                      <span class="wfv-word-back">{row.back}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        }
      >
        <button type="button" class="wfv-tactile wfv-lookup-open" onClick={props.onOpenDatabase}>
          <svg class="wfv-lookup-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
          <span>{props.searchLabel}</span>
        </button>
      </Show>
    </div>
  );
};

export interface WelcomeLevelPreviewProps {
  coverage: { total: number; tracked: number; pct: number } | null;
  active: LevelStats | null;
  chips: LevelStats[];
  titleLabel: string;
  emptyLabel: string;
  onOpen: () => void;
}

/** Circular coverage dial with real metadata-driven level chips; empty keeps the dial shell. */
export const WelcomeLevelPreview: Component<WelcomeLevelPreviewProps> = (props) => {
  const knownPct = (level: LevelStats) => (
    level.total > 0 && level.known === level.total
      ? 100
      : Math.min(Math.round(level.knownPct), 99)
  );

  return (
    <div class="wfv-level">
      <button
        type="button"
        class="wfv-level-dial-wrap"
        onClick={props.onOpen}
        aria-label={props.coverage === null ? props.emptyLabel : `${props.titleLabel}: ${props.coverage.pct}%`}
      >
        <svg class="wfv-level-dial" viewBox="0 0 100 100" role="img" aria-hidden="true">
          <circle class="wfv-level-track" cx="50" cy="50" r="44" pathLength="100" />
          <Show when={props.coverage}>
            {(coverage) => (
              <circle
                class="wfv-level-fill"
                cx="50"
                cy="50"
                r="44"
                pathLength="100"
                stroke-dasharray="100"
                stroke-dashoffset={100 - coverage().pct}
              />
            )}
          </Show>
        </svg>
        <span class="wfv-level-value">{props.coverage === null ? '0%' : `${props.coverage.pct}%`}</span>
      </button>
      <Show
        when={props.coverage}
        fallback={<p class="wfv-empty">{props.emptyLabel}</p>}
      >
        {(coverage) => (
          <>
            <div class="wfv-level-chips">
              <For each={props.chips}>
                {(chip) => (
                  <span
                    class={`wfv-level-chip ${props.active !== null && chip.level === props.active.level ? 'wfv-level-chip-active' : ''}`}
                  >
                    <span class="wfv-level-chip-name">{chip.name}</span>
                    <span class="wfv-level-chip-pct">{knownPct(chip)}%</span>
                  </span>
                )}
              </For>
            </div>
            <p class="wfv-level-status">{coverage().tracked} / {coverage().total}</p>
          </>
        )}
      </Show>
    </div>
  );
};

export interface WelcomeTutorPreviewProps {
  ready: boolean;
  readyLabel: string;
  setupLabel: string;
  continueLabel: string;
  settingsLabel: string;
  onLaunch: () => void;
  onOpenSettings: () => void;
}

/** Conversation-launch surface: bubble stack, real readiness status, composer-shaped launch. */
export const WelcomeTutorPreview: Component<WelcomeTutorPreviewProps> = (props) => {
  const actionLabel = () => (props.ready ? props.continueLabel : props.settingsLabel);

  return (
    <div class="wfv-tutor">
      <div class="wfv-tutor-bubbles" aria-hidden="true">
        <span class="wfv-tutor-bubble wfv-tutor-bubble-a" />
        <span class="wfv-tutor-bubble wfv-tutor-bubble-b" />
        <span class="wfv-tutor-bubble wfv-tutor-bubble-c" />
      </div>
      <div class="wfv-tutor-status">
        <span
          class={`wfv-tutor-dot ${props.ready ? 'wfv-tutor-dot-ready' : 'wfv-tutor-dot-setup'}`}
          aria-hidden="true"
        />
        <span class="wfv-tutor-status-text">
          {props.ready ? props.readyLabel : props.setupLabel}
        </span>
      </div>
      <button
        type="button"
        class="wfv-composer"
        onClick={props.ready ? props.onLaunch : props.onOpenSettings}
        aria-label={actionLabel()}
      >
        <span class="wfv-composer-label">{actionLabel()}</span>
        <svg class="wfv-composer-send" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>
      </button>
    </div>
  );
};
