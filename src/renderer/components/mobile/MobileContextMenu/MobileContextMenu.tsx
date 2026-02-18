/**
 * Mobile Context Menu
 * A bottom sheet menu that replaces native Electron context menus on mobile.
 * Triggered by long-press; slides up from bottom with action items.
 */

import { Component, For, Show, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import './MobileContextMenu.css';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  destructive?: boolean;
}

interface MobileContextMenuProps {
  items: ContextMenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
  open: boolean;
}

export const MobileContextMenu: Component<MobileContextMenuProps> = (props) => {
  let sheetRef: HTMLDivElement | undefined;

  const handleBackdropClick = () => {
    props.onClose();
  };

  const handleItemClick = (id: string) => {
    props.onClose();
    props.onSelect(id);
  };

  // Close on Escape key
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };

  // Attach/detach keyboard listener
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div class="mobile-ctx-backdrop" onClick={handleBackdropClick}>
          <div
            ref={sheetRef}
            class="mobile-ctx-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="mobile-ctx-handle" />
            <div class="mobile-ctx-items">
              <For each={props.items}>
                {(item) => (
                  <button
                    class={`mobile-ctx-item ${item.destructive ? 'destructive' : ''}`}
                    disabled={item.disabled}
                    onClick={() => handleItemClick(item.id)}
                  >
                    <Show when={item.icon}>
                      <span class="mobile-ctx-icon">{item.icon}</span>
                    </Show>
                    <span class="mobile-ctx-label">{item.label}</span>
                  </button>
                )}
              </For>
            </div>
            <button class="mobile-ctx-cancel" onClick={handleBackdropClick}>
              Cancel
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

// ============================================================================
// Long-press hook helper
// ============================================================================

const LONG_PRESS_MS = 500;

/**
 * Creates long-press handlers for triggering the mobile context menu.
 * Returns event handlers to spread onto the target element.
 */
export function createLongPressHandlers(onLongPress: (e: TouchEvent | MouseEvent) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let didLongPress = false;

  const start = (e: TouchEvent | MouseEvent) => {
    didLongPress = false;
    timer = setTimeout(() => {
      didLongPress = true;
      onLongPress(e);
    }, LONG_PRESS_MS);
  };

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const preventIfLongPress = (e: Event) => {
    if (didLongPress) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return {
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onMouseDown: start,
    onMouseUp: cancel,
    onClick: preventIfLongPress,
  };
}
