/**
 * Settings Window
 * Standalone settings window with left sidebar navigation
 */

import { Component, createSignal, createMemo, onCleanup, onMount, Show } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { IPC_CHANNELS } from '../../../shared/constants';
import { TabContainer } from '../../components/common/Tabs/TabContainer';
import type { TabItem } from '../../components/common/Tabs/TabContainer';
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

interface SettingsTab {
  id: TabId;
  labelKey: string;
  icon: string;
}

const TABS: SettingsTab[] = [
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

  const tabItems = createMemo((): TabItem[] =>
    TABS.map((tab) => ({
      id: tab.id,
      label: t(tab.labelKey),
      icon: <Icon icon={tab.icon} color="currentColor" class="settings-tab-icon" />,
    }))
  );

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
    <div class="settings-window">
      {/* Drag region for window */}
      <div class="settings-drag-region" />

      <TabContainer
        tabs={tabItems()}
        activeTab={activeTab()}
        onTabChange={(id) => setActiveTab(id as TabId)}
        orientation="vertical"
        variant="pills"
        class="settings-tab-container"
      >
        <div class="settings-content">
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
        </div>
      </TabContainer>
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
