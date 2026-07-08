import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');

if (root === null) {
  throw new Error('Missing #root element');
}

document.documentElement.classList.add('dark', 'theme');

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
