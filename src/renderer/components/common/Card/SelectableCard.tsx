/**
 * SelectableCard Component
 * A card that can be selected/deselected, used for language selection, theme selection, etc.
 */

import { Component, JSX, Show } from 'solid-js';
import './SelectableCard.css';

export type SelectableCardSize = 'sm' | 'md' | 'lg';
export type SelectableCardLayout = 'vertical' | 'horizontal';

export interface SelectableCardProps {
  /** Whether the card is selected */
  selected?: boolean;
  /** Whether the card is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Icon - can be an emoji, SVG element, or image path */
  icon?: string | JSX.Element;
  /** Card title */
  title: string | JSX.Element;
  /** Optional subtitle */
  subtitle?: string;
  /** Optional badge text (e.g., "Coming soon") */
  badge?: string;
  /** Optional badge as JSX element (e.g., PillLabel) — overrides badge text */
  badgeElement?: JSX.Element;
  /** Optional header actions area rendered next to the title */
  headerActions?: JSX.Element;
  /** Size variant */
  size?: SelectableCardSize;
  /** Layout direction: vertical (centered, default) or horizontal (list-like) */
  layout?: SelectableCardLayout;
  /** Show checkmark when selected */
  showCheckmark?: boolean;
  /** Additional class names */
  class?: string;
  /** Additional inline styles */
  style?: JSX.CSSProperties;
  /** Children for custom content */
  children?: JSX.Element;
}

/**
 * CheckIcon - Simple SVG checkmark
 */
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/**
 * SelectableCard - A card that can be selected/deselected
 * Used for language selection, theme options, feature toggles in grid layouts
 */
export const SelectableCard: Component<SelectableCardProps> = (props) => {
  const handleClick = () => {
    if (!props.disabled && props.onClick) {
      props.onClick();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const getIconElement = () => {
    const icon = props.icon;
    if (!icon) return null;
    
    if (typeof icon === 'string') {
      // Check if it's an image path
      if (icon.includes('/') || icon.includes('.')) {
        return <img src={icon} alt="" />;
      }
      // Treat as emoji/text
      return icon;
    }
    // JSX element
    return icon;
  };

  return (
    <div
      class={`selectable-card ${props.selected ? 'selected' : ''} ${props.disabled ? 'disabled' : ''} ${props.size ? `selectable-card--${props.size}` : ''} ${props.layout === 'horizontal' ? 'selectable-card--horizontal' : ''} ${props.class || ''}`}
      style={props.style}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={props.disabled ? -1 : 0}
      role="button"
      aria-pressed={props.selected}
      aria-disabled={props.disabled}
    >
      {/* Checkmark indicator */}
      <Show when={props.showCheckmark !== false}>
        <div class="selectable-card__check">
          <CheckIcon />
        </div>
      </Show>

      {/* Badge */}
      <Show when={props.badgeElement}>
        <div class="selectable-card__badge">{props.badgeElement}</div>
      </Show>
      <Show when={!props.badgeElement && props.badge}>
        <div class="selectable-card__badge">{props.badge}</div>
      </Show>

      {/* Icon */}
      <Show when={props.icon}>
        <div class="selectable-card__icon">
          {getIconElement()}
        </div>
      </Show>

      {/* Title / header actions */}
      <div class="selectable-card__header">
        <h3 class="selectable-card__title">{props.title}</h3>
        <Show when={props.headerActions}>
          <div class="selectable-card__header-actions">{props.headerActions}</div>
        </Show>
      </div>

      {/* Subtitle */}
      <Show when={props.subtitle}>
        <p class="selectable-card__subtitle">{props.subtitle}</p>
      </Show>

      {/* Custom children */}
      {props.children}
    </div>
  );
};

export default SelectableCard;
