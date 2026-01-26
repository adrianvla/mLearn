/**
 * Setting Group Component
 * A container for grouping related settings with an optional title
 * Used to organize settings into logical sections
 */

import { ParentComponent, Show } from 'solid-js';
import './SettingGroup.css';

export interface SettingGroupProps {
  /** Group title displayed as header */
  title?: string;
  /** Optional description below the title */
  description?: string;
  /** Whether the group is collapsible */
  collapsible?: boolean;
  /** Default collapsed state */
  defaultCollapsed?: boolean;
  /** Additional CSS class */
  class?: string;
}

export const SettingGroup: ParentComponent<SettingGroupProps> = (props) => {
  return (
    <div class={`setting-group ${props.class || ''}`}>
      <Show when={props.title}>
        <div class="setting-group-header">
          <h3 class="setting-group-title">{props.title}</h3>
          <Show when={props.description}>
            <p class="setting-group-description">{props.description}</p>
          </Show>
        </div>
      </Show>
      <div class="setting-group-content">
        {props.children}
      </div>
    </div>
  );
};

export default SettingGroup;
