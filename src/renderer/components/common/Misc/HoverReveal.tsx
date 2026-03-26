/**
 * HoverReveal Component
 * Displays an icon, and on hover slides out a text label beside it.
 * Uses --text-tertiary color by default for both icon and text.
 */

import { Component, JSX } from 'solid-js';
import './HoverReveal.css';

export interface HoverRevealProps {
  /** Icon element to display permanently */
  icon: JSX.Element;
  /** Text label revealed on hover */
  label: string;
  /** Additional class names */
  class?: string;
  /** Click handler */
  onClick?: (e: MouseEvent) => void;
  /** Title attribute for accessibility */
  title?: string;
}

export const HoverReveal: Component<HoverRevealProps> = (props) => {
  return (
    <span
      class={`hover-reveal ${props.class || ''}`}
      onClick={props.onClick}
      title={props.title || props.label}
    >
      <span class="hover-reveal-icon">{props.icon}</span>
      <span class="hover-reveal-label">{props.label}</span>
    </span>
  );
};
