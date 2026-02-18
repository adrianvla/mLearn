/**
 * Mobile Layout
 * Wraps page content with safe-area handling and bottom tab bar.
 * Handles viewport insets for notch / dynamic island / home indicator.
 */

import { ParentComponent } from 'solid-js';
import { BottomTabBar } from '../BottomTabBar/BottomTabBar';
import './MobileLayout.css';

export const MobileLayout: ParentComponent = (props) => {
  return (
    <div class="mobile-layout">
      <main class="mobile-content">
        {props.children}
      </main>
      <BottomTabBar />
    </div>
  );
};
