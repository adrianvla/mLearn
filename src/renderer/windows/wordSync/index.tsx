/**
 * Word Sync Window Entry Point
 */

import { render } from 'solid-js/web';
import { WordSyncApp } from './App';
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');
if (root) {
  render(() => <WordSyncApp />, root);
}
