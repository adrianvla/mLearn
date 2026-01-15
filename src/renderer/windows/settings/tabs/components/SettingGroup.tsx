/**
 * Setting Group Component
 */

import { ParentComponent } from 'solid-js';

interface SettingGroupProps {
  title?: string;
}

export const SettingGroup: ParentComponent<SettingGroupProps> = (props) => {
  return (
    <div class="setting-group">
      {props.title && <h3>{props.title}</h3>}
      {props.children}
    </div>
  );
};
