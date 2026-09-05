/**
 * Word Sync's progressive-disclosure rating control.
 *
 * Collapsed: one bar of four whole-word qualities (Missed / Struggled /
 * Fluent / Easy) plus an Adjust toggle. A quality click or digit 1-4
 * submits EVERY applicable aspect at that quality immediately and discards
 * any drafts — Easy is fluent evidence plus the `easy` scheduling
 * preference, never a fourth evidence level.
 *
 * Adjust unfolds the bar in place into its dimensions: the All row first
 * (fills every aspect that has no explicit draft and always completes the
 * word), then one row per applicable aspect whose cells only draft. The
 * moment every applicable aspect holds a rating, the full observation set
 * submits exactly once; a submitted guard reset by `resetKey` makes
 * same-tick double-fires impossible.
 *
 * Profile-only by design: this component never touches stores or contexts —
 * the parent turns the observations into one attempt and advances.
 */
import { Component, For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  ATTEMPT_QUALITIES,
  ASPECT_MNEMONIC_KEYS,
  KNOWLEDGE_ASPECT_LABEL_KEYS,
  type AttemptQuality,
  type KnowledgeAspect,
  type RatingKeyboardMode,
} from '../../../shared/constants';
import type { ProfileObservation, RateOptions } from '../../components/common';
import { useLocalization } from '../../context';
import { Button } from '../../components/common/Button/Button';
import { KeyboardShortcut } from '../../components/common/Misc/KeyboardShortcut';
import { isRatingKeyIgnored } from '../../utils/ratingShortcuts';
import './WordSyncRating.css';

export interface WordSyncRatingProps {
  /** Applicable/tested rows, in display order. */
  aspects: readonly KnowledgeAspect[];
  keyboardMode: RatingKeyboardMode;
  /** The control owns its rating keys only while armed. */
  armed: boolean;
  /** Resets drafts, collapse state and the submitted guard when it changes. */
  resetKey: string | number;
  /** One logical attempt: the full observation set, in display order. */
  onSubmit: (observations: readonly ProfileObservation[], opts?: RateOptions) => void;
}

const PENDING_TIMEOUT_MS = 1500;

// The four visible qualities: the three evidence levels plus Easy, the
// fluent scheduling preference.
const RATING_ACTIONS = [...ATTEMPT_QUALITIES, 'easy'] as const;
type RatingAction = typeof RATING_ACTIONS[number];

// Digits mean the same four qualities collapsed and unfolded — 1/2/3/4 =
// Missed/Struggled/Fluent/Easy everywhere.
const ACTION_KEYS: Record<RatingAction, string> = { missed: '1', struggled: '2', fluent: '3', easy: '4' };

const ACTION_LABEL_KEYS: Record<RatingAction, string> = {
  missed: 'mlearn.Rating.Matrix.Missed',
  struggled: 'mlearn.Rating.Matrix.Struggled',
  fluent: 'mlearn.Rating.Matrix.Fluent',
  easy: 'mlearn.Rating.Matrix.Easy',
};

// Same variant mapping the SRS rating buttons used (see RatingMatrix):
// missed=again (danger), struggled=hard (warning), fluent=good (success),
// all-fluent=easy (primary).
const ACTION_VARIANTS: Record<RatingAction, 'danger' | 'warning' | 'success' | 'primary'> = {
  missed: 'danger',
  struggled: 'warning',
  fluent: 'success',
  easy: 'primary',
};

// Word Sync's local spatial table: the All row is row 0 (digits), aspect
// rows follow on QWER/ASDF/ZXCV/7890. Mirrors shared SPATIAL_QUALITY_KEYS
// with a prepended All row — kept local because the shared table has no All
// row and must not change.
const SPATIAL_ACTION_ROWS: Record<RatingAction, readonly string[]> = {
  missed: ['1', 'q', 'a', 'z', '7'],
  struggled: ['2', 'w', 's', 'x', '8'],
  fluent: ['3', 'e', 'd', 'c', '9'],
  easy: ['4', 'r', 'f', 'v', '0'],
};

interface AspectDraft {
  quality: AttemptQuality;
  method?: 'recall' | 'inference';
  easy?: boolean;
}

/** Evidence carried by a quality action: Easy is fluent + the scheduler preference. */
const actionEvidence = (action: RatingAction): AspectDraft =>
  action === 'easy' ? { quality: 'fluent', easy: true } : { quality: action };

export const WordSyncRating: Component<WordSyncRatingProps> = (props) => {
  const { t } = useLocalization();
  const [pendingQuality, setPendingQuality] = createSignal<RatingAction | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [drafts, setDrafts] = createStore<Partial<Record<KnowledgeAspect, AspectDraft>>>({});
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const actionable = () => props.armed && !submitted();

  const clearPending = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    setPendingQuality(null);
  };

  const clearDrafts = () => {
    for (const key of Object.keys(drafts)) setDrafts(key as KnowledgeAspect, undefined);
  };

  createEffect(on(() => props.resetKey, () => {
    clearDrafts();
    setExpanded(false);
    setSubmitted(false);
    clearPending();
  }));

  /** Single submit boundary: guard first, then emit — same-tick re-entry is inert. */
  const submit = (observations: readonly ProfileObservation[], opts?: RateOptions) => {
    if (submitted()) return;
    setSubmitted(true);
    clearDrafts();
    clearPending();
    props.onSubmit(observations, opts);
  };

  const observationFromDraft = (aspect: KnowledgeAspect, draft: AspectDraft): ProfileObservation => ({
    aspect,
    quality: draft.quality,
    ...(draft.method ? { method: draft.method } : {}),
    ...(draft.easy ? { easy: true } : {}),
  });

  /** Collapsed bar: the whole word is rated at one quality; drafts are discarded. */
  const submitWholeWord = (action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    const evidence = actionEvidence(action);
    const observations: ProfileObservation[] = props.aspects.map((aspect) => ({
      aspect,
      quality: evidence.quality,
      ...(evidence.easy ? { easy: true } : {}),
      ...(alt ? { method: 'inference' as const } : {}),
    }));
    const opts: RateOptions = {};
    if (action === 'easy') opts.easy = true;
    if (alt) opts.method = 'inference';
    submit(observations, Object.keys(opts).length > 0 ? opts : undefined);
  };

  /**
   * All row: fill every aspect WITHOUT an explicit draft (explicit drafts
   * stand); Alt marks only the filled aspects as worked out. All always
   * completes the word.
   */
  const fillAll = (action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    const evidence = actionEvidence(action);
    const observations: ProfileObservation[] = props.aspects.map((aspect) => {
      const draft = drafts[aspect];
      if (draft) return observationFromDraft(aspect, draft);
      return {
        aspect,
        quality: evidence.quality,
        ...(evidence.easy ? { easy: true } : {}),
        ...(alt ? { method: 'inference' as const } : {}),
      };
    });
    const opts: RateOptions = {};
    if (action === 'easy') opts.easy = true;
    if (alt) opts.method = 'inference';
    submit(observations, Object.keys(opts).length > 0 ? opts : undefined);
  };

  /** Aspect cell: draft only; submits the moment the last aspect is rated. */
  const draftAspect = (aspect: KnowledgeAspect, action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    clearPending();
    const evidence = actionEvidence(action);
    setDrafts(aspect, {
      quality: evidence.quality,
      ...(alt ? { method: 'inference' as const } : {}),
      ...(evidence.easy ? { easy: true as const } : {}),
    });
    const observations: ProfileObservation[] = [];
    for (const rated of props.aspects) {
      const draft = drafts[rated];
      if (!draft) return; // Partial states never submit.
      observations.push(observationFromDraft(rated, draft));
    }
    submit(observations, undefined);
  };

  const toggleExpanded = () => {
    if (!actionable()) return;
    if (expanded()) clearPending();
    setExpanded((shown) => !shown);
  };

  const isDraftSelected = (aspect: KnowledgeAspect, action: RatingAction): boolean => {
    const draft = drafts[aspect];
    if (!draft) return false;
    if (action === 'easy') return draft.quality === 'fluent' && !!draft.easy;
    return draft.quality === action && !draft.easy;
  };

  const cellHint = (aspect: KnowledgeAspect, action: RatingAction): string[] => {
    if (props.keyboardMode === 'mnemonic') {
      return pendingQuality() === action
        ? [ACTION_KEYS[action], ASPECT_MNEMONIC_KEYS[aspect].toUpperCase()]
        : [ACTION_KEYS[action]];
    }
    const rowIndex = props.aspects.indexOf(aspect) + 1; // row 0 is the All row
    return [SPATIAL_ACTION_ROWS[action][rowIndex]?.toUpperCase() ?? '·'];
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!actionable()) return;
    const buttonTarget = e.target instanceof HTMLElement && e.target.matches('button, [role="button"]');
    if (isRatingKeyIgnored(e) && !buttonTarget) return;
    if (e.metaKey || e.ctrlKey) return;
    const key = e.key.toLowerCase();

    if (e.key === 'Escape') {
      // Clear the pending chord first, else fold. Never submits.
      if (pendingQuality()) clearPending();
      else if (expanded()) setExpanded(false);
      return;
    }

    const action = RATING_ACTIONS.find((candidate) => ACTION_KEYS[candidate] === key);
    if (action) {
      e.preventDefault();
      if (!expanded()) {
        // Collapsed (both modes): digits are whole-word qualities, one
        // keydown per rating — no parser, the submitted guard absorbs strays.
        submitWholeWord(action, e.altKey);
      } else if (props.keyboardMode === 'mnemonic') {
        if (pendingQuality() === action) {
          // Same digit again while pending = the All row at that quality.
          // Chord completions are letters, so digit-digit can never misfire.
          fillAll(action, e.altKey);
        } else {
          setPendingQuality(action);
          if (pendingTimer !== undefined) clearTimeout(pendingTimer);
          pendingTimer = setTimeout(clearPending, PENDING_TIMEOUT_MS);
        }
      } else {
        // Spatial unfolded: digits are the All row (row 0).
        fillAll(action, e.altKey);
      }
      return;
    }

    if (!expanded()) return;

    if (props.keyboardMode === 'mnemonic') {
      const pending = pendingQuality();
      if (!pending) return;
      const aspect = props.aspects.find((candidate) => ASPECT_MNEMONIC_KEYS[candidate] === key);
      if (aspect) {
        e.preventDefault();
        draftAspect(aspect, pending, e.altKey);
      }
      return;
    }

    // Spatial: key = quality column × displayed row; row 0 is the All row,
    // rows beyond the last keyed row are click-only.
    for (const candidate of RATING_ACTIONS) {
      const rowIndex = SPATIAL_ACTION_ROWS[candidate].indexOf(key);
      if (rowIndex < 0) continue;
      e.preventDefault();
      if (rowIndex === 0) fillAll(candidate, e.altKey);
      else if (rowIndex <= props.aspects.length) draftAspect(props.aspects[rowIndex - 1], candidate, e.altKey);
      return;
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      clearPending();
    });
  });

  return (
    <div class="word-sync-rating" classList={{ 'word-sync-rating--expanded': expanded() }}>
      <div class="word-sync-rating__bar" classList={{ 'word-sync-rating__bar--head': expanded() }}>
        <Show when={expanded()}>
          <span class="word-sync-rating__corner" aria-hidden="true" />
        </Show>
        <For each={RATING_ACTIONS}>
          {(action) => (
            <Show
              when={expanded()}
              fallback={
                <Button
                  buttonType="default"
                  variant={ACTION_VARIANTS[action]}
                  size="sm"
                  class="word-sync-rating__quality"
                  disabled={!actionable()}
                  onClick={(e) => submitWholeWord(action, e.altKey)}
                >
                  {t(ACTION_LABEL_KEYS[action])}
                </Button>
              }
            >
              <span
                class="word-sync-rating__col"
                classList={{ 'word-sync-rating__col--pending': pendingQuality() === action }}
              >
                {t(ACTION_LABEL_KEYS[action])}
              </span>
            </Show>
          )}
        </For>
        <Button
          buttonType="default"
          variant="ghost"
          size="sm"
          class="word-sync-rating__adjust"
          disabled={!actionable()}
          aria-expanded={expanded()}
          onClick={toggleExpanded}
        >
          {t('mlearn.Rating.Compact.Adjust')}
        </Button>
      </div>
      <Show when={expanded()}>
        <div class="word-sync-rating__unfold">
          <div class="word-sync-rating__row word-sync-rating__row--all">
            <span class="word-sync-rating__label word-sync-rating__label--all">{t('mlearn.WordSync.Rating.AllRow')}</span>
            <For each={RATING_ACTIONS}>
              {(action) => (
                <Button
                  buttonType="default"
                  variant={ACTION_VARIANTS[action]}
                  size="xs"
                  class="word-sync-rating__cell"
                  disabled={!actionable()}
                  onClick={(e) => fillAll(action, e.altKey)}
                >
                  <KeyboardShortcut keys={[ACTION_KEYS[action]]} class="word-sync-rating__hint" />
                </Button>
              )}
            </For>
          </div>
          <For each={props.aspects}>
            {(aspect) => (
              <div class="word-sync-rating__row">
                <span class="word-sync-rating__label">{t(KNOWLEDGE_ASPECT_LABEL_KEYS[aspect])}</span>
                <For each={RATING_ACTIONS}>
                  {(action) => (
                    <Button
                      buttonType="default"
                      variant={ACTION_VARIANTS[action]}
                      size="xs"
                      class="word-sync-rating__cell"
                      classList={{ 'word-sync-rating__cell--selected': isDraftSelected(aspect, action) }}
                      disabled={!actionable()}
                      onClick={(e) => draftAspect(aspect, action, e.altKey)}
                    >
                      <KeyboardShortcut keys={cellHint(aspect, action)} class="word-sync-rating__hint" />
                    </Button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
