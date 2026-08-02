/**
 * Color Input Component
 * Reusable color picker for settings
 */

import { Component } from 'solid-js';
import './ColorInput.css';

export interface ColorInputProps {
  /** Current color value (hex string) */
  value: string;
  /** Change handler receiving the new color value */
  onChange: (value: string) => void;
  /** Whether the picker is disabled */
  disabled?: boolean;
  /** Additional class names */
  class?: string;
  /** Tooltip title */
  title?: string;
}

export const ColorInput: Component<ColorInputProps> = (props) => (
  <input
    type="color"
    class={`color-input ${props.class || ''}`}
    value={props.value}
    disabled={props.disabled}
    title={props.title}
    onChange={(e) => props.onChange(e.currentTarget.value)}
  />
);

export default ColorInput;
