/**
 * ProgressBar Component
 * Reusable progress bar for various loading states
 */

import { Component, Show, createMemo } from 'solid-js';
import './ProgressBar.css';

export interface ProgressBarProps {
  /** Progress value from 0 to 100 */
  progress: number;
  /** Visual variant */
  variant?: 'default' | 'thin' | 'thick' | 'gradient';
  /** Whether to animate the progress */
  animated?: boolean;
  /** Whether to show percentage text */
  showPercent?: boolean;
  /** Custom label */
  label?: string;
  /** Additional class */
  class?: string;
  /** Custom color */
  color?: string;
}

export const ProgressBar: Component<ProgressBarProps> = (props) => {
  const progressValue = createMemo(() => Math.max(0, Math.min(100, props.progress || 0)));
  const variant = () => props.variant || 'default';
  const animated = () => props.animated !== false;
  
  return (
    <div 
      class={`progress-bar-container progress-bar--${variant()} ${props.class || ''}`}
    >
      <Show when={props.label}>
        <span class="progress-bar-label">{props.label}</span>
      </Show>
      <div class="progress-bar-track">
        <div 
          class={`progress-bar-fill ${animated() ? 'animated' : ''}`}
          style={{ 
            width: `${progressValue()}%`,
            ...(props.color ? { 'background-color': props.color } : {})
          }}
        />
      </div>
      <Show when={props.showPercent}>
        <span class="progress-bar-percent">{Math.round(progressValue())}%</span>
      </Show>
    </div>
  );
};

export default ProgressBar;
