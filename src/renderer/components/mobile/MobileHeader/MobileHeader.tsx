/**
 * Mobile Header
 * Floating translucent header for the mobile app.
 * Shows a title derived from the current route and a back button for sub-routes.
 */

import { Component, Show } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { useLocalization } from '../../../context';
import './MobileHeader.css';

const backArrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;

/** Routes that are top-level tabs (no back button) */
const tabRoots = new Set(['/', '/video', '/reader', '/flashcards', '/settings']);

/** Map route paths to localization keys */
const routeTitleKeys: Record<string, string> = {
  '/': 'mlearn.Tabs.Home',
  '/video': 'mlearn.Tabs.Video',
  '/reader': 'mlearn.Tabs.Reader',
  '/flashcards': 'mlearn.Tabs.Flashcards',
  '/settings': 'mlearn.Tabs.Settings',
  '/conversation-agent': 'mlearn.ConversationAgent.Title',
  '/word-db-editor': 'mlearn.WordDbEditor.Title',
  '/level-study': 'mlearn.LevelStudy.Title',
  '/licenses': 'mlearn.Settings.About.Licenses',
};

export const MobileHeader: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLocalization();

  const isSubRoute = () => !tabRoots.has(location.pathname);
  const title = () => {
    const key = routeTitleKeys[location.pathname];
    return key ? t(key) : '';
  };

  return (
    <header class="mobile-header">
      <Show when={isSubRoute()}>
        <button class="mobile-header-back" onClick={() => navigate(-1)} aria-label="Back">
          <span innerHTML={backArrow} />
        </button>
      </Show>
      <Show when={title()}>
        <h1 class="mobile-header-title">{title()}</h1>
      </Show>
    </header>
  );
};
