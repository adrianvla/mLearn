/**
 * Welcome Window Entry Point
 */

import { render } from 'solid-js/web';
import { WelcomeApp } from './App';

// Import global styles
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <WelcomeApp />, root);
