/**
 * Unified Loader Component
 * A single loading indicator component that can render different types:
 * - spinner: Spinning circle indicator
 * - skeleton: Animated placeholder lines
 * - ring: Circular progress ring (for OCR, etc.)
 * - overlay: Full overlay with spinner
 */

import { Component, Show, For, createMemo, JSX } from 'solid-js';
import './Loader.css';

// ============ Types ============

export type LoaderType = 'spinner' | 'skeleton' | 'ring' | 'overlay';

export interface LoaderProps {
  /** Type of loader to display */
  type?: LoaderType;
  /** Shape of the spinner/ring track */
  shape?: 'circle' | 'square';
  /** Size in pixels (for spinner, ring) */
  size?: number;
  /** Text to display with the loader */
  text?: string;
  /** Status text (for ring - shows below ring) */
  statusText?: string;
  /** Progress value 0-100 (for ring) */
  progress?: number;
  /** Whether to show indeterminate animation (for ring) */
  indeterminate?: boolean;
  /** Number of skeleton lines */
  lines?: number;
  /** Show percentage text */
  showPercent?: boolean;
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
  /** Corner radius for square shape (default 4) */
  cornerRadius?: number;
  /** Additional CSS class */
  class?: string;
  /** Custom inline styles */
  style?: JSX.CSSProperties;
}

// ============ Spinner Component ============

const SpinnerContent: Component<{ size: number; text?: string; shape?: 'circle' | 'square'; strokeWidth?: number; cornerRadius?: number }> = (props) => {
  const isSquare = () => props.shape === 'square';
  const sw = () => props.strokeWidth ?? 3;
  const cr = () => props.cornerRadius ?? 4;

  return (
    <div class="loader-spinner">
      <Show when={isSquare()} fallback={
        <div 
          class="loader-spinner-circle" 
          style={{ 
            width: `${props.size}px`, 
            height: `${props.size}px`,
            'border-width': `${sw()}px`,
          }} 
        />
      }>
        <svg
          class="loader-spinner-square"
          width={props.size}
          height={props.size}
          viewBox="0 0 50 50"
        >
          <rect
            class="loader-spinner-square-track"
            x="3"
            y="3"
            width="44"
            height="44"
            rx={cr()}
            ry={cr()}
            stroke-width={sw()}
          />
          <rect
            class="loader-spinner-square-bar"
            x="3"
            y="3"
            width="44"
            height="44"
            rx={cr()}
            ry={cr()}
            stroke-width={sw()}
          />
        </svg>
      </Show>
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

// ============ Ring Component ============

const CircleRing: Component<{
  size: number;
  progress: number;
  indeterminate: boolean;
  strokeWidth: number;
}> = (props) => {
  const radius = createMemo(() => (props.size - props.strokeWidth) / 2);
  const circumference = createMemo(() => 2 * Math.PI * radius());
  const strokeDashoffset = createMemo(() => {
    if (props.indeterminate) return undefined;
    const progress = Math.max(0, Math.min(100, props.progress));
    return circumference() - (progress / 100) * circumference();
  });

  return (
    <svg
      class={`loader-ring-svg ${props.indeterminate ? 'indeterminate' : ''}`}
      viewBox={`0 0 ${props.size} ${props.size}`}
    >
      <circle
        class="loader-ring-track"
        cx={props.size / 2}
        cy={props.size / 2}
        r={radius()}
        stroke-width={props.strokeWidth}
      />
      <circle
        class="loader-ring-progress"
        cx={props.size / 2}
        cy={props.size / 2}
        r={radius()}
        stroke-width={props.strokeWidth}
        stroke-dasharray={props.indeterminate ? undefined : String(circumference())}
        stroke-dashoffset={props.indeterminate ? undefined : String(strokeDashoffset())}
      />
    </svg>
  );
};

const SquareRing: Component<{
  size: number;
  progress: number;
  indeterminate: boolean;
  strokeWidth: number;
  cornerRadius: number;
}> = (props) => {
  const inset = createMemo(() => props.strokeWidth / 2 + 0.5);
  const rectSize = createMemo(() => props.size - props.strokeWidth - 1);
  const cr = () => props.cornerRadius;
  // Perimeter of a rounded rect: 2*(w + h) - 8*r + 2*pi*r
  const perimeter = createMemo(() => {
    const s = rectSize();
    return 2 * (s + s) - 8 * cr() + 2 * Math.PI * cr();
  });
  const strokeDashoffset = createMemo(() => {
    if (props.indeterminate) return undefined;
    const progress = Math.max(0, Math.min(100, props.progress));
    return perimeter() - (progress / 100) * perimeter();
  });
  // For indeterminate: 1/4 visible, 3/4 gap
  const indeterminateDasharray = createMemo(() => {
    const p = perimeter();
    return `${p / 4} ${(p * 3) / 4}`;
  });

  return (
    <svg
      class={`loader-ring-svg loader-ring-svg--square ${props.indeterminate ? 'loader-ring-svg--square-indeterminate' : ''}`}
      viewBox={`0 0 ${props.size} ${props.size}`}
      style={props.indeterminate ? { '--square-ring-perimeter': String(perimeter()) } as any : undefined}
    >
      <rect
        class="loader-ring-track"
        x={inset()}
        y={inset()}
        width={rectSize()}
        height={rectSize()}
        rx={cr()}
        ry={cr()}
        stroke-width={props.strokeWidth}
      />
      <rect
        class="loader-ring-progress"
        x={inset()}
        y={inset()}
        width={rectSize()}
        height={rectSize()}
        rx={cr()}
        ry={cr()}
        stroke-width={props.strokeWidth}
        stroke-dasharray={props.indeterminate ? indeterminateDasharray() : String(perimeter())}
        stroke-dashoffset={props.indeterminate ? undefined : String(strokeDashoffset())}
      />
    </svg>
  );
};

const RingContent: Component<{
  size: number;
  progress: number;
  indeterminate: boolean;
  strokeWidth: number;
  showPercent: boolean;
  text?: string;
  statusText?: string;
  shape?: 'circle' | 'square';
  cornerRadius?: number;
}> = (props) => {
  const isSquare = () => props.shape === 'square';
  const cr = () => props.cornerRadius ?? 4;
  const progressValue = createMemo(() => Math.round(props.progress));
  
  // Keep the status text element in the DOM but hide it when empty
  // This prevents layout jumps during fade animations
  const displayText = () => props.statusText || props.text || '';
  const hasText = () => !!(props.statusText || props.text);
  
  return (
    <div class="loader-ring">
      <div 
        class={`loader-ring-wrapper ${isSquare() ? 'loader-ring-wrapper--square' : ''}`}
        style={{ width: `${props.size}px`, height: `${props.size}px` }}
      >
          <Show when={isSquare()} fallback={
            <CircleRing
              size={props.size}
              progress={props.progress}
              indeterminate={props.indeterminate}
              strokeWidth={props.strokeWidth}
            />
          }>
            <SquareRing
              size={props.size}
              progress={props.progress}
              indeterminate={props.indeterminate}
              strokeWidth={props.strokeWidth}
              cornerRadius={cr()}
            />
          </Show>
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
  shape?: 'circle' | 'square';
  strokeWidth?: number;
  cornerRadius?: number;
}> = (props) => {
  return (
    <Show when={props.visible}>
      <div 
        class={`loader-overlay ${props.backdrop ? 'with-backdrop' : ''} ${props.blur ? 'with-blur' : ''} ${props.fullscreen ? 'fullscreen' : ''}`}
      >
        <div class="loader-overlay-content">
          <SpinnerContent size={props.size} text={props.text} shape={props.shape} strokeWidth={props.strokeWidth} cornerRadius={props.cornerRadius} />
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
  const showPercent = () => props.showPercent === true;
  const strokeWidth = () => props.strokeWidth ?? (props.indeterminate ? 4 : 3);
  const visible = () => props.visible !== false;
  const backdrop = () => props.backdrop !== false;
  const blur = () => props.blur === true;
  const fullscreen = () => props.fullscreen === true;
  const indeterminate = () => props.indeterminate === true;
  const shape = () => props.shape || 'circle';
  const cornerRadius = () => props.cornerRadius ?? 4;

  return (
    <div class={`loader loader-${type()} ${props.class || ''}`} style={props.style}>
      <Show when={type() === 'spinner'}>
        <SpinnerContent size={size()} text={props.text} shape={shape()} strokeWidth={strokeWidth()} cornerRadius={cornerRadius()} />
      </Show>
      
      <Show when={type() === 'skeleton'}>
        <SkeletonContent lines={lines()} />
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
          shape={shape()}
          cornerRadius={cornerRadius()}
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
          shape={shape()}
          strokeWidth={strokeWidth()}
          cornerRadius={cornerRadius()}
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

/** Progress ring */
export const ProgressRing: Component<Omit<LoaderProps, 'type'>> = (props) => (
  <Loader type="ring" {...props} />
);

/** Loading overlay */
export const LoadingOverlay: Component<Omit<LoaderProps, 'type'>> = (props) => (
  <Loader type="overlay" {...props} />
);

export default Loader;
