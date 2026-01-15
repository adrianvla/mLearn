/**
 * Setting Row Component
 */

import { JSX, ParentComponent } from 'solid-js';

interface SettingRowProps {
  label: string;
  description?: string;
  children: JSX.Element;
}

export const SettingRow: ParentComponent<SettingRowProps> = (props) => {
  return (
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{props.label}</span>
        {props.description && (
          <span class="setting-description">{props.description}</span>
        )}
      </div>
      <div class="setting-control">
        {props.children}
      </div>
    </div>
  );
};
