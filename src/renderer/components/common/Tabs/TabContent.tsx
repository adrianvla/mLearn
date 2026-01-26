/**
 * Tab Content Component
 * Wrapper for tab content with consistent styling
 */

import { JSX, ParentComponent, Show } from 'solid-js';
import { TabHeader, TabHeaderProps } from './TabHeader';
import './TabContent.css';

export interface TabContentProps {
  header?: TabHeaderProps;
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  style?: JSX.CSSProperties;
  class?: string;
}

export const TabContent: ParentComponent<TabContentProps> = (props) => {
  const paddingClass = () => {
    switch (props.padding) {
      case 'none': return 'tab-content-padding-none';
      case 'sm': return 'tab-content-padding-sm';
      case 'lg': return 'tab-content-padding-lg';
      case 'xl': return 'tab-content-padding-xl';
      default: return 'tab-content-padding-md';
    }
  };

  return (
    <div class={`tab-content ${paddingClass()} ${props.class ?? ''}`} style={props.style}>
      <Show when={props.header}>
        <TabHeader {...props.header!} />
      </Show>
      {props.children}
    </div>
  );
};
