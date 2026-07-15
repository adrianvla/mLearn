import { Component, JSX, Show, splitProps } from 'solid-js';
import { IconBtn } from '../Button';
import './ResponsiveSidebar.css';

export interface ResponsiveSidebarProps {
  /** Stable DOM id for the sidebar and its trigger relationship. */
  id: string;
  /** Accessible name for the navigation control and dismissal backdrop. */
  label: string;
  /** Compact mobile-bar title, normally the current section. */
  title: JSX.Element;
  /** Whether the drawer is open on narrow layouts. Desktop sidebars remain visible. */
  open: boolean;
  /** Called when the trigger or backdrop changes the drawer state. */
  onOpenChange: (open: boolean) => void;
  /** Physical desktop side and mobile drawer origin. */
  side?: 'left' | 'right';
  /** Additional sidebar class names. */
  class?: string;
  children?: JSX.Element;
}

/**
 * Keeps a desktop sidebar in the layout while presenting it as an accessible
 * off-canvas drawer on compact widths. The parent owns its open state so
 * navigation actions can close the drawer after selection.
 */
export const ResponsiveSidebar: Component<ResponsiveSidebarProps> = (props) => {
  const [local] = splitProps(props, [
    'id',
    'label',
    'title',
    'open',
    'onOpenChange',
    'side',
    'class',
    'children',
  ]);
  const side = () => local.side ?? 'left';

  return (
    <>
      <div class="responsive-sidebar__mobile-bar">
        <IconBtn
          size="sm"
          variant="secondary"
          icon="sidebar"
          active={local.open}
          aria-label={local.label}
          aria-controls={local.id}
          aria-expanded={local.open}
          onClick={() => local.onOpenChange(!local.open)}
        />
        <span class="responsive-sidebar__mobile-title">{local.title}</span>
      </div>
      <Show when={local.open}>
        <button
          type="button"
          class="responsive-sidebar__backdrop"
          aria-label={local.label}
          onClick={() => local.onOpenChange(false)}
        />
      </Show>
      <aside
        id={local.id}
        class={`responsive-sidebar responsive-sidebar--${side()} ${local.class || ''}`}
        classList={{ 'responsive-sidebar--open': local.open }}
      >
        {local.children}
      </aside>
    </>
  );
};

export default ResponsiveSidebar;
