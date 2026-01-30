/**
 * ConnectionStatus Component
 * Visual indicator for connection states
 */

import { Component, Show } from 'solid-js';
import { useLocalization } from '../../../context';
import './ConnectionStatus.css';

export type ConnectionState = 'connected' | 'disconnected' | 'loading' | 'error';

export interface ConnectionStatusProps {
  /** Connection state */
  status: ConnectionState;
  /** Whether to show text label */
  showLabel?: boolean;
  /** Custom label text */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class */
  class?: string;
}

export const ConnectionStatus: Component<ConnectionStatusProps> = (props) => {
  const { t } = useLocalization();
  
  const statusConfig: Record<ConnectionState, { icon: string; color: string; labelKey: string }> = {
    connected: { icon: '✓', color: '#4ade80', labelKey: 'mlearn.ConnectionStatus.Connected' },
    disconnected: { icon: '✗', color: '#ef4444', labelKey: 'mlearn.ConnectionStatus.Disconnected' },
    loading: { icon: '◌', color: '#f59e0b', labelKey: 'mlearn.ConnectionStatus.Connecting' },
    error: { icon: '!', color: '#ef4444', labelKey: 'mlearn.ConnectionStatus.Error' },
  };
  
  const config = () => statusConfig[props.status] || statusConfig.disconnected;
  const size = () => props.size || 'md';
  
  return (
    <span 
      class={`connection-status connection-status--${size()} connection-status--${props.status} ${props.class || ''}`}
      style={{ color: config().color }}
    >
      <span class={`connection-status-icon ${props.status === 'loading' ? 'spinning' : ''}`}>
        {config().icon}
      </span>
      <Show when={props.showLabel !== false}>
        <span class="connection-status-label">
          {props.label || t(config().labelKey)}
        </span>
      </Show>
    </span>
  );
};

export default ConnectionStatus;
