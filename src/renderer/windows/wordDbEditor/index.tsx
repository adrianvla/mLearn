/**
 * Word DB Editor Entry Point
 */

import { render } from 'solid-js/web';
import { WordDbEditorApp } from './App';
import '../../styles/index.css';
import '../../styles/glass.css';

render(() => <WordDbEditorApp />, document.getElementById('root')!);
