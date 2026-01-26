/**
 * Status Pill Component
 * Clickable pill button for word status (Unknown/Learning/Known)
 */

import { Component, Show } from 'solid-js';
import './StatusPill.css';

export interface StatusPillProps {
  status: 'unknown' | 'learning' | 'known';
  active?: boolean;
  onClick?: () => void;
  showIcon?: boolean;
}

const ICON_CROSS = '/assets/icons/cross2.svg';
const ICON_CHECK = '/assets/icons/check.svg';

export const StatusPill: Component<StatusPillProps> = (props) => {
  const getVariantClass = () => {
    switch (props.status) {
      case 'unknown':
        return 'red';
      case 'learning':
        return 'orange';
      case 'known':
        return 'green';
      default:
        return '';
    }
  };

  const getLabel = () => {
    switch (props.status) {
      case 'unknown':
        return 'Unknown';
      case 'learning':
        return 'Learning';
      case 'known':
        return 'Known';
      default:
        return '';
    }
  };

  const getIcon = () => {
    switch (props.status) {
      case 'unknown':
        return ICON_CROSS;
      case 'learning':
      case 'known':
        return ICON_CHECK;
      default:
        return '';
    }
  };

  return (
    <button
      class={`status-pill pill pill-btn ${getVariantClass()} ${props.active ? 'active' : ''}`}
      onClick={props.onClick}
      type="button"
    >
      <Show when={props.showIcon !== false}>
        <span class="icon">
          <img src={getIcon()} alt="" />
        </span>
      </Show>
      <span>{getLabel()}</span>
    </button>
  );
};

export default StatusPill;
