/**
 * Skeleton Loader Component
 * Animated loading placeholder for content
 * Used in WordHover and other places for loading states
 */

import { Component, For } from 'solid-js';
import './SkeletonLoader.css';

export interface SkeletonLoaderProps {
  /** Number of skeleton lines to show (randomized widths) */
  lines?: number;
  /** Class name for container */
  class?: string;
}

export const SkeletonLoader: Component<SkeletonLoaderProps> = (props) => {
  const lines = () => props.lines ?? Math.floor(Math.random() * 10) + 10;
  
  // Generate random widths for skeleton lines
  const widths = () => Array.from({ length: lines() }, () => 
    Math.floor(Math.random() * 100) + 10
  );
  
  return (
    <div class={`skeleton-loader ${props.class || ''}`}>
      <div class="skeleton-lines">
        <For each={widths()}>
          {(width) => (
            <span class="skeleton" style={{ width: `${width}px` }} />
          )}
        </For>
      </div>
    </div>
  );
};

/**
 * Spinner Loader Component
 * Spinning circle indicator for loading states
 */
export interface SpinnerLoaderProps {
  /** Size of spinner in pixels */
  size?: number;
  /** Optional text to show below spinner */
  text?: string;
  /** Class name for container */
  class?: string;
}

export const SpinnerLoader: Component<SpinnerLoaderProps> = (props) => {
  const size = () => props.size ?? 32;
  
  return (
    <div class={`spinner-loader ${props.class || ''}`}>
      <div 
        class="spinner" 
        style={{ 
          width: `${size()}px`, 
          height: `${size()}px` 
        }} 
      />
      {props.text && <span class="spinner-text">{props.text}</span>}
    </div>
  );
};

export default SkeletonLoader;
