/**
 * ConnectionStatus Component
 * Visual indicator for connection states
 */

import { Component, Show, JSX } from 'solid-js';
import { useLocalization } from '../../../context';
import { CheckIcon, CrossIcon, WarningIcon } from '../Misc/Icons';
import { Spinner } from '../Loader';
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
  
  const statusConfig: Record<ConnectionState, { icon: JSX.Element; labelKey: string }> = {
    connected: { icon: <CheckIcon size={14} />, labelKey: 'mlearn.ConnectionStatus.Connected' },
    disconnected: { icon: <CrossIcon size={14} />, labelKey: 'mlearn.ConnectionStatus.Disconnected' },
    loading: { icon: <Spinner size={14} />, labelKey: 'mlearn.ConnectionStatus.Connecting' },
    error: { icon: <WarningIcon size={14} />, labelKey: 'mlearn.ConnectionStatus.Error' },
  };
  
  const config = () => statusConfig[props.status] || statusConfig.disconnected;
  const size = () => props.size || 'md';
  
  return (
    <span
      class={`connection-status connection-status--${size()} connection-status--${props.status} ${props.class || ''}`}
    >
      <span class={`connection-status-icon`}>
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
