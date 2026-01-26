/**
 * Pill Component
 * Styled badge/pill for levels, status indicators, POS tags
 * Matches legacy .pill styling with frequency level colors
 */

import { Component, JSX, splitProps } from 'solid-js';
import './Pill.css';

export interface PillProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  /** Frequency/JLPT level (1-7) - determines color */
  level?: number;
  /** Named color variant */
  variant?: 'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';
  /** Whether the pill is clickable */
  clickable?: boolean;
  /** Icon element to display before text */
  icon?: JSX.Element;
  children: JSX.Element;
}

export const Pill: Component<PillProps> = (props) => {
  const [local, others] = splitProps(props, ['level', 'variant', 'clickable', 'icon', 'children', 'class']);

  const getClass = () => {
    const classes = ['pill'];
    if (local.variant) classes.push(local.variant);
    if (local.clickable) classes.push('pill-btn');
    if (local.class) classes.push(local.class as string);
    return classes.join(' ');
  };

  return (
    <span
      class={getClass()}
      data-level={local.level}
      {...others}
    >
      {local.icon && <span class="icon">{local.icon}</span>}
      {local.children}
    </span>
  );
};

export default Pill;
