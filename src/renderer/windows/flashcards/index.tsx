/**
 * Flashcards Window Entry Point
 */

import { render } from 'solid-js/web';
import { FlashcardsApp } from './App';

// Import global styles
import '../../styles/index.css';
import '../../styles/base.css';
import '../../styles/subtitle.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <FlashcardsApp />, root);
