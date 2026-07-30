/**
 * FrequencyStars Component
 * Displays star icons based on word frequency level
 */

import { Component, For, Show, createMemo, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import type { FrequencyStarCollapseMode } from '../../../../shared/types';
import './FrequencyStars.css';

export interface FrequencyStarsProps {
  /** Raw language-specific frequency/proficiency level. */
  level: number;
  /** Bounded visual rank used for star count and color palette. Defaults to level. */
  visualLevel?: number;
  /** Maximum stars to display. */
  maxStars?: number;
  /** Collapse policy. 'auto' measures whether the star row fits under the word. */
  collapse?: FrequencyStarCollapseMode;
  /** Minimum px clearance between this word's star row and the neighbors' (auto mode). */
  margin?: number;
  /** Additional class name */
  class?: string;
  /** Size variant */
  size?: 'small' | 'medium' | 'large';
}

const STAR_PX = { small: 6, medium: 10, large: 14 } as const;

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

  let rootEl: HTMLSpanElement | undefined;
  const [autoCollapsed, setAutoCollapsed] = createSignal(false);

  const fullStarCount = createMemo(() => {
    const max = props.maxStars ?? 7;
    return Math.min(Math.max(visualLevel() || 0, 0), max);
  });

  const collapsed = createMemo(() => {
    const mode = props.collapse ?? 'auto';
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return autoCollapsed();
  });

  const starCount = createMemo(() => (collapsed() ? 1 : fullStarCount()));

  const stars = createMemo(() => {
    return Array.from({ length: starCount() }, (_, i) => i);
  });

  const sizeClass = createMemo(() => {
    if (props.size === 'small') return 'frequency-small';
    if (props.size === 'large') return 'frequency-large';
    return '';
  });

  // The star row is centered under the word and may overflow into the inter-word
  // gaps; each side may use half the gap minus the margin so neighbors keep clearance.
  const measure = () => {
    if ((props.collapse ?? 'auto') !== 'auto' || !rootEl) {
      setAutoCollapsed(false);
      return;
    }
    const word = rootEl.parentElement;
    if (!word) {
      setAutoCollapsed(false);
      return;
    }
    const rect = word.getBoundingClientRect();
    const margin = props.margin ?? 0;
    const clearance = (sibling: Element | null, side: 'left' | 'right'): number => {
      if (!sibling) return Infinity;
      const sRect = sibling.getBoundingClientRect();
      if (Math.abs(sRect.top - rect.top) > rect.height / 2) return Infinity;
      const gap = side === 'left' ? rect.left - sRect.right : sRect.left - rect.right;
      return Math.max(0, (gap - margin) / 2);
    };
    const allowed =
      rect.width +
      clearance(word.previousElementSibling, 'left') +
      clearance(word.nextElementSibling, 'right');
    const needed = fullStarCount() * STAR_PX[props.size ?? 'medium'];
    setAutoCollapsed(needed > allowed);
  };

  onMount(() => {
    measure();
    const word = rootEl?.parentElement;
    if (word && typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(word);
      if (word.previousElementSibling) observer.observe(word.previousElementSibling);
      if (word.nextElementSibling) observer.observe(word.nextElementSibling);
      onCleanup(() => observer.disconnect());
    }
  });

  createEffect(() => {
    props.level;
    props.visualLevel;
    props.collapse;
    props.margin;
    props.size;
    props.maxStars;
    measure();
  });

  return (
    <Show when={visualLevel() > 0}>
      <span
        ref={rootEl}
        class={`frequency ${sizeClass()} ${props.class || ''}`}
        data-level={visualLevel()}
        data-raw-level={props.level}
      >
        <Show when={collapsed()}>
          <span class="star-count">{visualLevel()}</span>
        </Show>
        <For each={stars()}>
          {() => <span class="star" />}
        </For>
      </span>
    </Show>
  );
};
