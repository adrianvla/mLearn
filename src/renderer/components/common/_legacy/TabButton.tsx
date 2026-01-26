/**
 * Tab Button Component
 * Reusable tab navigation button with optional badge
 */

import { Component, JSX, Show } from 'solid-js';
import './TabButton.css';

export interface TabButtonProps {
  label: string;
  active?: boolean;
  badge?: string | number;
  badgeVariant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  icon?: string | JSX.Element;
  onClick?: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  style?: JSX.CSSProperties;
  class?: string;
}

export const TabButton: Component<TabButtonProps> = (props) => {
  const sizeClass = () => {
    switch (props.size) {
      case 'sm': return 'tab-button-sm';
      case 'lg': return 'tab-button-lg';
      default: return 'tab-button-md';
    }
  };

  const badgeVariantClass = () => {
    switch (props.badgeVariant) {
      case 'primary': return 'tab-button-badge-primary';
      case 'success': return 'tab-button-badge-success';
      case 'warning': return 'tab-button-badge-warning';
      case 'error': return 'tab-button-badge-error';
      default: return '';
    }
  };

  return (
    <button
      class={`tab-button ${sizeClass()} ${props.active ? 'tab-button-active' : ''} ${props.class ?? ''}`}
      style={props.style}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      <Show when={props.icon}>
        <span class="tab-button-icon">
          {typeof props.icon === 'string' ? props.icon : props.icon}
        </span>
      </Show>
      
      <span class="tab-button-label">{props.label}</span>
      
      <Show when={props.badge !== undefined && props.badge !== null && props.badge !== ''}>
        <span class={`tab-button-badge ${badgeVariantClass()}`}>
          {props.badge}
        </span>
      </Show>
    </button>
  );
};
