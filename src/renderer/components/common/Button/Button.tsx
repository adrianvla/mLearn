/**
 * Unified Button Component
 * A single button component that can render different button variants:
 * - default: Standard styled button (default)
 * - pill: Pill/badge styled clickable button
 * - icon: Icon-only button
 * - nav: Navigation button (for reader/video controls)
 * - tab: Tab button for tab navigation
 */

import { Component, JSX, splitProps, mergeProps, Show } from 'solid-js';
import Icon from '../Icons/Icon';
import { Spinner } from '../Loader';
import './Button.css';

// ============ Types ============

export type ButtonType = 'default' | 'pill' | 'icon' | 'nav' | 'tab';

export type ButtonVariant = 
  | 'default' 
  | 'primary' 
  | 'secondary' 
  | 'danger' 
  | 'success'
  | 'warning'
  | 'ghost'
  | 'red' 
  | 'orange' 
  | 'yellow' 
  | 'green' 
  | 'blue' 
  | 'purple' 
  | 'gray';

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

// Map of icon names available in the Icon component
const ICON_NAMES = [
  'anki', 'book', 'bot', 'cards', 'check', 'chevron', 'cog', 'cross', 'cross2',
  'document', 'fast-forward', 'link', 'mlearn-logo', 'palette', 'pause', 'pin', 'pip', 'play',
  'sidebar', 'star', 'stars', 'stats', 'subtitles', 'target', 'volume'
] as const;

type IconName = typeof ICON_NAMES[number];

// Color mapping for pill button variants
const VARIANT_COLORS: Record<ButtonVariant, string> = {
  default: 'var(--pill-default-text)',
  primary: 'var(--color-primary)',
  secondary: 'var(--text-secondary)',
  danger: 'var(--color-error)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  ghost: 'var(--text-primary)',
  red: 'var(--pill-level-1-text)',
  orange: 'var(--pill-level-4-text)',
  yellow: 'var(--pill-level-6-text)',
  green: 'var(--pill-level-3-text)',
  blue: 'var(--pill-level-2-text)',
  purple: 'var(--pill-level-5-text)',
  gray: 'var(--pill-level-7-text)',
};

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button type - determines overall styling approach */
  buttonType?: ButtonType;
  /** Color variant */
  variant?: ButtonVariant;
  /** Size of the button */
  size?: ButtonSize;
  /** Icon element, path, or icon name (e.g., 'check', 'cross2') - displayed based on iconPosition */
  icon?: JSX.Element | string;
  /** Position of icon relative to text */
  iconPosition?: 'left' | 'right';
  /** Icon rotation in degrees (for pill buttons with cross->plus effect) */
  iconRotation?: number;
  /** Override icon color (useful for custom coloring) */
  iconColor?: string;
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

// ============ Icon Helper ============

/**
 * Check if a string is a valid icon name for the Icon component
 */
const isIconName = (value: string): value is IconName => {
  return ICON_NAMES.includes(value as IconName);
};

// ============ Icon Renderer ============

const ButtonIcon: Component<{ 
  icon: JSX.Element | string; 
  rotation?: number;
  color?: string;
  class?: string;
}> = (props) => {
  if (typeof props.icon === 'string') {
    // Check if it's a named icon that we can render with the Icon component
    if (isIconName(props.icon)) {
      const style: JSX.CSSProperties = props.rotation 
        ? { transform: `rotate(${props.rotation}deg)` } 
        : {};
      return (
        <span class={`btn-icon-content ${props.class || ''}`} style={style}>
          <Icon 
            icon={props.icon} 
            color={props.color || 'currentColor'} 
            class="btn-svg-icon"
          />
        </span>
      );
    }
    
    // Otherwise treat it as an image path (legacy support)
    const style: JSX.CSSProperties = props.rotation 
      ? { transform: `rotate(${props.rotation}deg)` } 
      : {};
    return (
      <span class={`btn-icon-content ${props.class || ''}`}>
        <img src={props.icon} alt="" style={style} />
      </span>
    );
  }
  return <span class={`btn-icon-content ${props.class || ''}`}>{props.icon}</span>;
};

// ============ Main Button Component ============

export const Button: Component<ButtonProps> = (props) => {
  const merged = mergeProps(
    {
      buttonType: 'default' as ButtonType,
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
    'iconColor',
    'label',
    'loading',
    'badge',
    'badgeVariant',
    'active',
    'children',
    'class',
    'disabled',
  ]);

  // Compute icon color based on button type and variant
  const computedIconColor = () => {
    // If explicit iconColor is provided, use it
    if (local.iconColor) return local.iconColor;
    
    // For pill buttons, use the variant color
    if (local.buttonType === 'pill') {
      return VARIANT_COLORS[local.variant || 'default'];
    }
    
    // For other button types, use currentColor to inherit from text color
    return 'currentColor';
  };

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

  const loadingSpinnerSize = () => {
    switch (local.size) {
      case 'xs':
        return 12;
      case 'sm':
        return 14;
      case 'lg':
        return 18;
      case 'md':
      default:
        return 16;
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
        <Spinner size={loadingSpinnerSize()} class="btn-loading-spinner" />
      </Show>

      {/* Left icon */}
      <Show when={!local.loading && local.icon && local.iconPosition === 'left'}>
        <ButtonIcon icon={local.icon!} rotation={local.iconRotation} color={computedIconColor()} />
      </Show>

      {/* Content */}
      <Show when={local.children || local.label}>
        <span class="btn-content">{local.children || local.label}</span>
      </Show>

      {/* Right icon */}
      <Show when={!local.loading && local.icon && local.iconPosition === 'right'}>
        <ButtonIcon icon={local.icon!} rotation={local.iconRotation} color={computedIconColor()} />
      </Show>

      {/* Badge (for tab buttons) */}
      <Show when={local.badge !== undefined && local.badge !== null && local.badge !== ''}>
        <span class={badgeClass()}>{local.badge}</span>
      </Show>
    </button>
  );
};

// ============ Convenience Exports ============

/** Standard button - default variant */
export const Btn: Component<Omit<ButtonProps, 'buttonType'>> = (props) => (
  <Button buttonType="default" {...props} />
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
