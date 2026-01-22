/**
 * ContentEditable Component
 * Reusable contentEditable div with consistent styling
 */

import { Component, createEffect, JSX } from 'solid-js';
import './ContentEditable.css';

export interface ContentEditableProps {
  /** Current HTML content */
  value: string;
  /** Called when content changes */
  onChange: (html: string) => void;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Maximum height in pixels */
  maxHeight?: number;
  /** Additional class names */
  class?: string;
  /** Whether to use innerText instead of innerHTML for onChange */
  textOnly?: boolean;
  /** Label for the field */
  label?: string;
  /** Style properties */
  style?: JSX.CSSProperties;
  /** Ref callback */
  ref?: (el: HTMLDivElement) => void;
}

/**
 * ContentEditable - Editable div with HTML support
 *
 * Usage:
 * <ContentEditable
 *   value={definition()}
 *   onChange={setDefinition}
 *   placeholder="Enter definition..."
 *   label="Definition"
 * />
 */
export const ContentEditable: Component<ContentEditableProps> = (props) => {
  let divRef: HTMLDivElement | undefined;

  // Sync value to innerHTML when value changes externally
  createEffect(() => {
    if (divRef && divRef.innerHTML !== props.value) {
      divRef.innerHTML = props.value;
    }
  });

  const handleInput = (e: Event) => {
    const el = e.target as HTMLDivElement;
    const newValue = props.textOnly ? el.innerText : el.innerHTML;
    props.onChange(newValue);
  };

  const setRef = (el: HTMLDivElement) => {
    divRef = el;
    if (props.ref) {
      props.ref(el);
    }
    // Initialize with value
    if (el && props.value) {
      el.innerHTML = props.value;
    }
  };

  return (
    <div class={`content-editable-wrapper ${props.class || ''}`}>
      {props.label && <label class="content-editable-label">{props.label}</label>}
      <div
        ref={setRef}
        contentEditable
        class="content-editable"
        data-placeholder={props.placeholder}
        onInput={handleInput}
        style={{
          'min-height': props.minHeight ? `${props.minHeight}px` : undefined,
          'max-height': props.maxHeight ? `${props.maxHeight}px` : undefined,
          ...props.style,
        }}
      />
    </div>
  );
};

export default ContentEditable;
