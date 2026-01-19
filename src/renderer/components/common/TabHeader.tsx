/**
 * Tab Header Component
 * Reusable header for tab content with title and description
 */

import { Component, JSX, Show } from 'solid-js';
import './TabHeader.css';

export interface TabHeaderProps {
  title: string;
  description?: string;
  icon?: string | JSX.Element;
  actions?: JSX.Element;
  style?: JSX.CSSProperties;
  class?: string;
}

export const TabHeader: Component<TabHeaderProps> = (props) => {
  return (
    <div class={`tab-header ${props.class ?? ''}`} style={props.style}>
      <div class="tab-header-content">
        <Show when={props.icon}>
          <span class="tab-header-icon">
            {typeof props.icon === 'string' ? props.icon : props.icon}
          </span>
        </Show>
        <div class="tab-header-text">
          <h2>{props.title}</h2>
          <Show when={props.description}>
            <p>{props.description}</p>
          </Show>
        </div>
      </div>
      <Show when={props.actions}>
        <div class="tab-header-actions">
          {props.actions}
        </div>
      </Show>
    </div>
  );
};
