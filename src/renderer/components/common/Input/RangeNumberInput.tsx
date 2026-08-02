/**
 * Range Number Input Component
 * Composite range slider + number input with an optional unit label
 */

import { Component, JSX } from 'solid-js';
import { RangeInput } from './RangeInput';
import { Input } from './Input';
import './RangeNumberInput.css';

export interface RangeNumberInputProps {
  /** Current numeric value */
  value: number;
  /** Minimum allowed value (inclusive) */
  min: number;
  /** Maximum allowed value (inclusive) */
  max: number;
  /** Step for the slider and number input */
  step: number;
  /** Change handler receiving the validated value */
  onChange: (value: number) => void;
  /** Optional unit label rendered after the number input */
  unit?: string;
  /** Parse the number input as an integer instead of a float */
  integer?: boolean;
  /** Whether the controls are disabled */
  disabled?: boolean;
  /** Additional class names */
  class?: string;
}

export const RangeNumberInput: Component<RangeNumberInputProps> = (props) => {
  const handleNumberChange: JSX.ChangeEventHandler<HTMLInputElement, Event> = (e) => {
    const parsed = props.integer ? Number.parseInt(e.currentTarget.value, 10) : Number.parseFloat(e.currentTarget.value);
    if (!Number.isNaN(parsed) && parsed >= props.min && parsed <= props.max) {
      props.onChange(parsed);
    }
  };

  return (
    <div class={`range-number-input ${props.class || ''}`}>
      <RangeInput
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={props.onChange}
      />
      <Input
        type="number"
        ghost
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={handleNumberChange}
        style={{ width: '70px', 'text-align': 'center' }}
      />
      <span class="range-number-input__unit">{props.unit ?? ''}</span>
    </div>
  );
};

export default RangeNumberInput;
