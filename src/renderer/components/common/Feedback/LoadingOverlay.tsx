/**
 * Loading Overlay Component
 * A centered loading spinner with optional text and overlay backdrop
 */

import { Component, Show } from 'solid-js';
import { Spinner } from '../Loader';
import './LoadingOverlay.css';

export interface LoadingOverlayProps {
  /** Whether the overlay is visible */
  visible?: boolean;
  /** Loading text to display */
  text?: string;
  /** Size of the spinner */
  size?: number;
  /** Whether to show a backdrop */
  backdrop?: boolean;
  /** Whether to blur the content behind */
  blur?: boolean;
  /** Whether the overlay takes full screen */
  fullscreen?: boolean;
  /** Additional CSS class */
  class?: string;
}

export const LoadingOverlay: Component<LoadingOverlayProps> = (props) => {
  const isVisible = () => props.visible !== false;
  const hasBackdrop = () => props.backdrop !== false;
  const hasBlur = () => props.blur === true;
  const isFullscreen = () => props.fullscreen === true;
  
  return (
    <Show when={isVisible()}>
      <div 
        class={`loading-overlay ${hasBackdrop() ? 'with-backdrop' : ''} ${hasBlur() ? 'with-blur' : ''} ${isFullscreen() ? 'fullscreen' : ''} ${props.class || ''}`}
      >
        <div class="loading-overlay-content">
          <Spinner size={props.size ?? 40} text={props.text} />
        </div>
      </div>
    </Show>
  );
};

export default LoadingOverlay;
