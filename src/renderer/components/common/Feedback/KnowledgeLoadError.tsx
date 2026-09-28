/**
 * KnowledgeLoadError Component
 * The single block-level state for "a knowledge read failed": a message plus,
 * when the surface can recover, a Retry action.
 *
 * Surfaces that gate on a failed projection/history/journal query render this
 * instead of hand-rolling their own alert + retry pair. Deliberately unstyled
 * chrome — it is a message and an action, not a banner.
 */

import { Component, Show } from 'solid-js';
import { useLocalization } from '../../../context';
import { Button } from '../Button';
import './KnowledgeLoadError.css';

export interface KnowledgeLoadErrorProps {
  /** Overrides the default `mlearn.Knowledge.LoadError` copy. */
  message?: string;
  /** Retry handler. When absent, no Retry button is rendered. */
  onRetry?: () => void;
  /** Live-region role — `status` for a settled-but-unavailable projection. */
  role?: 'alert' | 'status';
  /** Additional class names for surface-specific layout. */
  class?: string;
}

/**
 * KnowledgeLoadError - Message plus optional Retry for a failed knowledge read
 */
export const KnowledgeLoadError: Component<KnowledgeLoadErrorProps> = (props) => {
  const { t } = useLocalization();

  return (
    <div
      class={`knowledge-load-error ${props.class || ''}`}
      role={props.role ?? 'alert'}
    >
      <p class="knowledge-load-error__message">
        {props.message ?? t('mlearn.Knowledge.LoadError')}
      </p>
      <Show when={props.onRetry}>
        <Button onClick={() => props.onRetry?.()}>{t('mlearn.Knowledge.Retry')}</Button>
      </Show>
    </div>
  );
};
