/**
 * Bottom Tab Bar
 * Fixed-bottom navigation for the mobile app shell.
 * 5 tabs: Home, Video, Reader, Flashcards, Settings
 */

import { Component, For } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { useLocalization } from '../../../context';
import './BottomTabBar.css';

interface TabDef {
  path: string;
  labelKey: string;
  fallbackLabel: string;
  icon: string;
}

const tabs: TabDef[] = [
  { path: '/', labelKey: 'mlearn.Tabs.Home', fallbackLabel: 'Home', icon: 'home' },
  { path: '/video', labelKey: 'mlearn.Tabs.Video', fallbackLabel: 'Video', icon: 'video' },
  { path: '/reader', labelKey: 'mlearn.Tabs.Reader', fallbackLabel: 'Reader', icon: 'reader' },
  { path: '/flashcards', labelKey: 'mlearn.Tabs.Flashcards', fallbackLabel: 'Cards', icon: 'cards' },
  { path: '/settings', labelKey: 'mlearn.Tabs.Settings', fallbackLabel: 'Settings', icon: 'settings' },
];

// Inline SVG icons to avoid dependency on the Icon component's limited set
const tabIcons: Record<string, string> = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  reader: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  cards: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};

export const BottomTabBar: Component = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLocalization();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav class="bottom-tab-bar">
      <For each={tabs}>
        {(tab) => (
          <button
            class={`bottom-tab-item ${isActive(tab.path) ? 'active' : ''}`}
            onClick={() => navigate(tab.path)}
            aria-label={t(tab.labelKey) || tab.fallbackLabel}
          >
            <span class="bottom-tab-icon" innerHTML={tabIcons[tab.icon]} />
            <span class="bottom-tab-label">{t(tab.labelKey) || tab.fallbackLabel}</span>
          </button>
        )}
      </For>
    </nav>
  );
};
