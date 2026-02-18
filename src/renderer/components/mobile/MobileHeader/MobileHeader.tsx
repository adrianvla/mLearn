/**
 * Mobile Header
 * Replaces Electron's custom title bar on mobile.
 * Shows a title and optional back button for sub-routes.
 */

import { Component, Show } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import './MobileHeader.css';

const backArrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;

/** Routes that are top-level tabs (no back button) */
const tabRoots = new Set(['/', '/video', '/reader', '/flashcards', '/settings']);

export const MobileHeader: Component<{ title?: string }> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isSubRoute = () => !tabRoots.has(location.pathname);

  return (
    <header class="mobile-header">
      <Show when={isSubRoute()}>
        <button class="mobile-header-back" onClick={() => navigate(-1)} aria-label="Back">
          <span innerHTML={backArrow} />
        </button>
      </Show>
      <Show when={props.title}>
        <h1 class="mobile-header-title">{props.title}</h1>
      </Show>
    </header>
  );
};
