/**
 * Diagnostics Window Entry Point
 */

import { render } from 'solid-js/web';
import { DiagnosticsApp } from './App';
import { WindowWrapper } from '../../context';
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');
if (root) {
  render(() => (
    <WindowWrapper>
      <DiagnosticsApp />
    </WindowWrapper>
  ), root);
}
