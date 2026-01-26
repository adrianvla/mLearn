/**
 * Keyboard Shortcut Component
 * Displays a keyboard shortcut with its description
 */

import { Component, For, Show, JSX } from 'solid-js';
import './KeyboardShortcut.css';

export interface KeyboardShortcutProps {
  /** Description of what the shortcut does */
  description: string;
  /** Array of keys that make up the shortcut */
  keys: string[];
  /** Separator between keys (default: +) */
  separator?: string;
  /** Additional CSS class */
  class?: string;
  /** Custom style */
  style?: JSX.CSSProperties;
}

export const KeyboardShortcut: Component<KeyboardShortcutProps> = (props) => {
  const separator = () => props.separator ?? '+';
  
  return (
    <div class={`keyboard-shortcut ${props.class || ''}`} style={props.style}>
      <span class="shortcut-description">{props.description}</span>
      <div class="shortcut-keys">
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
      </div>
    </div>
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
            <KeyboardShortcut description={shortcut.description} keys={shortcut.keys} />
          )}
        </For>
      </div>
    </div>
  );
};

export default KeyboardShortcut;
