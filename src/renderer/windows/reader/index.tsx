/**
 * Reader Window Entry Point
 */

import { render } from 'solid-js/web';
import { ReaderApp } from './App';
import '../../styles/index.css';
import './reader.css';

const root = document.getElementById('root');
if (root) {
  render(() => <ReaderApp />, root);
}
