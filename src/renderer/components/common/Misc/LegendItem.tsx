/**
 * LegendItem Component
 * Chart legend with color box and label
 */

import { Component, Show } from 'solid-js';
import { ArrowRightIcon } from './Icons';
import './LegendItem.css';

export interface LegendItemProps {
  /** Color for the legend box */
  color: string;
  /** Secondary color (for gradient legends) */
  secondaryColor?: string;
  /** Show arrow between colors (for gradient legends) */
  showArrow?: boolean;
  /** Label text */
  label: string;
  /** Optional count/value */
  count?: number;
  /** Optional percentage */
  percent?: number;
  /** Box shape */
  shape?: 'square' | 'circle' | 'line';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether the item is active/highlighted */
  active?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Additional class */
  class?: string;
}

export const LegendItem: Component<LegendItemProps> = (props) => {
  const shape = () => props.shape || 'square';
  const size = () => props.size || 'md';
  
  return (
    <div 
      class={`legend-item legend-item--${size()} ${props.active ? 'active' : ''} ${props.onClick ? 'clickable' : ''} ${props.class || ''}`}
      onClick={props.onClick}
    >
      <span class="legend-label">{props.label}</span>
      <span 
        class={`legend-color legend-color--${shape()}`}
        style={{ background: props.color }}
      />
      <Show when={props.showArrow && props.secondaryColor}>
        <span class="legend-arrow"><ArrowRightIcon size={12} /></span>
        <span 
          class={`legend-color legend-color--${shape()}`}
          style={{ background: props.secondaryColor }}
        />
      </Show>
      <Show when={props.count !== undefined}>
        <span class="legend-count">{props.count}</span>
      </Show>
      <Show when={props.percent !== undefined}>
        <span class="legend-percent">({props.percent}%)</span>
      </Show>
    </div>
  );
};

export default LegendItem;
