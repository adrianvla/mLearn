/**
 * Toggle Switch Component
 * Reusable toggle/checkbox switch for settings
 */

import { Component, JSX } from 'solid-js';
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
}

export const ToggleSwitch: Component<ToggleSwitchProps> = (props) => {
  const handleChange: JSX.ChangeEventHandler<HTMLInputElement, Event> = (e) => {
    props.onChange(e.currentTarget.checked);
  };

  return (
    <label class={`toggle-switch ${props.disabled ? 'disabled' : ''} ${props.class || ''}`}>
      <input
        type="checkbox"
        id={props.id}
        checked={props.checked}
        onChange={handleChange}
        disabled={props.disabled}
      />
      <span class="toggle-slider" />
      {props.label && <span class="toggle-label">{props.label}</span>}
    </label>
  );
};

export default ToggleSwitch;
