/**
 * FrequencyStars Component
 * Displays star icons based on word frequency level
 */

import { Component, For, Show, createMemo } from 'solid-js';
import './FrequencyStars.css';

export interface FrequencyStarsProps {
  /** Raw language-specific frequency/proficiency level. */
  level: number;
  /** Bounded visual rank used for star count and color palette. Defaults to level. */
  visualLevel?: number;
  /** Maximum stars to display. */
  maxStars?: number;
  /** Additional class name */
  class?: string;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
}

/**
 * FrequencyStars - Displays frequency level as colored star icons
 * 
 * Level colors (via hue-rotate on the base red star SVG):
 * - Level 1: Red (most rare/difficult)
 * - Level 2: Blue
 * - Level 3: Green
 * - Level 4: Orange
 * - Level 5: Purple
 * - Level 6: Yellow
 * - Level 7: Gray (most common)
 */
export const FrequencyStars: Component<FrequencyStarsProps> = (props) => {
  const visualLevel = createMemo(() => props.visualLevel ?? props.level);

  const starCount = createMemo(() => {
    const max = props.maxStars ?? 7;
    return Math.min(Math.max(visualLevel() || 0, 0), max);
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
        data-level={visualLevel()}
        data-raw-level={props.level}
      >
        <For each={stars()}>
          {() => <span class="star" />}
        </For>
      </span>
    </Show>
  );
};
