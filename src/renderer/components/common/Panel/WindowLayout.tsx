/**
 * Window Layout Component
 * Shared layout structure for Electron window apps
 * Provides consistent header, sidebar, and content areas
 */

import { Component, JSX, Show, splitProps, mergeProps } from 'solid-js';
import './WindowLayout.css';

export interface WindowLayoutProps {
  /** Header element (fixed at top) */
  header?: JSX.Element;
  /** Sidebar element (fixed to left) */
  sidebar?: JSX.Element;
  /** Main content area */
  children?: JSX.Element;
  /** Footer element (fixed at bottom) */
  footer?: JSX.Element;
  /** Additional class name */
  class?: string;
  /** Custom styles */
  style?: JSX.CSSProperties;
  /** Whether to apply dark mode */
  dark?: boolean;
  /** Padding for content area */
  contentPadding?: 'none' | 'sm' | 'md' | 'lg';
  /** Direction of the layout - vertical (default) or horizontal with sidebar */
  direction?: 'vertical' | 'horizontal';
}

export const WindowLayout: Component<WindowLayoutProps> = (props) => {
  const merged = mergeProps({
    contentPadding: 'md' as const,
    direction: 'vertical' as const,
    dark: true,
  }, props);
  
  const [local, rest] = splitProps(merged, [
    'header',
    'sidebar',
    'children',
    'footer',
    'class',
    'style',
    'dark',
    'contentPadding',
    'direction',
  ]);
  
  const paddingMap = {
    none: '0',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
  };
  
  return (
    <div
      class={`window-layout ${local.direction} ${local.dark ? 'dark' : ''} ${local.class || ''}`}
      style={local.style}
      {...rest}
    >
      {/* Header */}
      <Show when={local.header}>
        <header class="window-layout__header">
          {local.header}
        </header>
      </Show>
      
      {/* Main area (sidebar + content) */}
      <div class="window-layout__main">
        {/* Sidebar */}
        <Show when={local.sidebar}>
          <aside class="window-layout__sidebar">
            {local.sidebar}
          </aside>
        </Show>
        
        {/* Content */}
        <main
          class="window-layout__content"
          style={{ padding: paddingMap[local.contentPadding] }}
        >
          {local.children}
        </main>
      </div>
      
      {/* Footer */}
      <Show when={local.footer}>
        <footer class="window-layout__footer">
          {local.footer}
        </footer>
      </Show>
    </div>
  );
};

/**
 * Window Header Component
 * Standard header with title, subtitle, and actions
 */
export interface WindowHeaderProps {
  title: string;
  subtitle?: string;
  icon?: JSX.Element | string;
  actions?: JSX.Element;
  class?: string;
  style?: JSX.CSSProperties;
}

export const WindowHeader: Component<WindowHeaderProps> = (props) => {
  return (
    <div class={`window-header ${props.class || ''}`} style={props.style}>
      <div class="window-header__title-group">
        <Show when={props.icon}>
          <span class="window-header__icon">
            {typeof props.icon === 'string' ? props.icon : props.icon}
          </span>
        </Show>
        <div class="window-header__text">
          <h1 class="window-header__title">{props.title}</h1>
          <Show when={props.subtitle}>
            <p class="window-header__subtitle">{props.subtitle}</p>
          </Show>
        </div>
      </div>
      <Show when={props.actions}>
        <div class="window-header__actions">
          {props.actions}
        </div>
      </Show>
    </div>
  );
};

export default WindowLayout;
