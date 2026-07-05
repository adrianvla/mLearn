/**
 * Mobile Layout
 * Wraps page content with a floating bottom tab bar and iOS-style navigation.
 * Content uses the full screen. A large title appears at the top and collapses
 * to a compact sticky bar when scrolled, like Apple Settings.
 */

import { ParentComponent, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { useLocalization } from '../../../context';
import { BottomTabBar } from '../BottomTabBar/BottomTabBar';
import './MobileLayout.css';

const backArrow = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;

/** Routes that are top-level tabs (no back button) */
const tabRoots = new Set(['/', '/video', '/reader', '/flashcards', '/settings']);

/** Routes that render their own header and should not get the large title */
const selfHeaderRoutes = new Set(['/video', '/reader', '/conversation-agent']);

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

/** Map sub-routes to their parent route's title key (for iOS "< Parent" back label) */
const routeParentTitleKeys: Record<string, string> = {
  '/conversation-agent': 'mlearn.Tabs.Home',
  '/word-db-editor': 'mlearn.Tabs.Settings',
  '/level-study': 'mlearn.Tabs.Settings',
  '/licenses': 'mlearn.Tabs.Settings',
};

export const MobileLayout: ParentComponent = (props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLocalization();

  let largeTitleRef: HTMLDivElement | undefined;
  let scrollRef!: HTMLElement;
  const [isStuck, setIsStuck] = createSignal(false);
  let titleThreshold = 0;

  const isSubRoute = () => !tabRoots.has(location.pathname);
  const showLargeTitle = () => !selfHeaderRoutes.has(location.pathname);
  const title = () => {
    const key = routeTitleKeys[location.pathname];
    return key ? t(key) : '';
  };
  const backLabel = () => {
    const key = routeParentTitleKeys[location.pathname];
    return key ? t(key) : t('mlearn.Global.Back');
  };

  const handleScroll = () => {
    if (titleThreshold <= 0) {
      setIsStuck(false);
      return;
    }
    const progress = Math.min(scrollRef.scrollTop / titleThreshold, 1);
    scrollRef.style.setProperty('--title-progress', String(progress));
    setIsStuck(progress >= 1);
  };

  // Re-measure title height and reset scroll on route change
  createEffect(() => {
    void location.pathname;
    setIsStuck(false);
    if (scrollRef) {
      scrollRef.scrollTop = 0;
      scrollRef.style.setProperty('--title-progress', '0');
    }
    requestAnimationFrame(() => {
      titleThreshold = largeTitleRef ? largeTitleRef.offsetHeight : 0;
    });
  });

  onMount(() => {
    scrollRef.addEventListener('scroll', handleScroll, { passive: true });
    onCleanup(() => scrollRef.removeEventListener('scroll', handleScroll));
  });

  return (
    <div class="mobile-layout">
      <Show when={title()}>
        <div class={`mobile-sticky-bar ${isStuck() && showLargeTitle() ? 'visible' : ''}`}>
          <Show when={isSubRoute()}>
            <button class="mobile-sticky-back" onClick={() => navigate(-1)} aria-label={backLabel()}>
              <span innerHTML={backArrow} />
              <span class="mobile-sticky-back-label">{backLabel()}</span>
            </button>
          </Show>
          <span class="mobile-sticky-title">{title()}</span>
        </div>
      </Show>
      <main class="mobile-content" ref={scrollRef}>
        <Show when={showLargeTitle() && title()}>
          <div class="mobile-large-title-area" ref={largeTitleRef}>
            <Show when={isSubRoute()}>
              <button class="mobile-large-back" onClick={() => navigate(-1)}>
                <span innerHTML={backArrow} />
                <span>{backLabel()}</span>
              </button>
            </Show>
            <h1 class="mobile-large-title">{title()}</h1>
          </div>
        </Show>
        {props.children}
      </main>
      <BottomTabBar />
    </div>
  );
};
