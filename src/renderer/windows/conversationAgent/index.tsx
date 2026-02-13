/**
 * Conversation Agent Window Entry Point
 */

import { render } from 'solid-js/web';
import { ConversationAgentApp } from './App';

import '../../styles/index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <ConversationAgentApp />, root);
