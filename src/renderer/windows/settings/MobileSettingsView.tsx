/**
 * Mobile Settings View
 * iOS-style stack navigator: category list lives in MobileLayout's scroll flow
 * (inheriting the large title fade). Tapping a category pushes a full-screen
 * overlay from the right with its own scroll-driven large title + sticky bar.
 */

import { Component, createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useLocalization } from '../../context';
import Icon from '../../components/common/Icons/Icon';
import { ChevronRightIcon } from '../../components/common/Misc/Icons';
import {
  GeneralTab,
  BehaviourTab,
  CustomizationTab,
  SRSTab,
  ReaderTab,
  StatsTab,
  AITab,
  ConnectionTab,
  AboutTab,
  VideoPlayerTab
} from './tabs';
import './MobileSettingsView.css';

type TabId = 'general' | 'behaviour' | 'customization' | 'srs' | 'reader' | 'stats' | 'video-player' | 'ai' | 'connection' | 'about';

interface SettingsCategory {
  id: TabId;
  labelKey: string;
  icon: string;
}

/** Categories grouped into unnamed sections, rendered as iOS-style grouped lists */
const CATEGORY_GROUPS: SettingsCategory[][] = [
  [
    { id: 'general', labelKey: 'mlearn.Settings.Tabs.General', icon: 'cog' },
    { id: 'behaviour', labelKey: 'mlearn.Settings.Tabs.Behaviour', icon: 'bot' },
    { id: 'customization', labelKey: 'mlearn.Settings.Tabs.Appearance', icon: 'palette' },
  ],
  [
    { id: 'srs', labelKey: 'mlearn.Settings.Tabs.SRS', icon: 'cards' },
    { id: 'reader', labelKey: 'mlearn.Settings.Tabs.Reader', icon: 'book' },
    { id: 'video-player', labelKey: 'mlearn.Settings.Tabs.VideoPlayer', icon: 'play' },
    { id: 'stats', labelKey: 'mlearn.Settings.Tabs.Statistics', icon: 'stats' },
  ],
  [
    { id: 'ai', labelKey: 'mlearn.Settings.Tabs.AI', icon: 'stars' },
    { id: 'connection', labelKey: 'mlearn.Settings.Tabs.Connection', icon: 'pin' },
    { id: 'about', labelKey: 'mlearn.Settings.Tabs.About', icon: 'star' },
  ],
];

const ALL_CATEGORIES = CATEGORY_GROUPS.flat();

const TAB_COMPONENTS: Record<TabId, Component> = {
  general: GeneralTab,
  behaviour: BehaviourTab,
  customization: CustomizationTab,
  srs: SRSTab,
  reader: ReaderTab,
  'video-player': VideoPlayerTab,
  stats: StatsTab,
  ai: AITab,
  connection: ConnectionTab,
  about: AboutTab,
};

const backArrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;

export const MobileSettingsView: Component = () => {
  const { t } = useLocalization();
  const [activeCategory, setActiveCategory] = createSignal<TabId | null>(null);
  const [isOpen, setIsOpen] = createSignal(false);
  const [isStuck, setIsStuck] = createSignal(false);

  let scrollRef: HTMLDivElement | undefined;
  let largeTitleRef: HTMLDivElement | undefined;
  let titleThreshold = 0;

  const openCategory = (id: TabId) => {
    setActiveCategory(id);
    setIsOpen(true);
    setIsStuck(false);
  };

  const goBack = () => {
    setIsOpen(false);
    setTimeout(() => {
      if (!isOpen()) {
        setActiveCategory(null);
        setIsStuck(false);
      }
    }, 350);
  };

  const activeLabelKey = () => {
    const id = activeCategory();
    if (!id) return '';
    return ALL_CATEGORIES.find(c => c.id === id)?.labelKey ?? '';
  };

  const handleScroll = () => {
    if (!scrollRef || titleThreshold <= 0) {
      setIsStuck(false);
      return;
    }
    const progress = Math.min(scrollRef.scrollTop / titleThreshold, 1);
    scrollRef.style.setProperty('--title-progress', String(progress));
    setIsStuck(progress >= 1);
  };

  // Reset scroll position when a new category is opened
  createEffect(() => {
    const id = activeCategory();
    if (id && scrollRef) {
      scrollRef.scrollTop = 0;
      scrollRef.style.setProperty('--title-progress', '0');
      setIsStuck(false);
      requestAnimationFrame(() => {
        titleThreshold = largeTitleRef ? largeTitleRef.offsetHeight : 0;
      });
    }
  });

  // Sync body class with overlay state for parallax CSS
  createEffect(() => {
    if (isOpen()) {
      document.body.classList.add('settings-overlay-open');
    } else {
      document.body.classList.remove('settings-overlay-open');
    }
  });

  onMount(() => {
    if (scrollRef) {
      scrollRef.addEventListener('scroll', handleScroll, { passive: true });
      onCleanup(() => scrollRef!.removeEventListener('scroll', handleScroll));
    }
    onCleanup(() => document.body.classList.remove('settings-overlay-open'));
  });

  return (
    <div class="mobile-settings">
      {/* Category list — lives in MobileLayout's scroll flow */}
      <div class="mobile-settings-categories">
        <For each={CATEGORY_GROUPS}>
          {(group) => (
            <div class="mobile-settings-group">
              <For each={group}>
                {(cat) => (
                  <button class="mobile-settings-category" data-cat={cat.id} onClick={() => openCategory(cat.id)}>
                    <span class="mobile-settings-category-icon">
                      <Icon icon={cat.icon} color="currentColor" class="mobile-settings-icon" />
                    </span>
                    <span class="mobile-settings-category-text">
                      <span class="mobile-settings-category-label">{t(cat.labelKey)}</span>
                    </span>
                    <ChevronRightIcon size={18} class="mobile-settings-category-chevron" />
                  </button>
                )}
              </For>
            </div>
          )}
        </For>
      </div>

      {/* Stack overlay — portaled to body so parent transform doesn't break position:fixed */}
      <Portal mount={document.body}>
        <div class={`mobile-settings-overlay ${isOpen() ? 'open' : ''}`}>
          <div class="mobile-settings-backdrop" />
          <div class="mobile-settings-panel">
            {/* Compact sticky bar (fades in when large title scrolls away) */}
            <div class={`mobile-settings-sticky ${isStuck() ? 'visible' : ''}`}>
              <button class="mobile-settings-sticky-back" onClick={goBack}>
                <span innerHTML={backArrow} />
                <span class="mobile-settings-sticky-back-label">{t('mlearn.Settings.UI.Title')}</span>
              </button>
              <span class="mobile-settings-sticky-title">{t(activeLabelKey())}</span>
            </div>

            {/* Scrollable content */}
            <div class="mobile-settings-scroll" ref={scrollRef}>
              <div class="mobile-settings-title-area" ref={largeTitleRef}>
                <button class="mobile-settings-back" onClick={goBack}>
                  <span innerHTML={backArrow} />
                  <span>{t('mlearn.Settings.UI.Title')}</span>
                </button>
                <h1 class="mobile-settings-title">{t(activeLabelKey())}</h1>
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
      </Portal>
    </div>
  );
};
