/**
 * Unified Button Component
 * A single button component that can render different button variants:
 * - glass: Glassmorphism styled button (default)
 * - pill: Pill/badge styled clickable button
 * - icon: Icon-only button
 * - nav: Navigation button (for reader/video controls)
 * - tab: Tab button for tab navigation
 */

import { Component, JSX, splitProps, mergeProps, Show } from 'solid-js';
import './Button.css';

// ============ Types ============

export type ButtonType = 'glass' | 'pill' | 'icon' | 'nav' | 'tab';

export type ButtonVariant = 
  | 'default' 
  | 'primary' 
  | 'secondary' 
  | 'danger' 
  | 'success'
  | 'ghost'
  | 'red' 
  | 'orange' 
  | 'yellow' 
  | 'green' 
  | 'blue' 
  | 'purple' 
  | 'gray';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button type - determines overall styling approach */
  buttonType?: ButtonType;
  /** Color variant */
  variant?: ButtonVariant;
  /** Size of the button */
  size?: ButtonSize;
  /** Icon element or path - displayed based on iconPosition */
  icon?: JSX.Element | string;
  /** Position of icon relative to text */
  iconPosition?: 'left' | 'right';
  /** Icon rotation in degrees (for pill buttons with cross->plus effect) */
  iconRotation?: number;
  /** Label text (alternative to children for pill buttons) */
  label?: string;
  /** Show loading spinner */
  loading?: boolean;
  /** Badge content for tab buttons */
  badge?: string | number;
  /** Badge color variant for tab buttons */
  badgeVariant?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  /** Whether the button is active (for tabs, nav buttons) */
  active?: boolean;
  /** ARIA label (required for icon buttons) */
  'aria-label'?: string;
  /** Children content */
  children?: JSX.Element;
}

// ============ Spinner Component ============

const LoadingSpinner: Component<{ size?: string }> = (props) => (
  <svg
    class="btn-spinner"
    width={props.size || '1em'}
    height={props.size || '1em'}
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-dasharray="31.4 31.4"
      style={{ opacity: 0.3 }}
    />
    <circle
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-dasharray="31.4 31.4"
      transform="rotate(-90 12 12)"
    />
  </svg>
);

// ============ Icon Renderer ============

const ButtonIcon: Component<{ 
  icon: JSX.Element | string; 
  rotation?: number;
  class?: string;
}> = (props) => {
  if (typeof props.icon === 'string') {
    const style: JSX.CSSProperties = props.rotation 
      ? { transform: `rotate(${props.rotation}deg)` } 
      : {};
    return (
      <span class={`btn-icon ${props.class || ''}`}>
        <img src={props.icon} alt="" style={style} />
      </span>
    );
  }
  return <span class={`btn-icon ${props.class || ''}`}>{props.icon}</span>;
};

// ============ Main Button Component ============

export const Button: Component<ButtonProps> = (props) => {
  const merged = mergeProps(
    {
      buttonType: 'glass' as ButtonType,
      variant: 'default' as ButtonVariant,
      size: 'md' as ButtonSize,
      iconPosition: 'left' as const,
      loading: false,
      active: false,
    },
    props
  );

  const [local, rest] = splitProps(merged, [
    'buttonType',
    'variant',
    'size',
    'icon',
    'iconPosition',
    'iconRotation',
    'label',
    'loading',
    'badge',
    'badgeVariant',
    'active',
    'children',
    'class',
    'disabled',
  ]);

  // Build class name based on button type and props
  const buttonClass = () => {
    const classes: string[] = ['btn'];
    
    // Button type
    classes.push(`btn-${local.buttonType}`);
    
    // Variant
    if (local.variant && local.variant !== 'default') {
      classes.push(`btn-${local.variant}`);
    }
    
    // Size
    classes.push(`btn-${local.size}`);
    
    // States
    if (local.active) classes.push('btn-active');
    if (local.loading) classes.push('btn-loading');
    if (local.disabled) classes.push('btn-disabled');
    
    // Custom class
    if (local.class) classes.push(local.class as string);
    
    return classes.join(' ');
  };

  const badgeClass = () => {
    const classes = ['btn-badge'];
    if (local.badgeVariant && local.badgeVariant !== 'default') {
      classes.push(`btn-badge-${local.badgeVariant}`);
    }
    return classes.join(' ');
  };

  const handleClick = (e: MouseEvent) => {
    if (local.disabled || local.loading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const onClick = rest.onClick;
    if (typeof onClick === 'function') {
      (onClick as (e: MouseEvent) => void)(e);
    }
  };

  return (
    <button
      class={buttonClass()}
      disabled={local.disabled || local.loading}
      onClick={handleClick}
      {...rest}
    >
      {/* Loading spinner */}
      <Show when={local.loading}>
        <LoadingSpinner />
      </Show>

      {/* Left icon */}
      <Show when={!local.loading && local.icon && local.iconPosition === 'left'}>
        <ButtonIcon icon={local.icon!} rotation={local.iconRotation} />
      </Show>

      {/* Content */}
      <Show when={local.children || local.label}>
        <span class="btn-content">{local.children || local.label}</span>
      </Show>

      {/* Right icon */}
      <Show when={!local.loading && local.icon && local.iconPosition === 'right'}>
        <ButtonIcon icon={local.icon!} rotation={local.iconRotation} />
      </Show>

      {/* Badge (for tab buttons) */}
      <Show when={local.badge !== undefined && local.badge !== null && local.badge !== ''}>
        <span class={badgeClass()}>{local.badge}</span>
      </Show>
    </button>
  );
};

// ============ Convenience Exports ============

/** Glass button - default variant */
export const GlassBtn: Component<Omit<ButtonProps, 'buttonType'>> = (props) => (
  <Button buttonType="glass" {...props} />
);

/** Pill button - badge/pill styled */
export const PillBtn: Component<Omit<ButtonProps, 'buttonType'>> = (props) => (
  <Button buttonType="pill" {...props} />
);

/** Icon-only button */
export const IconBtn: Component<Omit<ButtonProps, 'buttonType'>> = (props) => (
  <Button buttonType="icon" {...props} />
);

/** Navigation button */
export const NavBtn: Component<Omit<ButtonProps, 'buttonType'>> = (props) => (
  <Button buttonType="nav" {...props} />
);

/** Tab button */
export const TabBtn: Component<Omit<ButtonProps, 'buttonType'>> = (props) => (
  <Button buttonType="tab" {...props} />
);

export default Button;
