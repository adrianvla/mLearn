/**
 * Stat Card Component
 * Reusable component for displaying statistics
 */

import { Component, JSX, Show } from 'solid-js';
import { Panel } from '../Panel';
import './StatCard.css';

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string | JSX.Element;
  description?: string;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  color?: 'default' | 'primary' | 'success' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'glass' | 'minimal';
  style?: JSX.CSSProperties;
  class?: string;
}

export const StatCard: Component<StatCardProps> = (props) => {
  const sizeClass = () => {
    switch (props.size) {
      case 'sm': return 'stat-card-sm';
      case 'lg': return 'stat-card-lg';
      default: return 'stat-card-md';
    }
  };

  const colorClass = () => {
    switch (props.color) {
      case 'primary': return 'stat-card-primary';
      case 'success': return 'stat-card-success';
      case 'warning': return 'stat-card-warning';
      case 'error': return 'stat-card-error';
      default: return '';
    }
  };

  const trendIcon = () => {
    if (!props.trend) return null;
    switch (props.trend.direction) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return '→';
    }
  };

  const trendClass = () => {
    if (!props.trend) return '';
    switch (props.trend.direction) {
      case 'up': return 'stat-card-trend-up';
      case 'down': return 'stat-card-trend-down';
      default: return 'stat-card-trend-neutral';
    }
  };

  const content = (
    <div class={`stat-card ${sizeClass()} ${colorClass()} ${props.class ?? ''}`} style={props.style}>
      <Show when={props.icon}>
        <div class="stat-card-icon">
          {typeof props.icon === 'string' ? props.icon : props.icon}
        </div>
      </Show>
      
      <div class="stat-card-content">
        <span class="stat-card-label">{props.label}</span>
        <div class="stat-card-value-row">
          <span class="stat-card-value">{props.value}</span>
          <Show when={props.trend}>
            <span class={`stat-card-trend ${trendClass()}`}>
              {trendIcon()} {Math.abs(props.trend!.value)}%
            </span>
          </Show>
        </div>
        <Show when={props.description}>
          <span class="stat-card-description">{props.description}</span>
        </Show>
      </div>
    </div>
  );

  if (props.variant === 'glass') {
    return (
      <Panel variant="elevated" blur="md" rounded="lg" padding="md">
        {content}
      </Panel>
    );
  }

  return content;
};
