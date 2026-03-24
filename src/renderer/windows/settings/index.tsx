/**
 * Settings Window Entry Point
 */

import { render } from 'solid-js/web';
import { SettingsWindow } from './SettingsWindow';
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');
if (root) {
  render(() => <SettingsWindow />, root);
}
