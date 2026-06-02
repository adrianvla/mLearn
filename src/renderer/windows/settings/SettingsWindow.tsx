import { Component, createSignal, createMemo, onCleanup, onMount } from 'solid-js';
import { WindowWrapper, useLocalization, SettingsSearchContext, SettingsTabContext } from '../../context';
import { getBridge } from '../../../shared/bridges';
import { TabContainer } from '../../components/common/Tabs/TabContainer';
import type { TabItem } from '../../components/common/Tabs/TabContainer';
import { Input, SearchIcon } from '../../components/common';
import {
  GeneralTab,
  BehaviourTab,
  CustomizationTab,
  SRSTab,
  ReaderTab,
  AITab,
  ConnectionTab,
  PluginsTab,
  AboutTab,
  VideoPlayerTab,
  BrowserExtensionTab,
  ComponentsTab,
} from './tabs';
import Icon from '../../components/common/Icons/Icon';
import './SettingsLayout.css';

type TabId = 'general' | 'behaviour' | 'customization' | 'srs' | 'reader' | 'video-player' | 'ai' | 'connection' | 'plugins' | 'components' | 'about' | 'browser-extension';

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
  { id: 'video-player', labelKey: 'mlearn.Settings.Tabs.VideoPlayer', icon: 'play' },
  { id: 'ai', labelKey: 'mlearn.Settings.Tabs.AI', icon: 'bot' },
  { id: 'connection', labelKey: 'mlearn.Settings.Tabs.Connection', icon: 'link' },
  { id: 'plugins', labelKey: 'mlearn.Settings.Tabs.Plugins', icon: 'cog' },
  { id: 'components', labelKey: 'mlearn.Settings.Tabs.Components', icon: 'cog' },
  { id: 'browser-extension', labelKey: 'mlearn.Settings.Tabs.BrowserExtension', icon: 'link' },
  { id: 'about', labelKey: 'mlearn.Settings.Tabs.About', icon: 'star' },
];

export const SettingsContent: Component = () => {
  const [activeTab, setActiveTab] = createSignal<TabId>('general');
  const [searchQuery, setSearchQuery] = createSignal('');
  const { t } = useLocalization();

  const matchRegistry = new Map<string, Set<string>>();
  const [matchCounts, setMatchCounts] = createSignal<Record<string, number>>({});

  const registerMatch = (tabId: string, rowId: string, matches: boolean) => {
    const set = matchRegistry.get(tabId) ?? new Set<string>();
    if (matches) {
      set.add(rowId);
    } else {
      set.delete(rowId);
    }
    matchRegistry.set(tabId, set);
    setMatchCounts((prev) => ({ ...prev, [tabId]: set.size }));
  };

  const searchValue = createMemo(() => searchQuery());

  const tabItems = createMemo((): TabItem[] =>
    TABS.map((tab) => {
      const count = matchCounts()[tab.id];
      const hasSearch = searchQuery().trim().length > 0;
      return {
        id: tab.id,
        label: t(tab.labelKey),
        icon: <Icon icon={tab.icon} color="currentColor" class="settings-tab-icon" />,
        badge: hasSearch && count > 0 ? count : undefined,
      };
    })
  );

  const sidebarSearch = (
    <Input
      type="search"
      placeholder={t('mlearn.Settings.SearchPlaceholder')}
      value={searchQuery()}
      onInput={(e) => setSearchQuery(e.currentTarget.value)}
      leftIcon={<SearchIcon size={16} />}
      size="sm"
    />
  );

  const resolveTab = (section?: string): TabId => {
    if (!section) return 'general';

    const normalized = section.toLowerCase();
    if (normalized.includes('about') || normalized.includes('license')) return 'about';
    if (normalized.includes('ai') || normalized.includes('llm')) return 'ai';
    if (normalized.includes('connect') || normalized.includes('tether') || normalized.includes('cloud') || normalized.includes('backend')) return 'connection';
    if (normalized.includes('plugin') || normalized.includes('permission')) return 'plugins';
    if (normalized.includes('component') || normalized.includes('module')) return 'components';
    if (normalized.includes('browser') || normalized.includes('extension')) return 'browser-extension';
    if (normalized.includes('reader')) return 'reader';
    if (normalized.includes('video') || normalized.includes('player') || normalized.includes('subtitle')) return 'video-player';
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

  const TabWrap = (props: { tabId: string; children: unknown }) => (
    <SettingsTabContext.Provider value={{ tabId: props.tabId }}>
      {props.children as Element}
    </SettingsTabContext.Provider>
  );

  const TabPanel = (props: { tabId: TabId; children: unknown }) => (
    <div
      class="settings-tab-panel"
      style={{ display: activeTab() === props.tabId ? 'block' : 'none' }}
      data-tab-id={props.tabId}
    >
      <TabWrap tabId={props.tabId}>{props.children as Element}</TabWrap>
    </div>
  );

  return (
    <div class="settings-window">
      <SettingsSearchContext.Provider value={{ searchQuery: searchValue, matchCounts, registerMatch }}>
        <TabContainer
          tabs={tabItems()}
          activeTab={activeTab()}
          onTabChange={(id) => setActiveTab(id as TabId)}
          orientation="vertical"
          variant="pills"
          class="settings-tab-container"
          sidebarTop={sidebarSearch}
        >
          <div class="settings-content">
            <TabPanel tabId="general"><GeneralTab /></TabPanel>
            <TabPanel tabId="behaviour"><BehaviourTab /></TabPanel>
            <TabPanel tabId="customization"><CustomizationTab /></TabPanel>
            <TabPanel tabId="srs"><SRSTab /></TabPanel>
            <TabPanel tabId="reader"><ReaderTab /></TabPanel>
            <TabPanel tabId="video-player"><VideoPlayerTab /></TabPanel>
            <TabPanel tabId="ai"><AITab /></TabPanel>
            <TabPanel tabId="connection"><ConnectionTab /></TabPanel>
            <TabPanel tabId="plugins"><PluginsTab /></TabPanel>
            <TabPanel tabId="components"><ComponentsTab /></TabPanel>
            <TabPanel tabId="browser-extension"><BrowserExtensionTab /></TabPanel>
            <TabPanel tabId="about"><AboutTab /></TabPanel>
          </div>
        </TabContainer>
      </SettingsSearchContext.Provider>
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
