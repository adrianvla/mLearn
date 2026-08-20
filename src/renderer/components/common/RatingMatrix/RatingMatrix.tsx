import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import {
  ATTEMPT_QUALITIES,
  ASPECT_MNEMONIC_KEYS,
  SPATIAL_QUALITY_KEYS,
  KNOWLEDGE_ASPECT_LABEL_KEYS,
  type AttemptQuality,
  type KnowledgeAspect,
  type RatingKeyboardMode,
} from '../../../../shared/constants';
import { useLocalization } from '../../../context';
import { Button } from '../Button/Button';
import { KeyboardShortcut } from '../Misc/KeyboardShortcut';
import './RatingMatrix.css';

export interface RateOptions {
  method?: 'recall' | 'inference';
  /** Fluent-only: schedule as Easy. Identical learner evidence. */
  easy?: boolean;
}

export interface RatingMatrixProps {
  /** Aspects this interaction actually tests, in display order (matrix rows). */
  aspects: readonly KnowledgeAspect[];
  keyboardMode: RatingKeyboardMode;
  /** Matrix owns its rating keys only while armed (answer shown / word presented). */
  armed: boolean;
  onRate: (aspect: KnowledgeAspect, quality: AttemptQuality, opts?: RateOptions) => void;
  /** Space/Enter: every tested aspect was Fluent. */
  onAllFluent: (opts?: RateOptions) => void;
}

const PENDING_TIMEOUT_MS = 1500;

const QUALITY_KEYS: Record<AttemptQuality, string> = { missed: '1', struggled: '2', fluent: '3' };

// Same variant mapping the SRS rating buttons used: missed=again (danger),
// struggled=hard (warning), fluent=good (success); all-fluent=easy (primary).
const QUALITY_VARIANTS: Record<AttemptQuality, 'danger' | 'warning' | 'success'> = {
  missed: 'danger',
  struggled: 'warning',
  fluent: 'success',
};

/**
 * The universal attempt-rating input: aspect rows × performance columns.
 * Clicking a cell and pressing its shortcut emit the same onRate action.
 * Mnemonic mode rates via number-first chords (1+M) with an immediate pending
 * hint; spatial mode maps 1-2-3 / Q-W-E / A-S-D / Z-X-C columns onto the
 * displayed rows (keys mean quality × row, never a fixed aspect). Alt marks
 * the attempt as worked out (method=inference); Shift on fluent/Space requests
 * Easy scheduling with identical evidence.
 */
export const RatingMatrix: Component<RatingMatrixProps> = (props) => {
  const { t } = useLocalization();
  const [pendingQuality, setPendingQuality] = createSignal<AttemptQuality | null>(null);
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPending = () => {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    setPendingQuality(null);
  };

  const rate = (aspect: KnowledgeAspect, quality: AttemptQuality, alt: boolean, shift: boolean) => {
    clearPending();
    const opts: RateOptions = {};
    if (alt) opts.method = 'inference';
    if (quality === 'fluent' && shift) opts.easy = true;
    props.onRate(aspect, quality, Object.keys(opts).length > 0 ? opts : undefined);
  };

  const mnemonicLetterToAspect = (letter: string): KnowledgeAspect | undefined =>
    props.aspects.find((aspect) => ASPECT_MNEMONIC_KEYS[aspect] === letter);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.armed) return;
    if (e.repeat) return;
    if (e.metaKey || e.ctrlKey) return;
    // Never swallow keys while the user is typing in a field.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    const key = e.key.toLowerCase();

    if (e.key === 'Escape') {
      if (pendingQuality()) clearPending();
      return;
    }

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const opts: RateOptions = {};
      if (e.altKey) opts.method = 'inference';
      if (e.shiftKey) opts.easy = true;
      props.onAllFluent(Object.keys(opts).length > 0 ? opts : undefined);
      return;
    }

    const qualityFromNumber = ATTEMPT_QUALITIES.find((q) => QUALITY_KEYS[q] === key);
    if (qualityFromNumber) {
      // A lone quality key never mutates: it arms a chord (mnemonic) or rates
      // the first matrix row (spatial). Shift+3 = Easy-fluent for row 1 in both.
      if (e.shiftKey) {
        if (props.aspects.length > 0) rate(props.aspects[0], 'fluent', e.altKey, true);
        return;
      }
      if (props.keyboardMode === 'mnemonic') {
        setPendingQuality(qualityFromNumber);
        if (pendingTimer !== undefined) clearTimeout(pendingTimer);
        pendingTimer = setTimeout(clearPending, PENDING_TIMEOUT_MS);
        return;
      }
      if (props.aspects.length > 0) rate(props.aspects[0], qualityFromNumber, e.altKey, false);
      return;
    }

    if (props.keyboardMode === 'mnemonic') {
      const pending = pendingQuality();
      if (!pending) return;
      const aspect = mnemonicLetterToAspect(key);
      if (aspect) {
        e.preventDefault();
        rate(aspect, pending, e.altKey, e.shiftKey && pending === 'fluent');
      }
      return;
    }

    // Spatial: key = quality column × displayed row index.
    for (const quality of ATTEMPT_QUALITIES) {
      const rowIndex = SPATIAL_QUALITY_KEYS[quality].indexOf(key);
      if (rowIndex >= 0 && rowIndex < props.aspects.length) {
        e.preventDefault();
        rate(props.aspects[rowIndex], quality, e.altKey, e.shiftKey && quality === 'fluent');
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

  const cellHint = (aspect: KnowledgeAspect, quality: AttemptQuality): string[] => {
    if (props.keyboardMode === 'mnemonic') {
      return pendingQuality() === quality
        ? [QUALITY_KEYS[quality], ASPECT_MNEMONIC_KEYS[aspect].toUpperCase()]
        : [QUALITY_KEYS[quality]];
    }
    const rowIndex = props.aspects.indexOf(aspect);
    return [SPATIAL_QUALITY_KEYS[quality][rowIndex]?.toUpperCase() ?? '·'];
  };

  return (
    <div class="rating-matrix" classList={{ 'rating-matrix--armed': props.armed }}>
      <div class="rating-matrix__head" role="presentation">
        <span class="rating-matrix__corner" />
        <For each={ATTEMPT_QUALITIES}>
          {(quality) => (
            <span
              class="rating-matrix__col"
              classList={{ 'rating-matrix__col--pending': pendingQuality() === quality }}
            >
              {t(`mlearn.Rating.Matrix.${quality === 'missed' ? 'Missed' : quality === 'struggled' ? 'Struggled' : 'Fluent'}`)}
            </span>
          )}
        </For>
      </div>
      <For each={props.aspects}>
        {(aspect) => (
          <div class="rating-matrix__row" role="presentation">
            <span class="rating-matrix__label">{t(KNOWLEDGE_ASPECT_LABEL_KEYS[aspect])}</span>
            <For each={ATTEMPT_QUALITIES}>
              {(quality) => (
                <Button
                  buttonType="default"
                  variant={QUALITY_VARIANTS[quality]}
                  size="xs"
                  class={`rating-matrix__cell rating-matrix__cell--${quality}`}
                  classList={{ 'rating-matrix__cell--pending-col': pendingQuality() === quality }}
                  disabled={!props.armed}
                  onClick={() => rate(aspect, quality, false, false)}
                >
                  <KeyboardShortcut keys={cellHint(aspect, quality)} class="rating-matrix__hint" />
                </Button>
              )}
            </For>
          </div>
        )}
      </For>
      <Button
        buttonType="default"
        variant="primary"
        size="sm"
        class="rating-matrix__all"
        disabled={!props.armed}
        onClick={() => props.onAllFluent()}
      >
        {t('mlearn.Rating.Matrix.AllFluent')}
        <KeyboardShortcut keys={[t('mlearn.Rating.Matrix.AllFluentKey')]} class="rating-matrix__hint" />
      </Button>
      <Show when={pendingQuality()}>
        <span class="rating-matrix__pending" role="status">
          {t('mlearn.Rating.Matrix.PendingHint')}
        </span>
      </Show>
    </div>
  );
};
