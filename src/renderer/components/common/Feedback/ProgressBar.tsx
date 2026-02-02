/**
 * ProgressBar Component
 * Universal progress bar component for various UI elements
 * Used in video controls, loading overlays, modals, flashcards, etc.
 */

import { Component, JSX, mergeProps, Show } from 'solid-js';
import './ProgressBar.css';

export interface ProgressBarProps {
  /** Progress value from 0 to 100 */
  value: number;
  /** Progress bar height variant */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Color variant for the progress fill */
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  /** Whether the progress bar has rounded corners */
  rounded?: boolean;
  /** Show the percentage text */
  showPercent?: boolean;
  /** Position of the percentage text */
  percentPosition?: 'inline' | 'below';
  /** Whether the progress bar is interactive (clickable) */
  interactive?: boolean;
  /** Called when user clicks on the progress bar (if interactive) */
  onClick?: (percent: number) => void;
  /** Custom class name */
  class?: string;
  /** Custom inline styles */
  style?: JSX.CSSProperties;
  /** Whether to animate the progress fill */
  animated?: boolean;
  /** Optional class for the track element */
  trackClass?: string;
  /** Optional class for the fill element */
  fillClass?: string;
  /** Mouse down handler on the track */
  onMouseDown?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  /** Mouse up handler on the track */
  onMouseUp?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  /** Mouse move handler on the track */
  onMouseMove?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  /** Mouse leave handler on the track */
  onMouseLeave?: JSX.EventHandlerUnion<HTMLDivElement, MouseEvent>;
  /** ARIA label for accessibility */
  'aria-label'?: string;
}

export const ProgressBar: Component<ProgressBarProps> = (props) => {
  const merged = mergeProps(
    {
      value: 0,
      size: 'md' as const,
      variant: 'default' as const,
      rounded: true,
      showPercent: false,
      percentPosition: 'inline' as const,
      interactive: false,
      animated: true,
    },
    props
  );

  const clampedValue = () => Math.min(100, Math.max(0, merged.value));

  const handleClick = (e: MouseEvent) => {
    if (!merged.interactive || !merged.onClick) return;
    
    const bar = e.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    merged.onClick(Math.min(100, Math.max(0, percent)));
  };

  const containerClass = () => {
    const classes = ['progress-bar-container'];
    if (merged.class) classes.push(merged.class);
    if (merged.percentPosition === 'below') classes.push('progress-bar-container--stacked');
    return classes.join(' ');
  };

  const trackClass = () => {
    const classes = ['progress-bar-track'];
    classes.push(`progress-bar--${merged.size}`);
    if (merged.rounded) classes.push('progress-bar--rounded');
    if (merged.interactive) classes.push('progress-bar--interactive');
    if (merged.trackClass) classes.push(merged.trackClass);
    return classes.join(' ');
  };

  const fillClass = () => {
    const classes = ['progress-bar-fill'];
    classes.push(`progress-bar-fill--${merged.variant}`);
    if (merged.animated) classes.push('progress-bar-fill--animated');
    if (merged.rounded) classes.push('progress-bar--rounded');
    if (merged.fillClass) classes.push(merged.fillClass);
    return classes.join(' ');
  };

  return (
    <div 
      class={containerClass()}
      style={merged.style}
    >
      <div
        class={trackClass()}
        onClick={handleClick}
        onMouseDown={merged.onMouseDown}
        onMouseUp={merged.onMouseUp}
        onMouseMove={merged.onMouseMove}
        onMouseLeave={merged.onMouseLeave}
        role="progressbar"
        aria-valuenow={clampedValue()}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={merged['aria-label']}
      >
        <div
          class={fillClass()}
          style={{ width: `${clampedValue()}%` }}
        />
      </div>
      <Show when={merged.showPercent}>
        <span class="progress-bar-percent">
          {Math.round(clampedValue())}%
        </span>
      </Show>
    </div>
  );
};

export default ProgressBar;
