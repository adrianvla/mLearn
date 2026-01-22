/**
 * Setting Row Component
 * A consistent row layout for settings with label, description, and control
 * Used extensively across all settings tabs
 */

import { ParentComponent, Show, JSX } from 'solid-js';
import './SettingRow.css';

export interface SettingRowProps {
  /** Label text for the setting */
  label: string;
  /** Optional description text below the label */
  description?: string;
  /** Whether the setting is disabled */
  disabled?: boolean;
  /** Whether this setting requires restart */
  requiresRestart?: boolean;
  /** Icon to show next to label */
  icon?: string;
  /** Additional CSS class */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
}

export const SettingRow: ParentComponent<SettingRowProps> = (props) => {
  return (
    <div 
      class={`setting-row ${props.disabled ? 'disabled' : ''} ${props.class || ''}`}
      style={props.style}
    >
      <div class="setting-info">
        <span class="setting-label">
          <Show when={props.icon}>
            <span class="setting-icon">{props.icon}</span>
          </Show>
          {props.label}
          <Show when={props.requiresRestart}>
            <span class="restart-indicator" title="Requires restart">⟳</span>
          </Show>
        </span>
        <Show when={props.description}>
          <span class="setting-description">{props.description}</span>
        </Show>
      </div>
      <div class="setting-control">
        {props.children}
      </div>
    </div>
  );
};

export default SettingRow;
