/**
 * Overlay Window Entry Point
 * Transparent, always-on-top window for displaying subtitles over external video
 */

import { render } from 'solid-js/web';
import { App } from './App';
import { WindowWrapper } from '../../context';

// Import global styles
import '../../styles/index.css';
import '../../styles/base.css';
import './overlay.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

// Vite shares CSS across window entries. Scope the overlay's transparent root
// to this document so other windows retain their theme background.
document.documentElement.classList.add('overlay-window-root');

const WrappedApp = () => (
  <WindowWrapper showDragRegion={false} transparent>
    <App />
  </WindowWrapper>
);

render(() => <WrappedApp />, root);
