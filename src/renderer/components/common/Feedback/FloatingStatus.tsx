/**
 * FloatingStatus Component
 * A floating progress indicator pinned to the bottom-right corner of its container.
 * Fades in/out based on visibility. Uses ProgressRing for the indicator.
 * The parent must have `position: relative` or `position: absolute` for correct placement.
 */

import { Component } from 'solid-js';
import { ProgressRing } from '../Loader/Loader';
import './FloatingStatus.css';

export interface FloatingStatusProps {
  /** Whether the status indicator is visible */
  visible: boolean;
  /** Status text displayed under the ring */
  statusText?: string;
  /** Progress value 0-100 (ignored when indeterminate) */
  progress?: number;
  /** Show indeterminate animation instead of progress */
  indeterminate?: boolean;
  /** Ring size in px (default 40) */
  size?: number;
  /** Ring stroke width (default 5) */
  strokeWidth?: number;
  /** Ring shape (default circle) */
  shape?: 'circle' | 'square';
  /** Additional CSS class */
  class?: string;
}

export const FloatingStatus: Component<FloatingStatusProps> = (props) => {
  return (
    <div class={`floating-status ${props.visible ? 'visible' : 'hidden'} ${props.class || ''}`}>
      <ProgressRing
        progress={props.progress ?? 0}
        indeterminate={props.indeterminate ?? true}
        size={props.size ?? 40}
        strokeWidth={props.strokeWidth ?? 5}
        statusText={props.statusText}
        showPercent={false}
        shape={props.shape ?? 'circle'}
      />
    </div>
  );
};
