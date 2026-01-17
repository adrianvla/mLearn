/**
 * Pill Button Component
 * Clickable pill/badge for actions like status change, flashcard add, etc.
 * Matches legacy .pill-btn styling from the old app
 */

import { Component, JSX, Show } from 'solid-js';
import './Pill.css';

export type PillVariant = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray' | 'default';

export interface PillButtonProps {
  /** Color variant */
  variant?: PillVariant;
  /** Icon path or element */
  icon?: string | JSX.Element;
  /** Icon rotation in degrees (for cross -> plus effect) */
  iconRotation?: number;
  /** Button label */
  label: string;
  /** Click handler */
  onClick?: (e: MouseEvent) => void;
  /** Whether button is disabled */
  disabled?: boolean;
  /** Additional class names */
  class?: string;
  /** ID for the element */
  id?: string;
}

/**
 * PillButton - Interactive pill-styled button
 * Used for status pills, flashcard buttons, LLM explain, etc.
 */
export const PillButton: Component<PillButtonProps> = (props) => {
  const getIconElement = () => {
    const icon = props.icon;
    if (!icon) return null;
    
    if (typeof icon === 'string') {
      const style: JSX.CSSProperties = props.iconRotation 
        ? { transform: `rotate(${props.iconRotation}deg)` } 
        : {};
      return <img src={icon} alt="" style={style} />;
    }
    return icon;
  };

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!props.disabled && props.onClick) {
      props.onClick(e);
    }
  };

  return (
    <button
      type="button"
      id={props.id}
      class={`pill pill-btn ${props.variant || ''} ${props.disabled ? 'disabled' : ''} ${props.class || ''}`}
      onClick={handleClick}
      disabled={props.disabled}
    >
      <Show when={props.icon}>
        <span class="icon">
          {getIconElement()}
        </span>
      </Show>
      <span>{props.label}</span>
    </button>
  );
};

export default PillButton;
