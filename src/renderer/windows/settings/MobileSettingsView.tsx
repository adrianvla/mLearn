/**
 * Mobile Settings View
 * Full-screen settings with slide-based category navigation.
 * Shows category list initially; tapping a category slides to its content.
 */

import { Component, createSignal, For, Show } from 'solid-js';
import { useLocalization } from '../../context';
import Icon from '../../components/common/Icons/Icon';
import { ChevronRightIcon, ChevronLeftIcon } from '../../components/common/Misc/Icons';
import {
  GeneralTab,
  BehaviourTab,
  CustomizationTab,
  SRSTab,
  ReaderTab,
  StatsTab,
  AITab,
  ConnectionTab,
  AboutTab
} from './tabs';
import './MobileSettingsView.css';

type TabId = 'general' | 'behaviour' | 'customization' | 'srs' | 'reader' | 'stats' | 'ai' | 'connection' | 'about';

interface SettingsCategory {
  id: TabId;
  labelKey: string;
  descriptionKey: string;
  icon: string;
}

const CATEGORIES: SettingsCategory[] = [
  { id: 'general', labelKey: 'mlearn.Settings.Tabs.General', descriptionKey: 'mlearn.Settings.Mobile.GeneralDesc', icon: 'cog' },
  { id: 'behaviour', labelKey: 'mlearn.Settings.Tabs.Behaviour', descriptionKey: 'mlearn.Settings.Mobile.BehaviourDesc', icon: 'bot' },
  { id: 'customization', labelKey: 'mlearn.Settings.Tabs.Appearance', descriptionKey: 'mlearn.Settings.Mobile.AppearanceDesc', icon: 'palette' },
  { id: 'srs', labelKey: 'mlearn.Settings.Tabs.SRS', descriptionKey: 'mlearn.Settings.Mobile.SRSDesc', icon: 'cards' },
  { id: 'reader', labelKey: 'mlearn.Settings.Tabs.Reader', descriptionKey: 'mlearn.Settings.Mobile.ReaderDesc', icon: 'book' },
  { id: 'stats', labelKey: 'mlearn.Settings.Tabs.Statistics', descriptionKey: 'mlearn.Settings.Mobile.StatsDesc', icon: 'stats' },
  { id: 'ai', labelKey: 'mlearn.Settings.Tabs.AI', descriptionKey: 'mlearn.Settings.Mobile.AIDesc', icon: 'stars' },
  { id: 'connection', labelKey: 'mlearn.Settings.Tabs.Connection', descriptionKey: 'mlearn.Settings.Mobile.ConnectionDesc', icon: 'pin' },
  { id: 'about', labelKey: 'mlearn.Settings.Tabs.About', descriptionKey: 'mlearn.Settings.Mobile.AboutDesc', icon: 'star' },
];

const TAB_COMPONENTS: Record<TabId, Component> = {
  general: GeneralTab,
  behaviour: BehaviourTab,
  customization: CustomizationTab,
  srs: SRSTab,
  reader: ReaderTab,
  stats: StatsTab,
  ai: AITab,
  connection: ConnectionTab,
  about: AboutTab,
};

export const MobileSettingsView: Component = () => {
  const { t } = useLocalization();
  const [activeCategory, setActiveCategory] = createSignal<TabId | null>(null);

  const openCategory = (id: TabId) => {
    setActiveCategory(id);
  };

  const goBack = () => {
    setActiveCategory(null);
  };

  const activeLabelKey = () => {
    const id = activeCategory();
    if (!id) return '';
    return CATEGORIES.find(c => c.id === id)?.labelKey ?? '';
  };

  return (
    <div class="mobile-settings">
      <div class={`mobile-settings-slider ${activeCategory() ? 'slid' : ''}`}>
        {/* Category list pane */}
        <div class="mobile-settings-list-pane">
          <div class="mobile-settings-header">
            <h1 class="mobile-settings-title">{t('mlearn.Settings.UI.Title')}</h1>
          </div>
          <div class="mobile-settings-categories">
            <For each={CATEGORIES}>
              {(cat) => (
                <button class="mobile-settings-category" onClick={() => openCategory(cat.id)}>
                  <span class="mobile-settings-category-icon">
                    <Icon icon={cat.icon} color="currentColor" class="mobile-settings-icon" />
                  </span>
                  <span class="mobile-settings-category-text">
                    <span class="mobile-settings-category-label">{t(cat.labelKey)}</span>
                    <span class="mobile-settings-category-desc">{t(cat.descriptionKey)}</span>
                  </span>
                  <ChevronRightIcon size={18} class="mobile-settings-category-chevron" />
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Content pane */}
        <div class="mobile-settings-content-pane">
          <div class="mobile-settings-content-header">
            <button class="mobile-settings-back-btn" onClick={goBack}>
              <ChevronLeftIcon size={20} />
              <span>{t('mlearn.Global.Back')}</span>
            </button>
            <span class="mobile-settings-content-title">{t(activeLabelKey())}</span>
          </div>
          <div class="mobile-settings-content-body">
            <Show when={activeCategory()}>
              {(id) => {
                const TabComponent = TAB_COMPONENTS[id()];
                return <TabComponent />;
              }}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};
