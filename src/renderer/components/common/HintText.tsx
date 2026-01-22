/**
 * Hint Text Component
 * Small helper text for providing additional context
 */

import { Component, JSX } from 'solid-js';
import './HintText.css';

export interface HintTextProps {
  /** The hint text content */
  children: JSX.Element;
  /** Visual variant */
  variant?: 'default' | 'warning' | 'info' | 'success' | 'error';
  /** Size of the text */
  size?: 'sm' | 'md';
  /** Whether to show an icon */
  showIcon?: boolean;
  /** Additional CSS class */
  class?: string;
}

const ICONS: Record<string, string> = {
  default: '',
  warning: '⚠️',
  info: 'ℹ️',
  success: '✓',
  error: '✕',
};

export const HintText: Component<HintTextProps> = (props) => {
  const variant = () => props.variant || 'default';
  const size = () => props.size || 'sm';
  const showIcon = () => props.showIcon && ICONS[variant()];
  
  return (
    <span class={`hint-text hint-text--${variant()} hint-text--${size()} ${props.class || ''}`}>
      {showIcon() && <span class="hint-icon">{ICONS[variant()]}</span>}
      {props.children}
    </span>
  );
};

export default HintText;
