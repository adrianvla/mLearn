/**
 * Form Field Component
 * A labeled input wrapper for forms
 */

import { ParentComponent, Show, JSX } from 'solid-js';
import './FormField.css';

export interface FormFieldProps {
  /** Label text for the field */
  label?: string;
  /** Optional hint text below the input */
  hint?: string;
  /** Error message to display */
  error?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Layout direction */
  direction?: 'vertical' | 'horizontal';
  /** Additional CSS class */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
}

export const FormField: ParentComponent<FormFieldProps> = (props) => {
  const direction = () => props.direction || 'vertical';
  
  return (
    <div 
      class={`form-field form-field--${direction()} ${props.disabled ? 'disabled' : ''} ${props.error ? 'has-error' : ''} ${props.class || ''}`}
      style={props.style}
    >
      <Show when={props.label}>
        <label class="form-field-label">
          {props.label}
          <Show when={props.required}>
            <span class="required-indicator">*</span>
          </Show>
        </label>
      </Show>
      <div class="form-field-control">
        {props.children}
      </div>
      <Show when={props.hint && !props.error}>
        <span class="form-field-hint">{props.hint}</span>
      </Show>
      <Show when={props.error}>
        <span class="form-field-error">{props.error}</span>
      </Show>
    </div>
  );
};

export default FormField;
