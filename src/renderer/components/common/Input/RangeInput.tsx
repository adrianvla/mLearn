import { Component, createSignal, createEffect, on } from 'solid-js';
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

/**
 * Range Input Component
 * Uses local state during drag to prevent jitter, syncs with props when not dragging
 */
export const RangeInput: Component<RangeInputProps> = (props) => {
  // Track whether user is actively dragging
  const [isDragging, setIsDragging] = createSignal(false);
  // Local value for smooth dragging
  const [localValue, setLocalValue] = createSignal(props.value);

  // Sync local value with props when not dragging
  createEffect(on(() => props.value, (newValue) => {
    if (!isDragging()) {
      setLocalValue(newValue);
    }
  }));

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const value = Number(target.value);
    setLocalValue(value);
    props.onChange(value);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    // Sync final value
    props.onChange(localValue());
  };

  // Also handle touch events for mobile
  const handleTouchStart = () => {
    setIsDragging(true);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    props.onChange(localValue());
  };

  return (
      <input
          type="range"
          min={props.min ?? 0}
          max={props.max ?? 100}
          value={localValue()}
          onInput={handleInput}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          step={props.step ?? 1}
          disabled={props.disabled ?? false}
          class={`range-input ${props.class ?? ''}`}
          style={props.style}
          tabIndex={props.tabIndex}
      />
  );
};