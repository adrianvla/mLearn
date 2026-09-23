import type { Component } from 'solid-js';
import './RadioChoice.css';

export interface RadioChoiceProps {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  class?: string;
}

/** A card-sized choice with a native radio input for keyboard and form behavior. */
export const RadioChoice: Component<RadioChoiceProps> = (props) => (
  <label class={`radio-choice${props.checked ? ' radio-choice--selected' : ''}${props.disabled ? ' radio-choice--disabled' : ''}${props.class ? ` ${props.class}` : ''}`}>
    <input
      class="radio-choice__input"
      type="radio"
      role="radio"
      name={props.name}
      aria-label={props.label}
      checked={props.checked}
      disabled={props.disabled}
      onChange={props.onChange}
    />
    <span class="radio-choice__indicator" aria-hidden="true" />
    <span class="radio-choice__label">{props.label}</span>
  </label>
);
