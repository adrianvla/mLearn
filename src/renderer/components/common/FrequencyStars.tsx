/**
 * FrequencyStars Component
 * Displays star icons based on word frequency level
 * Matches legacy .frequency styling from the old app
 */

import { Component, For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js/jsx-runtime';
import './FrequencyStars.css';

export interface FrequencyStarsProps {
  /** The frequency level (1-7 typically) */
  level: number;
  /** Maximum stars to display */
  maxStars?: number;
  /** Additional class name */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
}

/**
 * FrequencyStars - Displays frequency level as colored star icons
 * 
 * Level colors match the old app:
 * - Level 1: Red (most rare/difficult)
 * - Level 2: Blue
 * - Level 3: Green
 * - Level 4: Orange
 * - Level 5: Purple
 * - Level 6: Yellow
 * - Level 7: Gray (most common)
 */
export const FrequencyStars: Component<FrequencyStarsProps> = (props) => {
  const starCount = createMemo(() => {
    const max = props.maxStars ?? 7;
    const level = Math.min(Math.max(props.level || 0, 0), max);
    return level;
  });

  const stars = createMemo(() => {
    return Array.from({ length: starCount() }, (_, i) => i);
  });

  const sizeClass = createMemo(() => {
    if (props.size === 'small') return 'frequency-small';
    if (props.size === 'large') return 'frequency-large';
    return '';
  });

  return (
    <Show when={starCount() > 0}>
      <span 
        class={`frequency ${sizeClass()} ${props.class || ''}`}
        data-level={props.level}
        style={props.style}
      >
        <For each={stars()}>
          {() => <span class="star" />}
        </For>
      </span>
    </Show>
  );
};

export default FrequencyStars;
