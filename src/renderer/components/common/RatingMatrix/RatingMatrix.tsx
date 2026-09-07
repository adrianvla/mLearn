import { Component, For, Show, createEffect, createSignal, on, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  ATTEMPT_QUALITIES,
  SPATIAL_QUALITY_KEYS,
  type AttemptQuality,
  type RatingKeyboardMode,
} from '../../../../shared/constants';
import { CAPABILITY_LABEL_KEYS, CAPABILITY_MNEMONIC_KEYS } from '../../../../shared/graph/access';
import type { CapabilityKind } from '../../../../shared/graph/types';
import { useLocalization } from '../../../context';
import { Button } from '../Button/Button';
import { KeyboardShortcut } from '../Misc/KeyboardShortcut';
import { isRatingKeyIgnored } from '../../../utils/ratingShortcuts';
import './RatingMatrix.css';

export interface RateOptions {
  method?: 'recall' | 'inference';
  /** Fluent-only: schedule as Easy. Identical learner evidence. */
  easy?: boolean;
}

export interface ProfileObservation {
  capability: CapabilityKind;
  quality: AttemptQuality;
  method?: 'recall' | 'inference';
  /** Fluent-only scheduler preference; evidence remains fluent. */
  easy?: boolean;
}

export interface RatingMatrixProps {
  /** Capabilities this interaction actually tests, in display order (matrix rows). */
  capabilities: readonly CapabilityKind[];
  keyboardMode: RatingKeyboardMode;
  /** Matrix owns its rating keys only while armed (answer shown / word presented). */
  armed: boolean;
  /**
   * Commit policy. 'dominant': a cell commits immediately and advances.
   * 'profile': cells draft per-row selections; nothing is emitted until F submits — explicit rows keep their quality,
   * unselected TESTED rows submit as Fluent, not-tested rows get no observation.
   */
  mode?: 'dominant' | 'profile';
  /** Drafts reset when this changes (profile mode; pass the current word). */
  resetKey?: string | number;
  /** Start every profile row as Fluent after each reset; edits replace these drafts. */
  initialDraftsFluent?: boolean;
  /** Keep the full matrix available as an exception editor behind a compact bar. */
  compact?: boolean;
  onRate: (capability: CapabilityKind, quality: AttemptQuality, opts?: RateOptions) => void;
  /** Dominant mode F: every tested capability was Fluent. */
  onAllFluent?: (opts?: RateOptions) => void;
  /** Profile mode F: the resolved full profile (one logical attempt). */
  onProfileSubmit?: (observations: readonly ProfileObservation[], opts?: RateOptions) => void;
}

const PENDING_TIMEOUT_MS = 1500;

const QUALITY_KEYS: Record<AttemptQuality, string> = { missed: '1', struggled: '2', fluent: '3' };

const QUALITY_LABEL_KEYS: Record<AttemptQuality, string> = {
  missed: 'mlearn.Rating.Matrix.Missed',
  struggled: 'mlearn.Rating.Matrix.Struggled',
  fluent: 'mlearn.Rating.Matrix.Fluent',
};

// Same variant mapping the SRS rating buttons used: missed=again (danger),
// struggled=hard (warning), fluent=good (success); all-fluent=easy (primary).
const RATING_ACTIONS = [...ATTEMPT_QUALITIES, 'easy'] as const;

const QUALITY_VARIANTS: Record<typeof RATING_ACTIONS[number], 'danger' | 'warning' | 'success' | 'primary'> = {
  missed: 'danger',
  struggled: 'warning',
  fluent: 'success',
  easy: 'primary',
};

/**
 * The universal attempt-rating input: capability rows × performance columns.
 * Clicking a cell and pressing its shortcut emit the same onRate action.
 * Mnemonic mode rates via number-first chords (1+M) with an immediate pending
 * hint; spatial mode maps 1-2-3 / Q-W-E / A-S-D / Z-X-C columns onto the
 * displayed rows (keys mean quality × row, never a fixed capability). Alt marks
 * the attempt as worked out (method=inference); Shift on fluent/Space requests
 * Easy scheduling with identical evidence.
 */
export const RatingMatrix: Component<RatingMatrixProps> = (props) => {
  const { t } = useLocalization();
  const [pendingQuality, setPendingQuality] = createSignal<AttemptQuality | null>(null);
  const [drafts, setDrafts] = createStore<Partial<Record<CapabilityKind, { quality: AttemptQuality; method?: 'recall' | 'inference'; easy?: boolean }>>>({});
  const [expanded, setExpanded] = createSignal(false);
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const isProfile = () => (props.mode ?? 'dominant') === 'profile';

  const resetDrafts = () => {
    for (const key of Object.keys(drafts)) setDrafts(key as CapabilityKind, undefined);
    if (isProfile() && props.initialDraftsFluent) {
      for (const capability of props.capabilities) setDrafts(capability, { quality: 'fluent' });
    }
  };

  createEffect(on(() => props.resetKey, () => {
    resetDrafts();
    setExpanded(false);
  }));

  const clearPending = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    setPendingQuality(null);
  };

  const rate = (capability: CapabilityKind, quality: AttemptQuality, alt: boolean, shift: boolean) => {
    clearPending();
    if (isProfile()) {
      // Draft only: no evidence, no event, no advance until submit.
      setDrafts(capability, { quality, ...(alt ? { method: 'inference' as const } : {}), ...(quality === 'fluent' && shift ? { easy: true } : {}) });
      return;
    }
    const opts: RateOptions = {};
    if (alt) opts.method = 'inference';
    if (quality === 'fluent' && shift) opts.easy = true;
    props.onRate(capability, quality, Object.keys(opts).length > 0 ? opts : undefined);
  };

  // Submit boundary: explicit drafts keep their quality (and method); unselected
  // TESTED rows are confirmed Fluent by the explicit F action — never
  // fabricated, and never applied to rows this interaction does not test.
  const submitProfile = (alt: boolean, easy: boolean) => {
    const observations: ProfileObservation[] = props.capabilities.map((capability) => {
      const draft = drafts[capability];
      if (draft) return { capability, quality: draft.quality, ...(draft.method ? { method: draft.method } : {}), ...(draft.easy ? { easy: true } : {}) };
      // Alt+Space marks the worked-out default only when nothing was drafted;
      // explicit drafts are never contaminated by the submit modifier.
      return { capability, quality: 'fluent' as const, ...(alt ? { method: 'inference' as const } : {}) };
    });
    for (const key of Object.keys(drafts)) setDrafts(key as CapabilityKind, undefined);
    props.onProfileSubmit?.(observations, { ...(alt ? { method: 'inference' as const } : {}), ...(easy ? { easy: true } : {}) });
  };

  const mnemonicLetterToCapability = (letter: string): CapabilityKind | undefined =>
    props.capabilities.find((capability) => CAPABILITY_MNEMONIC_KEYS[capability] === letter);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.armed) return;
    const buttonTarget = e.target instanceof HTMLElement && e.target.matches('button, [role="button"]');
    if (isRatingKeyIgnored(e) && !buttonTarget) return;
    if (e.metaKey || e.ctrlKey) return;
    const key = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (pendingQuality()) {
        clearPending();
      } else if (props.compact && expanded()) {
        setExpanded(false);
      }
      return;
    }

    if (key === 'f') {
      e.preventDefault();
      if (isProfile()) {
        submitProfile(e.altKey, e.shiftKey);
        return;
      }
      const opts: RateOptions = {};
      if (e.altKey) opts.method = 'inference';
      if (e.shiftKey) opts.easy = true;
      props.onAllFluent?.(Object.keys(opts).length > 0 ? opts : undefined);
      return;
    }

    const qualityFromNumber = ATTEMPT_QUALITIES.find((q) => QUALITY_KEYS[q] === key);
    if (qualityFromNumber) {
      // A lone quality key never mutates: it arms a chord (mnemonic) or rates
      // the first matrix row (spatial). Shift+3 = Easy-fluent for row 1 in both.
      if (e.shiftKey) {
        if (props.capabilities.length > 0) rate(props.capabilities[0], 'fluent', e.altKey, true);
        return;
      }
      if (props.keyboardMode === 'mnemonic') {
        setPendingQuality(qualityFromNumber);
        if (pendingTimer !== undefined) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(clearPending, PENDING_TIMEOUT_MS);
        return;
      }
      if (props.capabilities.length > 0) rate(props.capabilities[0], qualityFromNumber, e.altKey, false);
      return;
    }

    if (props.keyboardMode === 'mnemonic') {
      const pending = pendingQuality();
      if (!pending) return;
      const capability = mnemonicLetterToCapability(key);
      if (capability) {
        e.preventDefault();
        rate(capability, pending, e.altKey, e.shiftKey && pending === 'fluent');
      }
      return;
    }

    // Spatial: key = quality column × displayed row index.
    for (const quality of ATTEMPT_QUALITIES) {
      const rowIndex = SPATIAL_QUALITY_KEYS[quality].indexOf(key);
      if (rowIndex >= 0 && rowIndex < props.capabilities.length) {
        e.preventDefault();
        rate(props.capabilities[rowIndex], quality, e.altKey, e.shiftKey && quality === 'fluent');
        return;
      }
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      clearPending();
    });
  });

  const cellHint = (capability: CapabilityKind, quality: AttemptQuality): string[] => {
    if (props.keyboardMode === 'mnemonic') {
      return pendingQuality() === quality
        ? [QUALITY_KEYS[quality], CAPABILITY_MNEMONIC_KEYS[capability].toUpperCase()]
        : [QUALITY_KEYS[quality]];
    }
    const rowIndex = props.capabilities.indexOf(capability);
    return [SPATIAL_QUALITY_KEYS[quality][rowIndex]?.toUpperCase() ?? '·'];
  };

  const submitAllFluent = (easy = false) => {
    if (isProfile()) {
      submitProfile(false, easy);
      return;
    }
    props.onAllFluent?.(easy ? { easy: true } : undefined);
  };

  return (
    <>
      <Show when={props.compact}>
        <div class="rating-matrix__compact">
          <Button
            buttonType="default"
            variant="success"
            size="sm"
            class="rating-matrix__compact-action"
            disabled={!props.armed}
            onClick={() => submitAllFluent()}
          >
            {t('mlearn.Rating.Compact.AllFluent')}
            <KeyboardShortcut keys={['F']} class="rating-matrix__hint" />
          </Button>
          <Button
            buttonType="default"
            variant="primary"
            size="sm"
            class="rating-matrix__compact-action"
            disabled={!props.armed}
            onClick={() => submitAllFluent(true)}
          >
            {t('mlearn.Rating.Compact.AllEasy')}
            <KeyboardShortcut keys={['⇧', 'F']} class="rating-matrix__hint" />
          </Button>
          <Button
            buttonType="default"
            variant="ghost"
            size="sm"
            class="rating-matrix__compact-adjust"
            disabled={!props.armed}
            aria-expanded={expanded()}
            onClick={() => setExpanded((shown) => !shown)}
          >
            {t('mlearn.Rating.Compact.Adjust')}
          </Button>
        </div>
      </Show>
      <div
        class="rating-matrix"
        classList={{
          'rating-matrix--armed': props.armed,
          'rating-matrix--collapsed': !!props.compact && !expanded(),
        }}
        aria-hidden={!!props.compact && !expanded()}
        hidden={!!props.compact && !expanded()}
      >
        <div class="rating-matrix__head" role="presentation">
          <span class="rating-matrix__corner" />
          <For each={ATTEMPT_QUALITIES}>
            {(quality) => (
              <span
                class="rating-matrix__col"
                classList={{ 'rating-matrix__col--pending': pendingQuality() === quality }}
              >
                {t(QUALITY_LABEL_KEYS[quality])}
              </span>
            )}
          </For>
          <span class="rating-matrix__fluent-adjust" role="presentation">
            <span class="rating-matrix__divider" aria-hidden="true" />
            <span class="rating-matrix__col rating-matrix__col--easy">{t('mlearn.Rating.Matrix.Easy')}</span>
          </span>
        </div>
        <For each={props.capabilities}>
          {(capability) => (
            <div class="rating-matrix__row" role="presentation">
              <span class="rating-matrix__label">{t(CAPABILITY_LABEL_KEYS[capability])}</span>
              <For each={ATTEMPT_QUALITIES}>
                {(quality) => (
                  <Button
                    buttonType="default"
                    variant={QUALITY_VARIANTS[quality]}
                    size="xs"
                    class={`rating-matrix__cell rating-matrix__cell--${quality}`}
                    classList={{
                      'rating-matrix__cell--pending-col': pendingQuality() === quality,
                      'rating-matrix__cell--selected': drafts[capability]?.quality === quality,
                    }}
                    disabled={!props.armed}
                    onClick={() => rate(capability, quality, false, false)}
                  >
                    <KeyboardShortcut keys={cellHint(capability, quality)} class="rating-matrix__hint" />
                  </Button>
                )}
              </For>
              <span class="rating-matrix__fluent-adjust" role="presentation">
                <span class="rating-matrix__divider" aria-hidden="true" />
                <Button
                  buttonType="default"
                  variant={QUALITY_VARIANTS.easy}
                  size="xs"
                  class="rating-matrix__cell rating-matrix__cell--easy"
                  classList={{
                    'rating-matrix__cell--selected': drafts[capability]?.quality === 'fluent' && !!drafts[capability]?.easy,
                  }}
                  disabled={!props.armed}
                  onClick={() => rate(capability, 'fluent', false, true)}
                >
                  <KeyboardShortcut keys={['·']} class="rating-matrix__hint" />
                </Button>
              </span>
            </div>
          )}
        </For>
        <Button
          buttonType="default"
          variant="primary"
          size="sm"
          class="rating-matrix__all"
          disabled={!props.armed}
          onClick={() => (isProfile() ? submitProfile(false, false) : props.onAllFluent?.())}
        >
          {t(isProfile() && Object.keys(drafts).length > 0
            ? 'mlearn.Rating.Matrix.EverythingElseFluent'
            : 'mlearn.Rating.Matrix.AllFluent')}
          <KeyboardShortcut keys={[t('mlearn.Rating.Matrix.AllFluentKey')]} class="rating-matrix__hint" />
        </Button>
        <Show when={pendingQuality()}>
          <span class="rating-matrix__pending" role="status">
            {t('mlearn.Rating.Matrix.PendingHint')}
          </span>
        </Show>
      </div>
    </>
  );
};