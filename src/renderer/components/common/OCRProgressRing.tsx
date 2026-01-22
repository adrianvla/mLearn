/**
 * OCR Progress Ring Component
 * A circular progress indicator for OCR processing with two modes:
 * - Indeterminate: spinning animation for "Pending" state (unknown progress)
 * - Determinate: shows actual percentage progress based on MangaOCR status
 */

import { Component, Show, createMemo } from 'solid-js';
import './OCRProgressRing.css';

export interface OCRProgressRingProps {
  /** Progress value from 0 to 100 (determinate mode) */
  progress?: number;
  /** Whether to show indeterminate spinning animation */
  indeterminate?: boolean;
  /** Size of the ring in pixels */
  size?: number;
  /** Stroke width of the ring */
  strokeWidth?: number;
  /** Status text to display below the ring */
  statusText?: string;
  /** Whether to show the percentage text inside the ring */
  showPercent?: boolean;
  /** Additional CSS class */
  class?: string;
}

export const OCRProgressRing: Component<OCRProgressRingProps> = (props) => {
  const size = () => props.size ?? 40;
  const strokeWidth = () => props.strokeWidth ?? 3;
  const radius = createMemo(() => (size() - strokeWidth()) / 2);
  const circumference = createMemo(() => 2 * Math.PI * radius());
  
  // Calculate stroke-dashoffset for determinate mode
  const strokeDashoffset = createMemo(() => {
    if (props.indeterminate) return undefined;
    const progress = Math.max(0, Math.min(100, props.progress ?? 0));
    return circumference() - (progress / 100) * circumference();
  });
  
  const progressValue = createMemo(() => Math.round(props.progress ?? 0));
  
  return (
    <div class={`ocr-progress-ring-container ${props.class || ''}`}>
      <div 
        class="ocr-progress-ring-wrapper"
        style={{ width: `${size()}px`, height: `${size()}px` }}
      >
        <svg 
          class={`ocr-progress-ring ${props.indeterminate ? 'indeterminate' : ''}`}
          viewBox={`0 0 ${size()} ${size()}`}
        >
          {/* Background track */}
          <circle 
            class="ocr-progress-ring-track"
            cx={size() / 2} 
            cy={size() / 2} 
            r={radius()}
            stroke-width={strokeWidth()}
          />
          {/* Progress arc */}
          <circle 
            class="ocr-progress-ring-progress"
            cx={size() / 2} 
            cy={size() / 2} 
            r={radius()}
            stroke-width={strokeWidth()}
            stroke-dasharray={String(circumference())}
            stroke-dashoffset={props.indeterminate ? undefined : String(strokeDashoffset())}
          />
        </svg>
        
        {/* Center percentage text */}
        <Show when={props.showPercent && !props.indeterminate}>
          <span class="ocr-progress-ring-percent">
            {progressValue()}%
          </span>
        </Show>
      </div>
      
      {/* Status text below */}
      <Show when={props.statusText}>
        <span class="ocr-progress-ring-text">{props.statusText}</span>
      </Show>
    </div>
  );
};

export default OCRProgressRing;
