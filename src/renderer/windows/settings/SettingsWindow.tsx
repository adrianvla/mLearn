/**
 * Settings Window
 * Standalone settings window with left sidebar navigation
 */

import { Component, createSignal, createMemo, onCleanup, onMount, Show } from 'solid-js';
import { WindowWrapper, useLocalization } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { TabContainer } from '../../components/common/Tabs/TabContainer';
import type { TabItem } from '../../components/common/Tabs/TabContainer';
import {
  GeneralTab,
  BehaviourTab,
  CustomizationTab,
  SRSTab,
  ReaderTab,
  AITab,
  ConnectionTab,
  AboutTab
} from './tabs';
import Icon from '../../components/common/Icons/Icon';
import './SettingsLayout.css';

type TabId = 'general' | 'behaviour' | 'customization' | 'srs' | 'reader' | 'ai' | 'connection' | 'about';

interface SettingsTab {
  id: TabId;
  labelKey: string;
  icon: string;
}

const TABS: SettingsTab[] = [
  { id: 'general', labelKey: 'mlearn.Settings.Tabs.General', icon: 'cog' },
  { id: 'behaviour', labelKey: 'mlearn.Settings.Tabs.Behaviour', icon: 'target' },
  { id: 'customization', labelKey: 'mlearn.Settings.Tabs.Appearance', icon: 'palette' },
  { id: 'srs', labelKey: 'mlearn.Settings.Tabs.SRS', icon: 'cards' },
  { id: 'reader', labelKey: 'mlearn.Settings.Tabs.Reader', icon: 'book' },
  { id: 'ai', labelKey: 'mlearn.Settings.Tabs.AI', icon: 'bot' },
  { id: 'connection', labelKey: 'mlearn.Settings.Tabs.Connection', icon: 'link' },
  { id: 'about', labelKey: 'mlearn.Settings.Tabs.About', icon: 'star' },
];

export const SettingsContent: Component = () => {
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
    if (normalized.includes('ai') || normalized.includes('llm')) return 'ai';
    if (normalized.includes('connect') || normalized.includes('tether') || normalized.includes('cloud') || normalized.includes('backend')) return 'connection';
    if (normalized.includes('reader')) return 'reader';
    if (normalized.includes('srs') || normalized.includes('flashcard')) return 'srs';
    if (normalized.includes('custom') || normalized.includes('appearance')) return 'customization';
    if (normalized.includes('behav') || normalized.includes('behavior')) return 'behaviour';
    return 'general';
  };

  onMount(() => {
    const bridge = getBridge();

    const handler = (...args: unknown[]) => {
      const section = typeof args[0] === 'string' ? args[0] : undefined;
      setActiveTab(resolveTab(section));
    };

    const cleanup = bridge.window.onOpenSettings(handler);

    onCleanup(() => {
      cleanup();
    });
  });

  return (
    <div class="settings-window">

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
          <Show when={activeTab() === 'ai'}>
            <AITab />
          </Show>
          <Show when={activeTab() === 'connection'}>
            <ConnectionTab />
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
