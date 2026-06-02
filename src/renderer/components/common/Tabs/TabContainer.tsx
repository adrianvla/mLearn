/**
 * Tab Container Component
 * Reusable tab navigation with consistent styling
 */

import { Component, JSX, For, Show, splitProps, mergeProps } from 'solid-js';
import { Badge } from '../Label';
import './TabContainer.css';

export interface TabItem {
  id: string;
  label: string;
  icon?: string | JSX.Element;
  badge?: number | string;
  disabled?: boolean;
}

export interface TabContainerProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /** Tab orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Tab style variant */
  variant?: 'pills' | 'underline' | 'segment';
  /** Size of tabs */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class name */
  class?: string;
  /** Custom styles */
  style?: JSX.CSSProperties;
  sidebarTop?: JSX.Element;
  /** Render content for each tab */
  children?: JSX.Element;
}

export const TabContainer: Component<TabContainerProps> = (props) => {
  const merged = mergeProps({
    orientation: 'horizontal' as const,
    variant: 'pills' as const,
    size: 'md' as const,
  }, props);
  
  const [local, rest] = splitProps(merged, [
    'tabs',
    'activeTab',
    'onTabChange',
    'orientation',
    'variant',
    'size',
    'class',
    'style',
    'sidebarTop',
    'children',
  ]);
  
  return (
    <div
      class={`tab-container ${local.orientation} ${local.variant} ${local.size} ${local.class || ''}`}
      style={local.style}
      {...rest}
    >
      <div class="tab-list" role="tablist" aria-orientation={local.orientation}>
        <Show when={local.sidebarTop}>
          <div class="tab-list-header">{local.sidebarTop}</div>
        </Show>
        <For each={local.tabs}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              class={`tab-item ${local.activeTab === tab.id ? 'active' : ''} ${tab.badge !== undefined ? 'tab-item--with-badge' : ''}`}
              aria-selected={local.activeTab === tab.id}
              disabled={tab.disabled}
              onClick={() => !tab.disabled && local.onTabChange(tab.id)}
            >
              <Show when={tab.icon}>
                <span class="tab-icon">
                  {typeof tab.icon === 'string' ? tab.icon : tab.icon}
                </span>
              </Show>
              <span class="tab-label">{tab.label}</span>
              <Show when={tab.badge !== undefined}>
                <span class="tab-badge-slot">
                  <Badge class="tab-badge">{tab.badge}</Badge>
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <Show when={local.children}>
        <div class="tab-content">
          {local.children}
        </div>
      </Show>
    </div>
  );
};

/**
 * Tab Panel Component
 * Used for conditional rendering of tab content
 */
export interface TabPanelProps {
  tabId: string;
  activeTab: string;
  children?: JSX.Element;
  class?: string;
  /** Keep mounted when inactive (useful for forms) */
  keepMounted?: boolean;
}

export const TabPanel: Component<TabPanelProps> = (props) => {
  const isActive = () => props.tabId === props.activeTab;
  
  if (props.keepMounted) {
    return (
      <div
        class={`tab-panel ${isActive() ? 'active' : ''} ${props.class || ''}`}
        role="tabpanel"
        hidden={!isActive()}
      >
        {props.children}
      </div>
    );
  }
  
  return (
    <Show when={isActive()}>
      <div class={`tab-panel active ${props.class || ''}`} role="tabpanel">
        {props.children}
      </div>
    </Show>
  );
};

export default TabContainer;
