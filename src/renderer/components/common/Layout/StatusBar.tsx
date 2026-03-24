/**
 * StatusBar Component
 * Unified bottom status bar used across windows (Reader, Conversation Agent, etc.)
 * Based on ReaderStatusBar visual style.
 */

import { Component, JSX } from 'solid-js';
import './StatusBar.css';

export interface StatusBarProps {
  class?: string;
  children: JSX.Element;
}

export const StatusBar: Component<StatusBarProps> = (props) => {
  return (
    <footer class={`statusbar panel ${props.class || ''}`}>
      {props.children}
    </footer>
  );
};
