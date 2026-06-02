/**
 * Setting Group Component
 * A container for grouping related settings with an optional title
 * Used to organize settings into logical sections
 */

import { ParentComponent, Show, createEffect, onCleanup } from 'solid-js';
import { useSettingsSearch, useSettingsTab } from '../../../context';
import './SettingGroup.css';

export interface SettingGroupProps {
  title?: string;
  description?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  class?: string;
}

let groupCounter = 0;

export const SettingGroup: ParentComponent<SettingGroupProps> = (props) => {
  const searchCtx = useSettingsSearch();
  const tabCtx = useSettingsTab();
  const groupId = `sg-${++groupCounter}`;
  const query = () => searchCtx?.searchQuery()?.toLowerCase().trim() ?? '';
  const titleMatches = () => {
    const q = query();
    if (!q || !props.title) return false;
    return props.title.toLowerCase().includes(q);
  };

  createEffect(() => {
    const tabId = tabCtx?.tabId;
    if (tabId && searchCtx) {
      searchCtx.registerMatch(tabId, groupId, titleMatches());
      onCleanup(() => searchCtx.registerMatch(tabId, groupId, false));
    }
  });

  return (
    <div class={`setting-group ${props.class || ''}`} data-title-matches={titleMatches() || undefined}>
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
