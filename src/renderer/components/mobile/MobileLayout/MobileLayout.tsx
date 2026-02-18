/**
 * Mobile Layout
 * Wraps page content with floating translucent header and bottom tab bar.
 * Content scrolls behind both, with safe-area handling for notch / home indicator.
 */

import { ParentComponent } from 'solid-js';
import { MobileHeader } from '../MobileHeader/MobileHeader';
import { BottomTabBar } from '../BottomTabBar/BottomTabBar';
import './MobileLayout.css';

export const MobileLayout: ParentComponent = (props) => {
  return (
    <div class="mobile-layout">
      <MobileHeader />
      <main class="mobile-content">
        {props.children}
      </main>
      <BottomTabBar />
    </div>
  );
};
