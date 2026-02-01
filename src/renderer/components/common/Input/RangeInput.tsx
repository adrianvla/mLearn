import { Component } from 'solid-js';
import './RangeInput.css';

export interface RangeInputProps {
  min?: number;
  max?: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  disabled?: boolean;
  class?: string;
  style?: import('solid-js').JSX.CSSProperties;
  tabIndex?: number;
}

export const RangeInput: Component<RangeInputProps> = (props) => {
  const handleChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    props.onChange(Number(target.value));
  };

  return (
    <input
      type="range"
      min={props.min ?? 0}
      max={props.max ?? 100}
      value={props.value}
      onChange={handleChange}
      step={props.step ?? 1}
      disabled={props.disabled ?? false}
      class={`range-input ${props.class ?? ''}`}
      style={props.style}
      tabIndex={props.tabIndex}
    />
  );
};