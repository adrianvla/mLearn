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
import '../../styles/subtitle.css'; //TODO: this file is technical debt
import './overlay.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

const WrappedApp = () => (
  <WindowWrapper showDragRegion={false}>
    <App />
  </WindowWrapper>
);

render(() => <WrappedApp />, root);