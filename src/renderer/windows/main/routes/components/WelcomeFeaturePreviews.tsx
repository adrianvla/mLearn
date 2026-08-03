/**
 * WelcomeFeaturePreviews
 * Bespoke tactile mini-app surfaces for the welcome feature grid. Each surface
 * reflects real app state and hands off to existing workflows via callbacks.
 */

import { Component, createEffect, createSignal, For, Show } from 'solid-js';
import type { Flashcard } from '../../../../../shared/types';
import type { RecentItem } from '../../../../services/thumbnailService';
import type { LevelStats } from '../../../../utils/wordLevelStats';
import type { RecentWordRow, WeekStatDay } from '../welcomeSelectors';
import type { Rating } from '../../../../services/srsAlgorithm';
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

export interface WelcomeFlashcardRating {
  quality: Rating;
  label: string;
  time: string;
}

export interface WelcomeFlashcardPreviewProps {
  card: Flashcard | null;
  loading: boolean;
  dueCount: number;
  dueLabel: string;
  emptyLabel: string;
  loadingLabel: string;
  openLabel: string;
  ratingButtons: WelcomeFlashcardRating[];
  onOpen: () => void;
  onRate: (quality: Rating) => void;
}

/** Compact reviewer: click flips the real due card, then rate it to advance; empty/loading keeps a deck shell. */
export const WelcomeFlashcardPreview: Component<WelcomeFlashcardPreviewProps> = (props) => {
  const [flipped, setFlipped] = createSignal(false);

  // Start each new card on its front (front-facing rating moves the session on).
  createEffect(() => {
    props.card?.id;
    setFlipped(false);
  });

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
      <Show when={props.card && flipped() && props.ratingButtons.length > 0}>
        <fieldset class="wfv-flashcard-ratings">
          <legend class="wfv-flashcard-ratings-legend">{props.dueLabel}</legend>
          <For each={props.ratingButtons}>
            {(btn) => (
              <button
                type="button"
                class={`wfv-tactile wfv-flashcard-rating wfv-flashcard-rating-${btn.quality}`}
                onClick={() => props.onRate(btn.quality)}
              >
                <span class="wfv-flashcard-rating-label">{btn.label}</span>
                <span class="wfv-flashcard-rating-time">{btn.time}</span>
              </button>
            )}
          </For>
        </fieldset>
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

export interface WelcomeSettingsRow {
  label: string;
  /** Settings tab section this row deep-links to (resolved by the Settings window). */
  section: string;
}

export interface WelcomeSettingsPreviewProps {
  rows: WelcomeSettingsRow[];
  onOpen: (section: string) => void;
}

/** Compact settings menu: each row opens the Settings window on its tab. */
export const WelcomeSettingsPreview: Component<WelcomeSettingsPreviewProps> = (props) => {
  return (
    <div class="wfv-settings">
      <For each={props.rows}>
        {(row) => (
          <button type="button" class="wfv-settings-row" onClick={() => props.onOpen(row.section)}>
            <span class="wfv-settings-label">{row.label}</span>
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
  /** True while the user has typed a search query (draft is non-empty). */
  searching: boolean;
  /** Localized hint shown when a search query matches no flashcards. */
  noMatchesLabel: string;
  /** Localized hint pointing at the Enter-key dictionary lookup escape hatch. */
  lookupHint: string;
  rows: RecentWordRow[];
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onOpenDatabase: () => void;
  onLookupWord: (word: string) => void;
}

/** Custom search console plus real word rows; rows open a quick lookup. */
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
            <div class="wfv-word-rows" aria-live="polite">
              <Show
                when={props.rows.length === 0}
                fallback={
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
                }
              >
                <div class="wfv-lookup-empty">
                  <p class="wfv-empty">
                    {props.searching ? props.noMatchesLabel : props.emptyHint}
                  </p>
                  <Show when={props.searching && props.rows.length === 0}>
                    <p class="wfv-lookup-hint">{props.lookupHint}</p>
                  </Show>
                </div>
              </Show>
            </div>
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

  const remainingChips = () => props.chips.filter(
    (chip) => props.active === null || chip.level !== props.active.level,
  );

  return (
    <div class="wfv-level">
      <div class="wfv-level-top">
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
            <div class="wfv-level-side">
              <Show when={props.active}>
                {(active) => (
                  <span class="wfv-level-chip wfv-level-chip-active">
                    <span class="wfv-level-chip-name">{active().name}</span>
                    <span class="wfv-level-chip-pct">{knownPct(active())}%</span>
                  </span>
                )}
              </Show>
              <p class="wfv-level-status">{coverage().tracked} / {coverage().total}</p>
            </div>
          )}
        </Show>
      </div>
      <Show when={props.coverage && remainingChips().length > 0}>
        <div class="wfv-level-chips">
          <For each={remainingChips()}>
            {(chip) => (
              <span class="wfv-level-chip">
                <span class="wfv-level-chip-name">{chip.name}</span>
                <span class="wfv-level-chip-pct">{knownPct(chip)}%</span>
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export interface WelcomeTutorPreviewProps {
  ready: boolean;
  readyLabel: string;
  setupLabel: string;
  placeholder: string;
  mobile: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}

/** Readiness status pill plus a real composer; setup state keeps the composer disabled. */
export const WelcomeTutorPreview: Component<WelcomeTutorPreviewProps> = (props) => {
  return (
    <div class="wfv-tutor">
      <div class="wfv-tutor-status">
        <span
          class={`wfv-tutor-dot ${props.ready ? 'wfv-tutor-dot-ready' : 'wfv-tutor-dot-setup'}`}
          aria-hidden="true"
        />
        <span class="wfv-tutor-status-text">
          {props.ready ? props.readyLabel : props.setupLabel}
        </span>
      </div>
      <Show
        when={props.mobile}
        fallback={
          <form
            class="wfv-tutor-composer"
            onSubmit={(e) => {
              e.preventDefault();
              props.onSubmit();
            }}
          >
            <input
              class="wfv-tutor-input"
              type="text"
              value={props.draft}
              placeholder={props.placeholder}
              aria-label={props.placeholder}
              disabled={!props.ready}
              onInput={(e) => props.onDraftChange(e.currentTarget.value)}
            />
            <button
              type="submit"
              class="wfv-tutor-send"
              disabled={!props.ready}
              aria-label={props.ready ? props.readyLabel : props.setupLabel}
            >
              <svg class="wfv-composer-send" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>
            </button>
          </form>
        }
      >
        <button type="button" class="wfv-tactile wfv-tutor-open" onClick={props.onSubmit}>
          {props.ready ? props.readyLabel : props.setupLabel}
        </button>
      </Show>
    </div>
  );
};
