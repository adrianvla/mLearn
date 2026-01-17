/**
 * Settings Window
 * Standalone settings window with tabbed navigation
 */

import { Component, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { WindowWrapper } from '../../context';
import { IPC_CHANNELS } from '../../../shared/constants';
import {
  GeneralTab,
  BehaviourTab,
  CustomizationTab,
  SRSTab,
  ReaderTab,
  StatsTab,
  AboutTab
} from './tabs';
import './settings.css';

type TabId = 'general' | 'behaviour' | 'customization' | 'srs' | 'reader' | 'stats' | 'about';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { id: 'general', label: 'General', icon: '⚙️' },
  { id: 'behaviour', label: 'Behaviour', icon: '🧠' },
  { id: 'customization', label: 'Customization', icon: '🎨' },
  { id: 'srs', label: 'SRS', icon: '📚' },
  { id: 'reader', label: 'Reader', icon: '📖' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'about', label: 'About', icon: 'ℹ️' },
];

const SettingsContent: Component = () => {
  const [activeTab, setActiveTab] = createSignal<TabId>('general');

  const resolveTab = (section?: string): TabId => {
    if (!section) return 'general';

    const normalized = section.toLowerCase();
    if (normalized.includes('about') || normalized.includes('license')) return 'about';
    if (normalized.includes('stat')) return 'stats';
    if (normalized.includes('reader')) return 'reader';
    if (normalized.includes('srs') || normalized.includes('flashcard')) return 'srs';
    if (normalized.includes('custom') || normalized.includes('appearance')) return 'customization';
    if (normalized.includes('behav') || normalized.includes('behavior')) return 'behaviour';
    return 'general';
  };

  onMount(() => {
    if (!window.mLearnIPC) return;

    const handler = (section?: string) => {
      setActiveTab(resolveTab(section));
    };

    window.mLearnIPC.onOpenSettings(handler);

    onCleanup(() => {
      window.mLearnIPC?.removeListener?.(IPC_CHANNELS.SHOW_SETTINGS, handler);
    });
  });

  return (
    <div class="settings-window">
      {/* Sidebar */}
      <nav class="settings-sidebar">
        <h1 class="settings-title">Settings</h1>
        <ul class="settings-nav">
          {TABS.map((tab) => (
            <li>
              <button
                class={`nav-item ${activeTab() === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span class="nav-icon">{tab.icon}</span>
                <span class="nav-label">{tab.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Content */}
      <main class="settings-content">
        <Show when={activeTab() === 'general'}>
          <GeneralTab />
        </Show>
        <Show when={activeTab() === 'behaviour'}>
          <BehaviourTab />
        </Show>
        <Show when={activeTab() === 'customization'}>
          <CustomizationTab />
        </Show>
        <Show when={activeTab() === 'srs'}>
          <SRSTab />
        </Show>
        <Show when={activeTab() === 'reader'}>
          <ReaderTab />
        </Show>
        <Show when={activeTab() === 'stats'}>
          <StatsTab />
        </Show>
        <Show when={activeTab() === 'about'}>
          <AboutTab />
        </Show>
      </main>
    </div>
  );
};

export const SettingsWindow: Component = () => {
  return (
    <WindowWrapper>
      <SettingsContent />
    </WindowWrapper>
  );
};

export default SettingsWindow;
