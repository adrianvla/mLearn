import { Component, JSX, Show, splitProps } from 'solid-js';
import './Badge.css';

export interface BadgeProps {
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  children: JSX.Element | string;
  size?: 'sm' | 'md';
  dot?: boolean;
}

export const Badge: Component<BadgeProps> = (props) => {
  const [local] = splitProps(props, ['variant', 'children', 'size', 'dot']);
  return (
    <span
      class="mlearn-badge"
      classList={{
        'mlearn-badge--sm': local.size === 'sm',
        'mlearn-badge--md': local.size === undefined || local.size === 'md',
        'mlearn-badge--success': local.variant === 'success',
        'mlearn-badge--warning': local.variant === 'warning',
        'mlearn-badge--error': local.variant === 'error',
        'mlearn-badge--info': local.variant === 'info',
        'mlearn-badge--neutral': local.variant === 'neutral',
      }}
    >
      <Show when={local.dot}>
        <span class="mlearn-badge__dot" aria-hidden="true" />
      </Show>
      <span class="mlearn-badge__label">{local.children}</span>
    </span>
  );
};
