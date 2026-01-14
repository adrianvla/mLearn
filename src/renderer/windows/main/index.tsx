/**
 * Main Window Entry Point
 */

import { render } from 'solid-js/web';
import { MainApp } from './App';

// Import global styles
import '../../styles/index.css';
import '../../styles/glass.css';
import '../../styles/subtitle.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <MainApp />, root);
