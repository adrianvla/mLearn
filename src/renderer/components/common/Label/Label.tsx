/**
 * Unified Label Component
 * A single label/badge component that can render different types:
 * - pill: Colored pill/badge (for levels, POS tags, etc.)
 * - status: Word status indicator (unknown/learning/known)
 * - badge: Small inline badge (for counts, indicators)
 * - tag: Inline tag (for page numbers, metadata)
 * - indicator: Dot indicator for status
 */

import { Component, JSX, Show, createMemo } from 'solid-js';
import './Label.css';

// ============ Types ============

export type LabelType = 'pill' | 'status' | 'badge' | 'tag' | 'indicator';

export type LabelVariant = 
  | 'default'
  | 'red' 
  | 'orange' 
  | 'yellow' 
  | 'green' 
  | 'blue' 
  | 'purple' 
  | 'gray'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error';

export type StatusType = 'unknown' | 'learning' | 'known';

export type LabelSize = 'xs' | 'sm' | 'md' | 'lg';

export interface LabelProps {
  /** Type of label to display */
  type?: LabelType;
  /** Color variant */
  variant?: LabelVariant;
  /** For status type: the word status */
  status?: StatusType;
  /** Size of the label */
  size?: LabelSize;
  /** Frequency/JLPT level (1-7) - determines color for pills */
  level?: number;
  /** Icon element or path */
  icon?: JSX.Element | string;
  /** Whether to show only icon (no text) */
  iconOnly?: boolean;
  /** Whether to show icon at all (true by default) */
  showIcon?: boolean;
  /** Whether the label is clickable */
  clickable?: boolean;
  /** Whether this label is in an active/selected state */
  active?: boolean;
  /** Click handler */
  onClick?: (e: MouseEvent) => void;
  /** Mouse enter handler */
  onMouseEnter?: (e: MouseEvent) => void;
  /** Mouse leave handler */
  onMouseLeave?: (e: MouseEvent) => void;
  /** Count value (for badges) */
  count?: number | string;
  /** Additional CSS class */
  class?: string;
  /** Children content */
  children?: JSX.Element;

  headless?: boolean;
}

// ============ Icon Paths ============
const ICON_CROSS = 'assets/icons/cross2.svg';
const ICON_CHECK = 'assets/icons/check.svg';

// ============ Icon Renderer ============

const LabelIcon: Component<{ 
  icon: JSX.Element | string;
  class?: string;
}> = (props) => {
  if (typeof props.icon === 'string') {
    return (
      <span class={`label-icon ${props.class || ''}`}>
        <img src={props.icon} alt="" />
      </span>
    );
  }
  return <span class={`label-icon ${props.class || ''}`}>{props.icon}</span>;
};

// ============ Status Label Helper ============

const getStatusConfig = (status: StatusType) => {
  switch (status) {
    case 'unknown':
      return { variant: 'red' as const, icon: ICON_CROSS, label: 'Unknown' };
    case 'learning':
      return { variant: 'orange' as const, icon: ICON_CHECK, label: 'Learning' };
    case 'known':
      return { variant: 'green' as const, icon: ICON_CHECK, label: 'Known' };
    default:
      return { variant: 'gray' as const, icon: '', label: '' };
  }
};

// ============ Main Label Component ============

export const Label: Component<LabelProps> = (props) => {
  const type = () => props.type || 'pill';
  const size = () => props.size || 'md';
  const clickable = () => props.clickable === true || !!props.onClick;
  const showIcon = () => props.showIcon !== false; // defaults to true
  
  // For status type, derive variant and icon
  const statusConfig = createMemo(() => {
    if (type() === 'status' && props.status) {
      return getStatusConfig(props.status);
    }
    return null;
  });
  
  // Determine the variant
  const variant = createMemo(() => {
    if (statusConfig()) return statusConfig()!.variant;
    return props.variant || 'default';
  });
  
  // Determine the icon
  const icon = createMemo(() => {
    if (!showIcon()) return undefined;
    if (statusConfig() && !props.icon) return statusConfig()!.icon;
    return props.icon;
  });
  
  // Build class name
  const labelClass = () => {
    const classes: string[] = ['label'];
    
    // Type
    classes.push(`label-${type()}`);
    
    // Variant (color)
    if (variant() && variant() !== 'default') {
      classes.push(`label-${variant()}`);
    }
    
    // Size
    classes.push(`label-${size()}`);
    
    // Clickable
    if (clickable()) {
      classes.push('label-clickable');
    }
    
    // Active state
    if (props.active) {
      classes.push('label-active');
    }
    
    // Custom class
    if (props.class) {
      classes.push(props.class);
    }

    if(props.headless) classes.push('label-headless');
    
    return classes.join(' ');
  };

  const handleClick = (e: MouseEvent) => {
    if (!clickable()) return;
    e.stopPropagation();
    props.onClick?.(e);
  };

  // Content to display
  const content = createMemo(() => {
    // For status type without children, show the status label
    if (type() === 'status' && !props.children && statusConfig() && !props.iconOnly) {
      return statusConfig()!.label;
    }
    return props.children;
  });

  return (
    <span
      class={labelClass()}
      data-level={props.level}
      onClick={clickable() ? handleClick : undefined}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      role={clickable() ? 'button' : undefined}
      tabIndex={clickable() ? 0 : undefined}
    >
      {/* Icon */}
      <Show when={icon()}>
        <LabelIcon icon={icon()!} />
      </Show>
      
      {/* Content */}
      <Show when={content()}>
        <span class="label-content">{content()}</span>
      </Show>
      
      {/* Count (for badges) */}
      <Show when={props.count !== undefined}>
        <span class="label-count">{props.count}</span>
      </Show>
    </span>
  );
};

// ============ Convenience Exports ============

/** Pill label - colored badge */
export const PillLabel: Component<Omit<LabelProps, 'type'>> = (props) => (
  <Label type="pill" {...props} />
);

/** Status label - word status indicator */
export interface StatusLabelProps extends Omit<LabelProps, 'type' | 'status'> {
  status: StatusType;
  /** Whether this status is active/selected */
  active?: boolean;
  /** Whether to show icon (default true) */
  showIcon?: boolean;
}

export const StatusLabel: Component<StatusLabelProps> = (props) => (
  <Label type="status" {...props} />
);

/** Badge - small inline badge */
export const Badge: Component<Omit<LabelProps, 'type'>> = (props) => (
  <Label type="badge" {...props} />
);

/** Tag - inline tag for metadata */
export const Tag: Component<Omit<LabelProps, 'type'>> = (props) => (
  <Label type="tag" {...props} />
);

/** Indicator - dot indicator */
export const Indicator: Component<Omit<LabelProps, 'type'>> = (props) => (
  <Label type="indicator" {...props} />
);

// ============ Helper Functions ============

/** Convert numeric status to StatusType */
export function numericToStatus(num: number): StatusType {
  switch (num) {
    case 1: return 'learning';
    case 2: return 'known';
    default: return 'unknown';
  }
}

/** Convert StatusType to numeric */
export function statusToNumeric(status: StatusType): number {
  switch (status) {
    case 'learning': return 1;
    case 'known': return 2;
    default: return 0;
  }
}

/** Get next status in cycle */
export function getNextStatus(current: StatusType): StatusType {
  const cycle: StatusType[] = ['unknown', 'learning', 'known'];
  const idx = cycle.indexOf(current);
  return cycle[(idx + 1) % cycle.length];
}

export default Label;
