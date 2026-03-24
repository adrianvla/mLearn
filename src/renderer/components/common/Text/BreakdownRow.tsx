/**
 * Breakdown Row Component
 * A simple label-value row for displaying statistics and data breakdowns
 * Used in stats panels and summary sections
 */

import { Component, JSX, Show } from 'solid-js';
import './BreakdownRow.css';

export interface BreakdownRowProps {
  /** Label text (left side) */
  label: string;
  /** Value to display (right side) */
  value: string | number;
  /** Optional icon before label */
  icon?: string;
  /** Optional color indicator */
  color?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS class */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
}

export const BreakdownRow: Component<BreakdownRowProps> = (props) => {
  return (
    <div 
      class={`breakdown-row size-${props.size || 'md'} ${props.class || ''}`}
      style={props.style}
    >
      <span class="breakdown-label">
        <Show when={props.color}>
          <span 
            class="breakdown-color" 
            style={{ background: props.color }}
          />
        </Show>
        <Show when={props.icon}>
          <span class="breakdown-icon">{props.icon}</span>
        </Show>
        {props.label}
      </span>
      <span class="breakdown-value">{props.value}</span>
    </div>
  );
};

export default BreakdownRow;
