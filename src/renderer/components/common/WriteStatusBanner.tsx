/**
 * Saving / save-failed banner for a durable write, shared by every surface
 * that files a study write (flashcard review, word sync, grammar coverage).
 *
 * The save state itself is owned by the study session contract — this renders
 * it, and owns the retry affordance, so no surface re-invents the wording or
 * the "is a retry even possible" guard.
 */
import { Component, Show } from 'solid-js';
import { Button } from './Button';
import { useLocalization } from '../../context';

export type WriteStatus = 'pending' | 'failed';

export interface WriteStatusBannerProps {
  /** The write's state, or null when no write is in flight. */
  status: WriteStatus | null;
  /** Translation key shown while the write is in flight. */
  savingLabelKey: string;
  /** Translation key shown when the write failed. */
  failedLabelKey: string;
  /**
   * Whether a retry can still be performed. A failed write whose payload has
   * been discarded cannot be retried, so the button must not offer it.
   */
  canRetry: boolean;
  onRetry: () => void;
  class?: string;
  failedClass?: string;
  /** Overrides the retry button's label. Defaults to the global "Try again". */
  retryLabelKey?: string;
  /** Test hook for the retry button, used where tests target it directly. */
  retryTestId?: string;
}

function bannerClass(base?: string, extra?: string): string | undefined {
  if (!base) return extra;
  return extra ? `${base} ${extra}` : base;
}

export const WriteStatusBanner: Component<WriteStatusBannerProps> = (props) => {
  const { t } = useLocalization();
  return (
    <>
      <Show when={props.status === 'pending'}>
        <div class={props.class} role="status" aria-live="polite">{t(props.savingLabelKey)}</div>
      </Show>
      <Show when={props.status === 'failed'}>
        <div class={bannerClass(props.class, props.failedClass)} role="alert">
          <span>{t(props.failedLabelKey)}</span>
          <Show when={props.canRetry}>
            <Button
              size="sm"
              variant="primary"
              data-testid={props.retryTestId}
              onClick={() => props.onRetry()}
            >
              {t(props.retryLabelKey ?? 'mlearn.Global.TryAgain')}
            </Button>
          </Show>
        </div>
      </Show>
    </>
  );
};
