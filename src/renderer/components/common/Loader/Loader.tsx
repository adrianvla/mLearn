/**
 * Unified Loader Component
 * A single loading indicator component that can render different types:
 * - spinner: Spinning circle indicator
 * - skeleton: Animated placeholder lines
 * - progress: Linear progress bar
 * - ring: Circular progress ring (for OCR, etc.)
 * - overlay: Full overlay with spinner
 */

import { Component, Show, For, createMemo, JSX } from 'solid-js';
import './Loader.css';

// ============ Types ============

export type LoaderType = 'spinner' | 'skeleton' | 'progress' | 'ring' | 'overlay';

export type ProgressVariant = 'default' | 'thin' | 'thick' | 'gradient';

export interface LoaderProps {
  /** Type of loader to display */
  type?: LoaderType;
  /** Size in pixels (for spinner, ring) */
  size?: number;
  /** Text to display with the loader */
  text?: string;
  /** Status text (for ring - shows below ring) */
  statusText?: string;
  /** Progress value 0-100 (for progress bar, ring) */
  progress?: number;
  /** Whether to show indeterminate animation (for ring) */
  indeterminate?: boolean;
  /** Number of skeleton lines */
  lines?: number;
  /** Show percentage text */
  showPercent?: boolean;
  /** Progress bar variant */
  variant?: ProgressVariant;
  /** Custom color for progress bar */
  color?: string;
  /** Label for progress bar */
  label?: string;
  /** Animate progress transitions */
  animated?: boolean;
  /** Show backdrop (for overlay) */
  backdrop?: boolean;
  /** Blur content behind (for overlay) */
  blur?: boolean;
  /** Full screen overlay */
  fullscreen?: boolean;
  /** Whether overlay is visible */
  visible?: boolean;
  /** Stroke width for ring */
  strokeWidth?: number;
  /** Additional CSS class */
  class?: string;
  /** Custom inline styles */
  style?: JSX.CSSProperties;
}

// ============ Spinner Component ============

const SpinnerContent: Component<{ size: number; text?: string }> = (props) => {
  return (
    <div class="loader-spinner">
      <div 
        class="loader-spinner-circle" 
        style={{ 
          width: `${props.size}px`, 
          height: `${props.size}px` 
        }} 
      />
      <Show when={props.text}>
        <span class="loader-text">{props.text}</span>
      </Show>
    </div>
  );
};

// ============ Skeleton Component ============

const SkeletonContent: Component<{ lines: number }> = (props) => {
  // Generate random widths for skeleton lines
  const widths = createMemo(() => 
    Array.from({ length: props.lines }, () => Math.floor(Math.random() * 100) + 10)
  );
  
  return (
    <div class="loader-skeleton">
      <div class="loader-skeleton-lines">
        <For each={widths()}>
          {(width) => (
            <span class="loader-skeleton-line" style={{ width: `${width}px` }} />
          )}
        </For>
      </div>
    </div>
  );
};

// ============ Progress Bar Component ============

const ProgressContent: Component<{
  progress: number;
  variant: ProgressVariant;
  animated: boolean;
  showPercent: boolean;
  label?: string;
  color?: string;
}> = (props) => {
  const progressValue = createMemo(() => Math.max(0, Math.min(100, props.progress)));
  
  return (
    <div class={`loader-progress loader-progress--${props.variant}`}>
      <Show when={props.label}>
        <span class="loader-progress-label">{props.label}</span>
      </Show>
      <div class="loader-progress-track">
        <div 
          class={`loader-progress-fill ${props.animated ? 'animated' : ''}`}
          style={{ 
            width: `${progressValue()}%`,
            ...(props.color ? { 'background-color': props.color } : {})
          }}
        />
      </div>
      <Show when={props.showPercent}>
        <span class="loader-progress-percent">{Math.round(progressValue())}%</span>
      </Show>
    </div>
  );
};

// ============ Ring Component ============

const RingContent: Component<{
  size: number;
  progress: number;
  indeterminate: boolean;
  strokeWidth: number;
  showPercent: boolean;
  text?: string;
  statusText?: string;
}> = (props) => {
  const radius = createMemo(() => (props.size - props.strokeWidth) / 2);
  const circumference = createMemo(() => 2 * Math.PI * radius());
  const strokeDashoffset = createMemo(() => {
    if (props.indeterminate) return undefined;
    const progress = Math.max(0, Math.min(100, props.progress));
    return circumference() - (progress / 100) * circumference();
  });
  const progressValue = createMemo(() => Math.round(props.progress));
  
  // Keep the status text element in the DOM but hide it when empty
  // This prevents layout jumps during fade animations
  const displayText = () => props.statusText || props.text || '';
  const hasText = () => !!(props.statusText || props.text);
  
  return (
    <div class="loader-ring">
      <div 
        class="loader-ring-wrapper"
        style={{ width: `${props.size}px`, height: `${props.size}px` }}
      >
          <svg
              class={`loader-ring-svg ${props.indeterminate ? 'indeterminate' : ''}`}
              viewBox={`0 0 ${props.size} ${props.size}`}
          >
              {/* Background track */}
              <circle
                  class={"loader-ring-track"}
                  cx={props.size / 2}
                  cy={props.size / 2}
                  r={radius()}
                  stroke-width={props.strokeWidth}
              />
              {/* Progress arc */}
              <circle
                  class={"loader-ring-progress"}
                  cx={props.size / 2}
                  cy={props.size / 2}
                  r={radius()}
                  stroke-width={props.strokeWidth}
                  stroke-dasharray={props.indeterminate ? undefined : String(circumference())}
                  stroke-dashoffset={props.indeterminate ? undefined : String(strokeDashoffset())}
              />
          </svg>
          <Show when={props.showPercent && !props.indeterminate}>
              <span class="loader-ring-percent">{progressValue()}%</span>
          </Show>
      </div>
      {/* Keep statusText in DOM but use visibility to hide it when empty */}
      {/* This prevents layout jumps during fade-out animations */}
      <span 
        class="loader-text"
        style={{ 
          visibility: hasText() ? 'visible' : 'hidden',
          opacity: hasText() ? 1 : 0,
          transition: 'opacity 0.3s ease-out'
        }}
      >
        {displayText() || '\u00A0'} {/* Non-breaking space to maintain height when empty */}
      </span>
    </div>
  );
};

// ============ Overlay Component ============

const OverlayContent: Component<{
  visible: boolean;
  backdrop: boolean;
  blur: boolean;
  fullscreen: boolean;
  size: number;
  text?: string;
}> = (props) => {
  return (
    <Show when={props.visible}>
      <div 
        class={`loader-overlay ${props.backdrop ? 'with-backdrop' : ''} ${props.blur ? 'with-blur' : ''} ${props.fullscreen ? 'fullscreen' : ''}`}
      >
        <div class="loader-overlay-content">
          <SpinnerContent size={props.size} text={props.text} />
        </div>
      </div>
    </Show>
  );
};

// ============ Main Loader Component ============

export const Loader: Component<LoaderProps> = (props) => {
  const type = () => props.type || 'spinner';
  const size = () => props.size ?? 32;
  const lines = () => props.lines ?? Math.floor(Math.random() * 10) + 10;
  const progress = () => props.progress ?? 0;
  const variant = () => props.variant || 'default';
  const animated = () => props.animated !== false;
  const showPercent = () => props.showPercent === true;
  const strokeWidth = () => props.strokeWidth ?? (props.indeterminate ? 4 : 3);
  const visible = () => props.visible !== false;
  const backdrop = () => props.backdrop !== false;
  const blur = () => props.blur === true;
  const fullscreen = () => props.fullscreen === true;
  const indeterminate = () => props.indeterminate === true;

  return (
    <div class={`loader loader-${type()} ${props.class || ''}`} style={props.style}>
      <Show when={type() === 'spinner'}>
        <SpinnerContent size={size()} text={props.text} />
      </Show>
      
      <Show when={type() === 'skeleton'}>
        <SkeletonContent lines={lines()} />
      </Show>
      
      <Show when={type() === 'progress'}>
        <ProgressContent 
          progress={progress()}
          variant={variant()}
          animated={animated()}
          showPercent={showPercent()}
          label={props.label}
          color={props.color}
        />
      </Show>
      
      <Show when={type() === 'ring'}>
        <RingContent 
          size={size()}
          progress={progress()}
          indeterminate={indeterminate()}
          strokeWidth={strokeWidth()}
          showPercent={showPercent()}
          text={props.text}
          statusText={props.statusText}
        />
      </Show>
      
      <Show when={type() === 'overlay'}>
        <OverlayContent
          visible={visible()}
          backdrop={backdrop()}
          blur={blur()}
          fullscreen={fullscreen()}
          size={size()}
          text={props.text}
        />
      </Show>
    </div>
  );
};

// ============ Convenience Exports ============

/** Spinner loader */
export const Spinner: Component<Omit<LoaderProps, 'type'>> = (props) => (
  <Loader type="spinner" {...props} />
);

/** Skeleton loader */
export const Skeleton: Component<Omit<LoaderProps, 'type'>> = (props) => (
  <Loader type="skeleton" {...props} />
);

/** Progress bar */
export const Progress: Component<Omit<LoaderProps, 'type'>> = (props) => (
  <Loader type="progress" {...props} />
);

/** Progress ring */
export const ProgressRing: Component<Omit<LoaderProps, 'type'>> = (props) => (
  <Loader type="ring" {...props} />
);

/** Loading overlay */
export const LoadingOverlay: Component<Omit<LoaderProps, 'type'>> = (props) => (
  <Loader type="overlay" {...props} />
);

export default Loader;
