/**
 * ActionCard Component
 * Large clickable card for main actions like "Watch Video", "Open Reader"
 * Used in WelcomeRoute and similar navigation screens
 */

import { Component, JSX } from 'solid-js';
import './ActionCard.css';

export interface ActionCardProps {
  /** Icon to display (emoji or element) */
  icon: string | JSX.Element;
  /** Title text */
  title: string;
  /** Description text */
  description: string;
  /** Click handler */
  onClick?: () => void;
  /** Whether this is a primary action */
  primary?: boolean;
  /** Additional class names */
  class?: string;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * ActionCard - Large clickable action button
 * Used for main navigation actions in welcome screens
 */
export const ActionCard: Component<ActionCardProps> = (props) => {
  const handleClick = () => {
    if (!props.disabled && props.onClick) {
      props.onClick();
    }
  };

  return (
    <button
      class={`action-card ${props.primary ? 'primary' : ''} ${props.disabled ? 'disabled' : ''} ${props.class || ''}`}
      onClick={handleClick}
      disabled={props.disabled}
    >
      <span class="action-icon">
        {typeof props.icon === 'string' ? props.icon : props.icon}
      </span>
      <div class="action-text">
        <h3>{props.title}</h3>
        <p>{props.description}</p>
      </div>
    </button>
  );
};

export default ActionCard;
