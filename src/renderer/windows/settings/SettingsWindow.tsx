/**
 * Settings Window
 * Standalone settings window with top tabbed navigation
 */

import { Component, createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { IPC_CHANNELS } from '../../../shared/constants';
import {
  GeneralTab,
  BehaviourTab,
  CustomizationTab,
  SRSTab,
  ReaderTab,
  StatsTab,
  AITab,
  AboutTab
} from './tabs';
import Icon from '../../components/common/Icons/Icon';
import './settings.css';

type TabId = 'general' | 'behaviour' | 'customization' | 'srs' | 'reader' | 'stats' | 'ai' | 'about';

interface Tab {
  id: TabId;
  labelKey: string;
  icon: string; // SVG icon path
}

// Icon paths for each tab (using existing icons)
const TABS: Tab[] = [
  { id: 'general', labelKey: 'mlearn.Settings.Tabs.General', icon: 'cog' },
  { id: 'behaviour', labelKey: 'mlearn.Settings.Tabs.Behaviour', icon: 'bot' },
  { id: 'customization', labelKey: 'mlearn.Settings.Tabs.Appearance', icon: 'palette' },
  { id: 'srs', labelKey: 'mlearn.Settings.Tabs.SRS', icon: 'cards' },
  { id: 'reader', labelKey: 'mlearn.Settings.Tabs.Reader', icon: 'book' },
  { id: 'stats', labelKey: 'mlearn.Settings.Tabs.Statistics', icon: 'stats' },
  { id: 'ai', labelKey: 'mlearn.Settings.Tabs.AI', icon: 'stars' },
  { id: 'about', labelKey: 'mlearn.Settings.Tabs.About', icon: 'star' },
];

const SettingsContent: Component = () => {
  const [activeTab, setActiveTab] = createSignal<TabId>('general');
  const { t } = useLocalization();

  const resolveTab = (section?: string): TabId => {
    if (!section) return 'general';

    const normalized = section.toLowerCase();
    if (normalized.includes('about') || normalized.includes('license')) return 'about';
    if (normalized.includes('stat')) return 'stats';
    if (normalized.includes('ai') || normalized.includes('llm')) return 'ai';
    if (normalized.includes('reader')) return 'reader';
    if (normalized.includes('srs') || normalized.includes('flashcard')) return 'srs';
    if (normalized.includes('custom') || normalized.includes('appearance')) return 'customization';
    if (normalized.includes('behav') || normalized.includes('behavior')) return 'behaviour';
    return 'general';
  };

  onMount(() => {
    if (!window.mLearnIPC) return;

    const handler = (...args: unknown[]) => {
      const section = typeof args[0] === 'string' ? args[0] : undefined;
      setActiveTab(resolveTab(section));
    };

    window.mLearnIPC.onOpenSettings(handler);

    onCleanup(() => {
      window.mLearnIPC?.removeListener?.(IPC_CHANNELS.SHOW_SETTINGS, handler);
    });
  });

  return (
    <div class="settings-window top-nav-layout">
      {/* Top Navigation Bar */}
      <header class="settings-header">
        <h1 class="settings-title">{t('mlearn.Settings.UI.Title')}</h1>
        <nav class="settings-tabs">
          <For each={TABS}>
            {(tab) => (
              <button
                class={`settings-tab ${activeTab() === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                title={t(tab.labelKey)}
              >
                <Icon icon={tab.icon} color="currentColor" class="tab-icon" />
                <span class="tab-label">{t(tab.labelKey)}</span>
              </button>
            )}
          </For>
        </nav>
      </header>

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
        <Show when={activeTab() === 'ai'}>
          <AITab />
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
    <WindowWrapper showDragRegion={false}>
      <SettingsContent />
    </WindowWrapper>
  );
};

export default SettingsWindow;
