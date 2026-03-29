import { render } from 'solid-js/web';
import { PluginHostWindow } from './PluginHostWindow';
import '../../styles/index.css';
import '../../styles/base.css';

const root = document.getElementById('root');

if (root) {
  render(() => <PluginHostWindow />, root);
}
