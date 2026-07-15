/**
 * Tab Container Component
 * Reusable tab navigation with consistent styling
 */

import { Component, JSX, For, Show, splitProps, mergeProps, createSignal } from 'solid-js';
import { Badge } from '../Label';
import { IconBtn } from '../Button';
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
  /** Render the vertical tab rail as an off-canvas drawer on compact widths. */
  responsiveSidebar?: boolean;
  /** Stable DOM id for the mobile drawer relationship. */
  responsiveSidebarId?: string;
  /** Accessible name for the mobile navigation control and dismissal backdrop. */
  responsiveSidebarLabel?: string;
  /** Compact mobile-bar title, normally the active section. */
  responsiveSidebarTitle?: string;
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
    'responsiveSidebar',
    'responsiveSidebarId',
    'responsiveSidebarLabel',
    'responsiveSidebarTitle',
    'children',
  ]);
  const [isResponsiveSidebarOpen, setIsResponsiveSidebarOpen] = createSignal(false);
  const responsiveSidebarId = () => local.responsiveSidebarId || undefined;
  const responsiveSidebarLabel = () => local.responsiveSidebarLabel || local.responsiveSidebarTitle || '';

  const handleTabChange = (tabId: string) => {
    local.onTabChange(tabId);
    setIsResponsiveSidebarOpen(false);
  };
  
  return (
    <div
      class={`tab-container ${local.orientation} ${local.variant} ${local.size} ${local.responsiveSidebar ? 'tab-container--responsive-sidebar' : ''} ${local.class || ''}`}
      style={local.style}
      {...rest}
    >
      <Show when={local.responsiveSidebar}>
        <div class="tab-container__mobile-sidebar-bar">
          <IconBtn
            size="sm"
            variant="secondary"
            icon="sidebar"
            active={isResponsiveSidebarOpen()}
            aria-label={responsiveSidebarLabel()}
            aria-controls={responsiveSidebarId()}
            aria-expanded={isResponsiveSidebarOpen()}
            onClick={() => setIsResponsiveSidebarOpen((open) => !open)}
          />
          <span class="tab-container__mobile-sidebar-title">{local.responsiveSidebarTitle}</span>
        </div>
      </Show>
      <Show when={local.responsiveSidebar && isResponsiveSidebarOpen()}>
        <button
          type="button"
          class="tab-container__responsive-sidebar-backdrop"
          aria-label={responsiveSidebarLabel()}
          onClick={() => setIsResponsiveSidebarOpen(false)}
        />
      </Show>
      <div
        id={responsiveSidebarId()}
        class={`tab-list ${local.responsiveSidebar && isResponsiveSidebarOpen() ? 'tab-list--responsive-sidebar-open' : ''}`}
        role="tablist"
        aria-orientation={local.orientation}
      >
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
              onClick={() => !tab.disabled && handleTabChange(tab.id)}
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
