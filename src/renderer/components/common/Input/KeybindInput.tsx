/**
 * Keybind Input Component
 * A specialized input that captures key presses instead of text input.
 * Used for setting keyboard shortcuts/hotkeys in settings.
 * Supports keyboard combinations like "Shift + C", "Ctrl + Alt + Delete"
 */

import { Component, createSignal, JSX } from 'solid-js';
import { useLocalization } from '../../../context';

export interface KeybindInputProps {
  /** Current keybind value (stored as "modifier+modifier+key" format, e.g., "shift+ctrl+c") */
  value: string;
  /** Callback when keybind changes */
  onChange: (key: string) => void;
  /** Placeholder text when not focused (optional) */
  placeholder?: string;
  /** CSS class name (optional) */
  class?: string;
  /** Inline styles (optional) */
  style?: JSX.CSSProperties;
  /** Whether to allow modifier-only keybinds (default: false) */
  allowModifierOnly?: boolean;
  /** Whether the input is disabled */
  disabled?: boolean;
}

/** Internal key names used for storage (lowercase, no localization) */
const MODIFIER_KEYS = ['ctrl', 'alt', 'shift', 'meta'] as const;

/**
 * Check if a key is a modifier key
 */
const isModifierKey = (key: string): boolean => {
  const modifiers = ['Control', 'Alt', 'Shift', 'Meta'];
  return modifiers.includes(key);
};

/**
 * Parse a stored keybind string into its components
 * e.g., "shift+ctrl+c" -> { modifiers: ['shift', 'ctrl'], key: 'c' }
 * Exported for use in other components (e.g., status bar display, hotkey matching)
 */
export const parseKeybind = (value: string): { modifiers: string[], key: string } => {
  const parts = value.toLowerCase().split('+').map(p => p.trim()).filter(Boolean);
  const modifiers: string[] = [];
  let key = '';
  
  for (const part of parts) {
    if (MODIFIER_KEYS.includes(part as typeof MODIFIER_KEYS[number])) {
      modifiers.push(part);
    } else {
      key = part;
    }
  }
  
  return { modifiers, key };
};

/**
 * Get localized display name for a key
 * Exported for use in other components
 */
export const getLocalizedKeyName = (key: string, t: (key: string) => string): string => {
  const keyLower = key.toLowerCase();
  
  // Map of internal key names to localization keys
  const keyMap: Record<string, string> = {
    'ctrl': 'mlearn.Settings.Keybind.Keys.Ctrl',
    'control': 'mlearn.Settings.Keybind.Keys.Ctrl',
    'alt': 'mlearn.Settings.Keybind.Keys.Alt',
    'shift': 'mlearn.Settings.Keybind.Keys.Shift',
    'meta': 'mlearn.Settings.Keybind.Keys.Meta',
    ' ': 'mlearn.Settings.Keybind.Keys.Space',
    'space': 'mlearn.Settings.Keybind.Keys.Space',
    'enter': 'mlearn.Settings.Keybind.Keys.Enter',
    'escape': 'mlearn.Settings.Keybind.Keys.Escape',
    'esc': 'mlearn.Settings.Keybind.Keys.Escape',
    'backspace': 'mlearn.Settings.Keybind.Keys.Backspace',
    'delete': 'mlearn.Settings.Keybind.Keys.Delete',
    'tab': 'mlearn.Settings.Keybind.Keys.Tab',
    'capslock': 'mlearn.Settings.Keybind.Keys.CapsLock',
    'arrowup': 'mlearn.Settings.Keybind.Keys.ArrowUp',
    'arrowdown': 'mlearn.Settings.Keybind.Keys.ArrowDown',
    'arrowleft': 'mlearn.Settings.Keybind.Keys.ArrowLeft',
    'arrowright': 'mlearn.Settings.Keybind.Keys.ArrowRight',
    'home': 'mlearn.Settings.Keybind.Keys.Home',
    'end': 'mlearn.Settings.Keybind.Keys.End',
    'pageup': 'mlearn.Settings.Keybind.Keys.PageUp',
    'pagedown': 'mlearn.Settings.Keybind.Keys.PageDown',
    'insert': 'mlearn.Settings.Keybind.Keys.Insert',
  };
  
  const locKey = keyMap[keyLower];
  if (locKey) {
    const localized = t(locKey);
    // If localization returns the key itself, it means no translation exists
    if (localized !== locKey) {
      return localized;
    }
  }
  
  // For single characters, uppercase them
  if (key.length === 1) {
    return key.toUpperCase();
  }
  
  // For F-keys and others, capitalize first letter
  return key.charAt(0).toUpperCase() + key.slice(1);
};

/**
 * Format a keybind for display with localized key names
 * e.g., "shift+ctrl+c" -> "Shift + Ctrl + C"
 * Exported for use in other components (e.g., status bar display)
 */
export const formatKeybindDisplay = (value: string, t: (key: string) => string): string => {
  const { modifiers, key } = parseKeybind(value);
  const parts: string[] = [];
  
  // Add modifiers in consistent order: Ctrl, Alt, Shift, Meta
  const modifierOrder = ['ctrl', 'alt', 'shift', 'meta'];
  for (const mod of modifierOrder) {
    if (modifiers.includes(mod)) {
      parts.push(getLocalizedKeyName(mod, t));
    }
  }
  
  // Add the main key
  if (key) {
    parts.push(getLocalizedKeyName(key, t));
  }
  
  return parts.join(' + ') || value;
};

export const KeybindInput: Component<KeybindInputProps> = (props) => {
  const { t } = useLocalization();
  const [isFocused, setIsFocused] = createSignal(false);
  
  const handleKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Build the keybind string from modifiers + key
    const parts: string[] = [];
    
    // Add modifiers in consistent order
    if (e.ctrlKey) parts.push('ctrl');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    if (e.metaKey) parts.push('meta');
    
    // Get the actual key (not the modifier)
    const key = e.key;
    
    // If only a modifier was pressed and we don't allow modifier-only binds, wait for more
    if (isModifierKey(key) && !props.allowModifierOnly) {
      return;
    }
    
    // Add the main key (lowercase for storage)
    if (!isModifierKey(key)) {
      parts.push(key.toLowerCase());
    }
    
    // Create the keybind string
    const keybind = parts.join('+');
    
    // Notify parent of change
    props.onChange(keybind);
    
    // Blur after capturing
    (e.target as HTMLInputElement).blur();
  };
  
  const handleFocus = () => {
    setIsFocused(true);
  };
  
  const handleBlur = () => {
    setIsFocused(false);
  };
  
  // Prevent paste, cut, etc.
  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
  };
  
  const displayValue = () => {
    if (isFocused()) {
      return props.placeholder ?? t('mlearn.Settings.Keybind.PressKey');
    }
    return formatKeybindDisplay(props.value, t);
  };
  
  return (
    <input
      type="text"
      class={`keybind-input ${props.class || ''}`}
      style={{
        'text-align': 'center',
        cursor: 'pointer',
        'user-select': 'none',
        ...props.style,
      }}
      value={displayValue()}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onPaste={handlePaste}
      onCut={(e) => e.preventDefault()}
      onCopy={(e) => e.preventDefault()}
      readOnly
      disabled={props.disabled}
      title={t('mlearn.Settings.Keybind.Tooltip')}
    />
  );
};

export default KeybindInput;
