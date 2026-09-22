/**
 * The canonical mLearn rating control — one rating UX everywhere (SRS review,
 * knowledge pills, word hover, Word Sync). A collapsed whole-word quality bar
 * that unfolds in place into the All + capability matrix. Layout only —
 * Button owns borders, colors, hover, disabled; theme variables only.
 *
 * Interaction contract (historical mLearn keyboard):
 * - Collapsed: 1/2/3/4 rate the whole word (Missed/Struggled/Fluent/Easy).
 * - Expanded (Adjust): same digits arm the pending column (mnemonic mode);
 *   the same digit again fills the All row; digit + capability mnemonic
 *   drafts that row. The word submits when every tested row has a draft or
 *   an explicit claim; claims themselves never become observations. Spatial mode maps 1-4/QWER/ASDF/
 *   ZXCV/7890 by quality × row, row 0 being All.
 * - Escape clears a pending chord first, then folds. Alt marks inference.
 * - Untouched rows fabricate no evidence; only explicit drafts and explicit
 *   All/whole-word actions emit observations.
 */
import { Component, For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  ATTEMPT_QUALITIES,
  type AttemptQuality,
  type WordStatus,
  type RatingKeyboardMode,
} from '../../../../shared/constants';
import type { CapabilityKey, CapabilityKind } from '../../../../shared/graph/types';
import { CAPABILITY_LABEL_KEYS, CAPABILITY_MNEMONIC_KEYS } from '../../../../shared/graph/access';
import { useLocalization } from '../../../context';
import { Button } from '../Button/Button';
import { KeyboardShortcut } from '../Misc/KeyboardShortcut';
import { isRatingKeyIgnored } from '../../../utils/ratingShortcuts';
import './RatingMatrix.css';

/** Fluent-only scheduler preference: evidence remains fluent. */
export interface RateOptions {
  method?: 'recall' | 'inference';
  easy?: boolean;
}

export interface ProfileObservation {
  capability: CapabilityKey;
  quality: AttemptQuality;
  method?: 'recall' | 'inference';
  easy?: boolean;
}

export interface RatingMatrixProps {
  /** Tested capability rows, in display order — revealed cues included; scaffold
   * weighting stays in the evidence layer. Core kinds and package-declared keys alike. */
  capabilities: readonly CapabilityKey[];
  /** Saved statements displayed using the same quality selections as manual ratings. */
  claims?: Readonly<Partial<Record<CapabilityKey, WordStatus>>>;
  /** Package-resolved labels for opaque capability ids. */
  capabilityLabels?: Readonly<Partial<Record<CapabilityKey, string>>>;
  /** Whole-word selection; specific capability statements take precedence. */
  wordClaim?: WordStatus | null;
  keyboardMode: RatingKeyboardMode;
  /** The control owns its rating keys only while armed. */
  armed: boolean;
  /** Resets drafts, collapse state and the submitted guard when it changes. */
  resetKey?: string | number;
  /** Focused probes show their exact tested rows immediately. */
  initiallyExpanded?: boolean;
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

// Same variant mapping the SRS rating buttons used:
// missed=again (danger), struggled=hard (warning), fluent=good (success),
// easy (primary).
const ACTION_VARIANTS: Record<RatingAction, 'danger' | 'warning' | 'success' | 'primary'> = {
  missed: 'danger',
  struggled: 'warning',
  fluent: 'success',
  easy: 'primary',
};

// Local spatial table: the All row is row 0 (digits), capability rows follow
// on QWER/ASDF/ZXCV/7890. Rows beyond the table are click-only.
const SPATIAL_ACTION_ROWS: Record<RatingAction, readonly string[]> = {
  missed: ['1', 'q', 'a', 'z', '7'],
  struggled: ['2', 'w', 's', 'x', '8'],
  fluent: ['3', 'e', 'd', 'c', '9'],
  easy: ['4', 'r', 'f', 'v', '0'],
};

interface AccessDraft {
  quality: AttemptQuality;
  method?: 'recall' | 'inference';
  easy?: boolean;
}

/** Evidence carried by a quality action: Easy is fluent + the scheduler preference. */
const actionEvidence = (action: RatingAction): AccessDraft =>
  action === 'easy' ? { quality: 'fluent', easy: true } : { quality: action };

export const RatingMatrix: Component<RatingMatrixProps> = (props) => {
  const { t } = useLocalization();
  const [pendingQuality, setPendingQuality] = createSignal<RatingAction | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [drafts, setDrafts] = createStore<Partial<Record<CapabilityKey, AccessDraft>>>({});
  let pendingTimer: number | undefined;

  const claimQuality = (capability: CapabilityKey): AttemptQuality | undefined => {
    const status = props.claims?.[capability]
      ?? (props.capabilities.includes(capability) ? props.wordClaim : undefined);
    return status === 'known' ? 'fluent' : status === 'learning' ? 'struggled' : status === 'unknown' ? 'missed' : undefined;
  };
  const displayedCapabilities = () => [...new Set([
    ...props.capabilities,
    ...Object.keys(props.claims ?? {}).filter((capability) => props.claims?.[capability] !== undefined),
  ])];
  const capabilityLabel = (capability: CapabilityKey): string => props.capabilityLabels?.[capability]
    ?? t(CAPABILITY_LABEL_KEYS[capability] ?? capability);

  const actionable = () => props.armed && !submitted() && props.capabilities.length > 0;

  const clearPending = () => {
    clearTimeout(pendingTimer);
    pendingTimer = undefined;
    setPendingQuality(null);
  };

  const clearDrafts = () => {
    for (const key of Object.keys(drafts)) setDrafts(key as CapabilityKey, undefined);
  };

  createEffect(on(() => props.resetKey, () => {
    clearDrafts();
    setExpanded(props.initiallyExpanded === true);
    setSubmitted(false);
    clearPending();
  }));
  // An explanation supersedes any earlier draft for the affected row. Undo
  // removes that selection through the same reactive claim source.
  createEffect(on(() => props.claims, (claims, previous) => {
    for (const capability of new Set([...Object.keys(claims ?? {}), ...Object.keys(previous ?? {})])) {
      if (claims?.[capability] !== previous?.[capability]) {
        setDrafts(capability, undefined);
      }
    }
  }));
  createEffect(on(() => props.wordClaim, () => clearDrafts()));

  const submit = (observations: readonly ProfileObservation[], opts?: RateOptions) => {
    if (submitted()) return;
    setSubmitted(true);
    clearDrafts();
    clearPending();
    // A fully-Easy drafted profile carries the scheduler preference even
    // though per-row drafts submit without explicit options. Existing
    // options (method) merge rather than get replaced.
    const derivedOpts = observations.length > 0 && observations.every((observation) => observation.easy)
      ? { ...opts, easy: true }
      : opts;
    props.onSubmit(observations, derivedOpts);
  };

  const observationFromDraft = (capability: CapabilityKey, draft: AccessDraft): ProfileObservation => ({
    capability,
    quality: draft.quality,
    ...(draft.method ? { method: draft.method } : {}),
    ...(draft.easy ? { easy: true } : {}),
  });

  /** Collapsed bar: the whole word is rated at one quality; drafts are discarded. */
  const submitWholeWord = (action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    const evidence = actionEvidence(action);
    const observations: ProfileObservation[] = props.capabilities.map((capability) => ({
      capability,
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
   * All row: fill every tested capability WITHOUT an explicit draft (explicit
   * drafts stand); Alt marks only the filled accesses as worked out. All is
   * an explicit everything-rating and always completes the word.
   */
  const fillAll = (action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    const evidence = actionEvidence(action);
    const observations: ProfileObservation[] = props.capabilities.map((capability) => {
      const draft = drafts[capability];
      if (draft) return observationFromDraft(capability, draft);
      return {
        capability,
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

  /** Complete when every tested row is explicitly rated or already claimed; only drafts become observations. */
  const draftAccess = (capability: CapabilityKey, action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    clearPending();
    const evidence = actionEvidence(action);
    setDrafts(capability, {
      quality: evidence.quality,
      ...(alt ? { method: 'inference' as const } : {}),
      ...(evidence.easy ? { easy: true as const } : {}),
    });
    const observations: ProfileObservation[] = [];
    for (const tested of props.capabilities) {
      const draft = drafts[tested];
      if (draft) observations.push(observationFromDraft(tested, draft));
      else if (claimQuality(tested) === undefined) return; // An untouched, unclaimed row is still unanswered.
    }
    submit(observations, undefined);
  };

  const toggleExpanded = () => {
    if (!actionable()) return;
    if (expanded()) clearPending();
    setExpanded((shown) => !shown);
  };

  const isSelected = (capability: CapabilityKey, action: RatingAction): boolean => {
    const quality = claimQuality(capability);
    const draft = drafts[capability] ?? (quality ? { quality } : undefined);
    if (!draft) return false;
    if (action === 'easy') return draft.quality === 'fluent' && !!draft.easy;
    return draft.quality === action && !draft.easy;
  };

  const isAllSelected = (action: RatingAction): boolean => props.capabilities.length > 0
    && props.capabilities.every((capability) => isSelected(capability, action));

  const cellHint = (capability: CapabilityKey, action: RatingAction): string[] => {
    if (props.keyboardMode === 'mnemonic') {
      const mnemonic = CAPABILITY_MNEMONIC_KEYS[capability as CapabilityKind]?.toUpperCase() ?? '·';
      return pendingQuality() === action ? [ACTION_KEYS[action], mnemonic] : [ACTION_KEYS[action]];
    }
    const rowIndex = props.capabilities.indexOf(capability) + 1; // row 0 is the All row
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
          clearTimeout(pendingTimer);
          pendingTimer = window.setTimeout(clearPending, PENDING_TIMEOUT_MS);
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
      const capability = props.capabilities.find((candidate) => CAPABILITY_MNEMONIC_KEYS[candidate as CapabilityKind] === key);
      if (capability) {
        e.preventDefault();
        draftAccess(capability, pending, e.altKey);
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
      else if (rowIndex <= props.capabilities.length) draftAccess(props.capabilities[rowIndex - 1], candidate, e.altKey);
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
    <div class="rating-matrix" classList={{ 'rating-matrix--expanded': expanded() }}>
      <div class="rating-matrix__bar" classList={{ 'rating-matrix__bar--head': expanded() }}>
        <Show when={expanded()}>
          <span class="rating-matrix__corner" aria-hidden="true" />
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
                  class="rating-matrix__quality"
                  classList={{ 'rating-matrix__cell--selected': isAllSelected(action) }}
                  aria-pressed={isAllSelected(action)}
                  disabled={!actionable()}
                  onClick={(e) => submitWholeWord(action, e.altKey)}
                >
                  {t(ACTION_LABEL_KEYS[action])}
                </Button>
              }
            >
              <span
                class="rating-matrix__col"
                classList={{ 'rating-matrix__col--pending': pendingQuality() === action }}
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
          class="rating-matrix__adjust"
          disabled={!actionable()}
          aria-expanded={expanded()}
          onClick={toggleExpanded}
        >
          {t('mlearn.Rating.Compact.Adjust')}
        </Button>
      </div>
      <Show when={expanded()}>
        <div class="rating-matrix__unfold">
          <div class="rating-matrix__row rating-matrix__row--all">
            <span class="rating-matrix__label rating-matrix__label--all">{t('mlearn.Rating.Matrix.AllRow')}</span>
            <For each={RATING_ACTIONS}>
              {(action) => (
                <Button
                  buttonType="default"
                  variant={ACTION_VARIANTS[action]}
                  size="xs"
                  class="rating-matrix__cell"
                  disabled={!actionable()}
                  classList={{ 'rating-matrix__cell--selected': isAllSelected(action) }}
                  aria-pressed={isAllSelected(action)}
                  aria-label={`${t('mlearn.Rating.Matrix.AllRow')}: ${t(ACTION_LABEL_KEYS[action])}`}
                  onClick={(e) => fillAll(action, e.altKey)}
                >
                  <KeyboardShortcut keys={[ACTION_KEYS[action]]} class="rating-matrix__hint" />
                </Button>
              )}
            </For>
          </div>
          <For each={displayedCapabilities()}>
            {(capability) => (
              <div class="rating-matrix__row">
                <span class="rating-matrix__label">
                  {capabilityLabel(capability)}
                </span>
                <For each={RATING_ACTIONS}>
                  {(action) => (
                    <Button
                      buttonType="default"
                      variant={ACTION_VARIANTS[action]}
                      size="xs"
                      class="rating-matrix__cell"
                      classList={{ 'rating-matrix__cell--selected': isSelected(capability, action) }}
                      aria-pressed={isSelected(capability, action)}
                      aria-label={`${capabilityLabel(capability)}: ${t(ACTION_LABEL_KEYS[action])}`}
                      disabled={!actionable() || !props.capabilities.includes(capability)}
                      onClick={(e) => draftAccess(capability, action, e.altKey)}
                    >
                      <Show when={props.capabilities.includes(capability)}>
                        <KeyboardShortcut keys={cellHint(capability, action)} class="rating-matrix__hint" />
                      </Show>
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
