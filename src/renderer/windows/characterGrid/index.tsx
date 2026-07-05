/**
 * Character Grid Entry Point
 */

import { render } from 'solid-js/web';
import { CharacterGridApp } from './App';
import '../../styles/index.css';
import '../../styles/base.css';

render(() => <CharacterGridApp />, document.getElementById('root')!);
