/**
 * LoadingOverlay Component
 * Standardized loading overlay using Portal for proper modal rendering
 * Used for app initialization, route transitions, and media loading
 */

import { Component, Show, JSX, mergeProps } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Panel } from '../Panel';
import { Spinner } from '../Loader';
import { ProgressBar } from '../Feedback/ProgressBar';
import './LoadingOverlay.css';

export interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean;
  /** Main title text */
  title?: string;
  /** Status message below title */
  message?: string;
  /** Progress value 0-100 (optional) */
  progress?: number;
  /** Show progress bar */
  showProgress?: boolean;
  /** Show percentage text */
  showPercent?: boolean;
  /** Custom spinner size */
  spinnerSize?: number;
  /** Whether to use blur backdrop */
  blur?: boolean;
  /** Additional CSS class for the overlay */
  class?: string;
  /** Custom inline styles */
  style?: JSX.CSSProperties;
  /** Children to render in the panel (optional) */
  children?: JSX.Element;
}

export const LoadingOverlay: Component<LoadingOverlayProps> = (props) => {
  const merged = mergeProps(
    {
      showProgress: false,
      showPercent: false,
      spinnerSize: 32,
      blur: true,
    },
    props
  );

  const overlayStyle = (): JSX.CSSProperties => ({
    ...merged.style,
  });

  return (
    <Show when={merged.isOpen}>
      <Portal>
        <div 
          class={`loading-overlay ${merged.blur ? 'loading-overlay--blur' : ''} ${merged.class || ''}`}
          style={overlayStyle()}
        >
          <Panel
            variant="elevated"
            rounded="xl"
            padding="lg"
            class="loading-overlay-panel"
          >
            <div class="loading-overlay-content">
              <Spinner size={merged.spinnerSize} />
              
              <Show when={merged.title}>
                <h2 class="loading-overlay-title">{merged.title}</h2>
              </Show>
              
              <Show when={merged.message}>
                <p class="loading-overlay-message">{merged.message}</p>
              </Show>
              
              <Show when={merged.showProgress && typeof merged.progress === 'number'}>
                <ProgressBar
                  value={merged.progress!}
                  size="md"
                  variant="primary"
                  showPercent={merged.showPercent}
                  percentPosition="below"
                  class="loading-overlay-progress"
                />
              </Show>
              
              {merged.children}
            </div>
          </Panel>
        </div>
      </Portal>
    </Show>
  );
};

export default LoadingOverlay;
