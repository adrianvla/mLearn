/**
 * Empty State Component
 * Reusable component for displaying empty or no-content states
 */

import { Component, JSX, Show } from 'solid-js';
import { Panel } from '../Panel';
import { Btn } from '../Button';
import './EmptyState.css';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
}

export interface EmptyStateProps {
  icon?: string | JSX.Element;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  actions?: EmptyStateAction[];
  variant?: 'default' | 'minimal' | 'card';
  size?: 'sm' | 'md' | 'lg';
  style?: JSX.CSSProperties;
  class?: string;
}

export const EmptyState: Component<EmptyStateProps> = (props) => {
  const sizeClass = () => {
    switch (props.size) {
      case 'sm': return 'empty-state-sm';
      case 'lg': return 'empty-state-lg';
      default: return 'empty-state-md';
    }
  };

  const allActions = () => {
    if (props.actions) return props.actions;
    if (props.action) return [props.action];
    return [];
  };

  const content = (
    <div class={`empty-state ${sizeClass()} ${props.class ?? ''}`} style={props.style}>
      <Show when={props.icon}>
        <div class="empty-state-icon">
          {typeof props.icon === 'string' ? props.icon : props.icon}
        </div>
      </Show>
      
      <h3 class="empty-state-title">{props.title}</h3>
      
      <Show when={props.description}>
        <p class="empty-state-description">{props.description}</p>
      </Show>
      
      <Show when={allActions().length > 0}>
        <div class="empty-state-actions">
          {allActions().map(action => (
            <Btn
              variant={action.variant ?? 'primary'}
              onClick={action.onClick}
            >
              {action.label}
            </Btn>
          ))}
        </div>
      </Show>
    </div>
  );

  // Wrap in card if variant is 'card'
  if (props.variant === 'card') {
    return (
      <Panel
        variant="elevated"
        rounded="xl"
        padding="xl"
        style={{ 'max-width': '400px', margin: '0 auto' }}
      >
        {content}
      </Panel>
    );
  }

  return content;
};
