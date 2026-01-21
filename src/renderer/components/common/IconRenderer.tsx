/**
 * Icon Renderer Component
 * Consistently renders string/emoji/JSX icons across the application
 */

import { Component, JSX, Show } from 'solid-js';

export interface IconRendererProps {
  /** The icon to render - can be a string (emoji/path), JSX element, or undefined */
  icon?: string | JSX.Element;
  /** Alt text for image icons */
  alt?: string;
  /** CSS class to apply */
  class?: string;
  /** Size in pixels (for image icons) */
  size?: number;
}

/**
 * Renders an icon from various input types:
 * - String containing '/' or '.' = treated as image path
 * - String without '/' or '.' = treated as emoji/text
 * - JSX element = rendered as-is
 */
export const IconRenderer: Component<IconRendererProps> = (props) => {
  const isImagePath = () => {
    if (typeof props.icon !== 'string') return false;
    return props.icon.includes('/') || props.icon.includes('.');
  };

  const isString = () => typeof props.icon === 'string';

  return (
    <Show when={props.icon} fallback={null}>
      <Show when={isString()} fallback={props.icon}>
        <Show 
          when={isImagePath()} 
          fallback={<span class={props.class}>{props.icon as string}</span>}
        >
          <img 
            src={props.icon as string} 
            alt={props.alt || ''} 
            class={props.class}
            style={props.size ? { width: `${props.size}px`, height: `${props.size}px` } : undefined}
          />
        </Show>
      </Show>
    </Show>
  );
};

export default IconRenderer;
