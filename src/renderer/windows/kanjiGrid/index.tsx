/**
 * Kanji Grid Entry Point
 */

import { render } from 'solid-js/web';
import { KanjiGridApp } from './App';
import '../../styles/index.css';

render(() => <KanjiGridApp />, document.getElementById('root')!);
