/**
 * Select Component
 * A styled select dropdown component
 */

import { Component, JSX, splitProps, mergeProps, For } from 'solid-js';
import './Select.css';

// ============ Types ============

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends JSX.SelectHTMLAttributes<HTMLSelectElement> {
  /** Array of options to render */
  options?: SelectOption[];
  /** Placeholder text when no value is selected */
  placeholder?: string;
  /** Additional CSS classes */
  class?: string;
}

// ============ Component ============

export const Select: Component<SelectProps> = (props) => {
  const merged = mergeProps(
    {
      options: [],
      placeholder: '',
    },
    props
  );

  const [local, others] = splitProps(merged, ['options', 'placeholder', 'class', 'value']);

  return (
    <select
      {...others}
      class={`${local.class || ''}`}
      value={local.value}
    >
      {local.placeholder && (
        <option value="" disabled>
          {local.placeholder}
        </option>
      )}
      <For each={local.options}>{(option) => (
        <option
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      )}</For>
      {props.children}
    </select>
  );
};

export default Select;
