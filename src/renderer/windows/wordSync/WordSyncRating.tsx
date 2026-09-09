/**
 * Word Sync's progressive-disclosure rating control.
 *
 * Collapsed: one bar of four whole-word qualities (Missed / Struggled /
 * Fluent / Easy) plus an Adjust toggle. A quality click or digit 1-4 records
 * the MEASURED accesses — the ones the presentation actually exercised
 * (written-form recognition, sense, reading) — and discards any drafts. A
 * task that never measured an access (prosody in particular) stays
 * unmeasured: no fabricated evidence. Easy is fluent evidence plus the
 * `easy` scheduling preference, never a fourth evidence level.
 *
 * Adjust unfolds the bar in place: the All row first (fills every access
 * that has no explicit draft and always completes the word), then one row
 * per tested access whose cells only draft, then natural statements — the
 * learner's own words ("I know this word when I hear it") that the parent
 * encodes as claims or evidence. The moment every tested access holds a
 * draft, the full observation set submits exactly once; a submitted guard
 * reset by `resetKey` makes same-tick double-fires impossible.
 *
 * Statement/observation encoding lives in the parent — this component never
 * touches stores or contexts.
 */
import { Component, For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  ATTEMPT_QUALITIES,
  type AttemptQuality,
  type RatingKeyboardMode,
} from '../../../shared/constants';
import type { CapabilityKind } from '../../../shared/graph/types';
import { measurableAccesses, type AttemptScaffolds } from '../../../shared/knowledgeEvents';
import { CAPABILITY_LABEL_KEYS, CAPABILITY_MNEMONIC_KEYS } from '../../../shared/graph/access';
import type { ProfileObservation, RateOptions } from '../../components/common';
import { useLocalization } from '../../context';
import { Button } from '../../components/common/Button/Button';
import { KeyboardShortcut } from '../../components/common/Misc/KeyboardShortcut';
import { isRatingKeyIgnored } from '../../utils/ratingShortcuts';
import './WordSyncRating.css';

/**
 * A natural learner correction about the word. The parent encodes each as
 * claims/evidence — the learner never sees the claim/evidence distinction.
 */
export type WordSyncStatement =
  | { kind: 'known-spoken' }               // "I know this word when I hear it."
  | { kind: 'known-meaning-unknown-form' } // "I know the meaning but not this spelling."
  | { kind: 'known-characters' }           // "I know the individual characters."
  | { kind: 'inferred-from-parts' }        // "I can infer the meaning from the parts."
  | { kind: 'readable-pitch-wrong' }       // "I can read it, but my pitch is wrong."
  | { kind: 'never-seen-form' };           // "I have never seen this form."

const STATEMENT_KEYS: Record<WordSyncStatement['kind'], string> = {
  'known-spoken': 'mlearn.WordSync.Statement.KnownSpoken',
  'known-meaning-unknown-form': 'mlearn.WordSync.Statement.MeaningNotForm',
  'known-characters': 'mlearn.WordSync.Statement.KnownCharacters',
  'inferred-from-parts': 'mlearn.WordSync.Statement.InferredFromParts',
  'readable-pitch-wrong': 'mlearn.WordSync.Statement.ReadablePitchWrong',
  'never-seen-form': 'mlearn.WordSync.Statement.NeverSeenForm',
};

export interface WordSyncRatingProps {
  /** Tested access rows, in display order (data availability). */
  accesses: readonly CapabilityKind[];
  /**
   * What the prompt actually supplied during retrieval. Accesses whose cue
   * the scaffold already gave (furigana → reading, translation → sense,
   * prosody color → prosody) are excluded from every measured row — the
   * collapsed bar, the Adjust matrix, and keyboard rows alike.
   */
  scaffolds?: AttemptScaffolds;
  keyboardMode: RatingKeyboardMode;
  /** The control owns its rating keys only while armed. */
  armed: boolean;
  /** Resets drafts, collapse state and the submitted guard when it changes. */
  resetKey: string | number;
  /** A spoken representation exists for this word (enables the heard-it statement). */
  hasSpokenForm?: boolean;
  /** Graph character components exist for this word (enables the characters statement). */
  hasCharacterComponents?: boolean;
  /** One logical attempt: the full observation set, in display order. */
  onSubmit: (observations: readonly ProfileObservation[], opts?: RateOptions) => void;
  /** A natural statement was chosen; parent encodes claims/evidence. */
  onStatement: (statement: WordSyncStatement) => void;
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

// Word Sync's local spatial table: the All row is row 0 (digits), access
// rows follow on QWER/ASDF/ZXCV/7890. Mirrors shared SPATIAL_QUALITY_KEYS
// with a prepended All row — kept local because the shared table has no All
// row and must not change.
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

export const WordSyncRating: Component<WordSyncRatingProps> = (props) => {
  const { t } = useLocalization();
  const [pendingQuality, setPendingQuality] = createSignal<RatingAction | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(false);
  const [drafts, setDrafts] = createStore<Partial<Record<CapabilityKind, AccessDraft>>>({});
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const actionable = () => props.armed && !submitted();

  // Accesses this attempt actually MEASURES: the tested set minus what the
  // presentation itself supplied. A written word-presentation exercises the
  // written-form bridge, the sense, and (reading annotation hidden) the
  // surface→pronunciation path; with furigana visible the reading row is
  // cued recognition and stays unmeasured. The scaffold→access rule is the
  // shared measurability derivation — never a per-surface hardcoded filter.
  const measuredRows = () => measurableAccesses(props.accesses, props.scaffolds);

  const statementRows = (): WordSyncStatement[] => {
    const rows: WordSyncStatement[] = [
      { kind: 'known-meaning-unknown-form' },
      { kind: 'never-seen-form' },
      { kind: 'inferred-from-parts' },
    ];
    if (props.hasSpokenForm) rows.unshift({ kind: 'known-spoken' });
    if (props.accesses.includes('prosodic-pattern')) rows.push({ kind: 'readable-pitch-wrong' });
    if (props.hasCharacterComponents) rows.push({ kind: 'known-characters' });
    return rows;
  };

  const clearPending = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    setPendingQuality(null);
  };

  const clearDrafts = () => {
    for (const key of Object.keys(drafts)) setDrafts(key as CapabilityKind, undefined);
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

  const observationFromDraft = (capability: CapabilityKind, draft: AccessDraft): ProfileObservation => ({
    capability,
    quality: draft.quality,
    ...(draft.method ? { method: draft.method } : {}),
    ...(draft.easy ? { easy: true } : {}),
  });

  /** Collapsed bar: the whole word is rated at one quality; drafts are discarded. */
  const submitWholeWord = (action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    const evidence = actionEvidence(action);
    const observations: ProfileObservation[] = measuredRows().map((capability) => ({
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
   * All row: fill every tested access WITHOUT an explicit draft (explicit
   * drafts stand); Alt marks only the filled accesses as worked out. All is
   * an explicit everything-rating and always completes the word.
   */
  const fillAll = (action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    const evidence = actionEvidence(action);
    const observations: ProfileObservation[] = measuredRows().map((capability) => {
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

  /** Access cell: draft only; submits the moment the last access is drafted. */
  const draftAccess = (capability: CapabilityKind, action: RatingAction, alt: boolean) => {
    if (!actionable()) return;
    clearPending();
    const evidence = actionEvidence(action);
    setDrafts(capability, {
      quality: evidence.quality,
      ...(alt ? { method: 'inference' as const } : {}),
      ...(evidence.easy ? { easy: true as const } : {}),
    });
    const observations: ProfileObservation[] = [];
    for (const tested of measuredRows()) {
      const draft = drafts[tested];
      if (!draft) return; // Partial states never submit.
      observations.push(observationFromDraft(tested, draft));
    }
    submit(observations, undefined);
  };

  const toggleExpanded = () => {
    if (!actionable()) return;
    if (expanded()) clearPending();
    setExpanded((shown) => !shown);
  };

  const chooseStatement = (statement: WordSyncStatement) => {
    if (!actionable()) return;
    setSubmitted(true);
    clearDrafts();
    clearPending();
    props.onStatement(statement);
  };

  const isDraftSelected = (capability: CapabilityKind, action: RatingAction): boolean => {
    const draft = drafts[capability];
    if (!draft) return false;
    if (action === 'easy') return draft.quality === 'fluent' && !!draft.easy;
    return draft.quality === action && !draft.easy;
  };

  const cellHint = (capability: CapabilityKind, action: RatingAction): string[] => {
    if (props.keyboardMode === 'mnemonic') {
      return pendingQuality() === action
        ? [ACTION_KEYS[action], CAPABILITY_MNEMONIC_KEYS[capability].toUpperCase()]
        : [ACTION_KEYS[action]];
    }
    const rowIndex = measuredRows().indexOf(capability) + 1; // row 0 is the All row
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
      const capability = measuredRows().find((candidate) => CAPABILITY_MNEMONIC_KEYS[candidate] === key);
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
      else if (rowIndex <= measuredRows().length) draftAccess(measuredRows()[rowIndex - 1], candidate, e.altKey);
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
          <For each={measuredRows()}>
            {(capability) => (
              <div class="word-sync-rating__row">
                <span class="word-sync-rating__label">{t(CAPABILITY_LABEL_KEYS[capability])}</span>
                <For each={RATING_ACTIONS}>
                  {(action) => (
                    <Button
                      buttonType="default"
                      variant={ACTION_VARIANTS[action]}
                      size="xs"
                      class="word-sync-rating__cell"
                      classList={{ 'word-sync-rating__cell--selected': isDraftSelected(capability, action) }}
                      disabled={!actionable()}
                      onClick={(e) => draftAccess(capability, action, e.altKey)}
                    >
                      <KeyboardShortcut keys={cellHint(capability, action)} class="word-sync-rating__hint" />
                    </Button>
                  )}
                </For>
              </div>
            )}
          </For>
          <div class="word-sync-rating__statements">
            <span class="word-sync-rating__statements-label">{t('mlearn.WordSync.Statement.Label')}</span>
            <div class="word-sync-rating__statement-list">
              <For each={statementRows()}>
                {(statement) => (
                  <Button
                    buttonType="default"
                    variant="ghost"
                    size="xs"
                    class="word-sync-rating__statement"
                    disabled={!actionable()}
                    onClick={() => chooseStatement(statement)}
                  >
                    {t(STATEMENT_KEYS[statement.kind])}
                  </Button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
