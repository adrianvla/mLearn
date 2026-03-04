/**
 * Select Component
 * A styled select dropdown component
 */

import { Component, JSX, splitProps, mergeProps, For, createRenderEffect } from 'solid-js';
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

  let selectRef: HTMLSelectElement | undefined;

  // Ensure the DOM value is synced after children mount and when value changes
  createRenderEffect(() => {
    const v = local.value;
    if (selectRef && v !== undefined) {
      selectRef.value = String(v);
    }
  });

  return (
    <select
      ref={selectRef}
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
          selected={option.value === local.value}
        >
          {option.label}
        </option>
      )}</For>
      {props.children}
    </select>
  );
};

export default Select;
