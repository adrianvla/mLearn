/**
 * CheckboxCard Component
 * Styled checkbox with title and description in a card format
 */

import { Component, Show, JSX } from 'solid-js';
import './CheckboxCard.css';

export interface CheckboxCardProps {
  /** Whether the checkbox is checked */
  checked: boolean;
  /** Change handler */
  onChange: (checked: boolean) => void;
  /** Title text */
  title: string;
  /** Optional description text */
  description?: string;
  /** Whether the checkbox is disabled */
  disabled?: boolean;
  /** Card variant */
  variant?: 'default' | 'bordered';
  /** Additional class */
  class?: string;
  /** Additional content to render after description */
  children?: JSX.Element;
}

export const CheckboxCard: Component<CheckboxCardProps> = (props) => {
  const variant = () => props.variant || 'default';
  
  const handleChange = (e: Event) => {
    if (props.disabled) return;
    const target = e.target as HTMLInputElement;
    props.onChange(target.checked);
  };
  
  return (
    <label 
      class={`checkbox-card checkbox-card--${variant()} ${props.checked ? 'checked' : ''} ${props.disabled ? 'disabled' : ''} ${props.class || ''}`}
    >
      <input 
        type="checkbox" 
        checked={props.checked} 
        onChange={handleChange}
        disabled={props.disabled}
        class="checkbox-card-input"
      />
      <span class="checkbox-card-check">
        <Show when={props.checked}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </Show>
      </span>
      <span class="checkbox-card-content">
        <strong class="checkbox-card-title">{props.title}</strong>
        <Show when={props.description}>
          <small class="checkbox-card-description">{props.description}</small>
        </Show>
        <Show when={props.children}>
          <div class="checkbox-card-extra">{props.children}</div>
        </Show>
      </span>
    </label>
  );
};

export default CheckboxCard;
