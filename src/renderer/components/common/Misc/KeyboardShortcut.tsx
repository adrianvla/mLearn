/**
 * Keyboard Shortcut Component
 * The canonical key-hint renderer (single kbd per key, joined by separators).
 * Keys-only usage renders a compact inline hint; `description` adds the row
 * layout used by shortcut lists and the About tab.
 */

import { Component, For, Show, JSX } from 'solid-js';
import './KeyboardShortcut.css';

export interface KeyboardShortcutProps {
  /** Description of what the shortcut does (omitted for compact key-only hints) */
  description?: string;
  /** Array of keys that make up the shortcut */
  keys: string[];
  /** Separator between keys (default: +) */
  separator?: string;
  /** Row layout: description left, keys right (list/About-tab style) */
  row?: boolean;
  /** Additional CSS class */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
}

export const KeyboardShortcut: Component<KeyboardShortcutProps> = (props) => {
  const separator = () => props.separator ?? '+';

  return (
    <span
      class={`keyboard-shortcut ${props.row ? 'keyboard-shortcut--row' : ''} ${props.class || ''}`}
      style={props.style}
    >
      <Show when={props.description}>
        <span class="shortcut-description">{props.description}</span>
      </Show>
      <span class="shortcut-keys">
        <For each={props.keys}>
          {(key, index) => (
            <>
              <kbd class="shortcut-key">{key}</kbd>
              <Show when={index() < props.keys.length - 1}>
                <span class="shortcut-separator">{separator()}</span>
              </Show>
            </>
          )}
        </For>
      </span>
    </span>
  );
};

export interface ShortcutsListProps {
  /** Title for the shortcuts section */
  title?: string;
  /** List of shortcuts */
  shortcuts: { description: string; keys: string[] }[];
  /** Additional CSS class */
  class?: string;
}

export const ShortcutsList: Component<ShortcutsListProps> = (props) => {
  return (
    <div class={`shortcuts-list ${props.class || ''}`}>
      <Show when={props.title}>
        <h4 class="shortcuts-title">{props.title}</h4>
      </Show>
      <div class="shortcuts-items">
        <For each={props.shortcuts}>
          {(shortcut) => (
            <KeyboardShortcut row description={shortcut.description} keys={shortcut.keys} />
          )}
        </For>
      </div>
    </div>
  );
};

export default KeyboardShortcut;
