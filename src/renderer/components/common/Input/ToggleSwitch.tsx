/**
 * Toggle Switch Component
 * Reusable toggle/checkbox switch for settings
 */

import { Component, JSX, Show } from 'solid-js';
import './ToggleSwitch.css';

export interface ToggleSwitchProps {
  /** Whether the switch is on/checked */
  checked: boolean;
  /** Change handler */
  onChange: (checked: boolean) => void;
  /** Optional label text */
  label?: string;
  /** Whether the switch is disabled */
  disabled?: boolean;
  /** Additional class names */
  class?: string;
  /** ID for the input element */
  id?: string;
  /** Optional icon element rendered on the toggle thumb */
  thumbIcon?: JSX.Element;
  /** Tooltip title */
  title?: string;
  /** Visual size of the switch */
  size?: 'sm' | 'md';
}

export const ToggleSwitch: Component<ToggleSwitchProps> = (props) => {
  const handleChange: JSX.ChangeEventHandler<HTMLInputElement, Event> = (e) => {
    props.onChange(e.currentTarget.checked);
  };

  return (
    <label
      class={`toggle-switch toggle-switch--${props.size ?? 'md'} ${props.disabled ? 'disabled' : ''} ${props.class || ''}`}
      title={props.title}
    >
      <input
        type="checkbox"
        id={props.id}
        checked={props.checked}
        onChange={handleChange}
        disabled={props.disabled}
      />
      <span class="toggle-slider">
        <Show when={props.thumbIcon}>
          <span class="toggle-thumb-icon">{props.thumbIcon}</span>
        </Show>
      </span>
      {props.label && <span class="toggle-label">{props.label}</span>}
    </label>
  );
};

export default ToggleSwitch;
