/**
 * Welcome Route
 * Start menu showing options to watch videos, open reader, or continue recent content
 */

import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings, useLocalization } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { ActionCard, RecentCard, Btn, VideoIcon, BookIcon, SettingsIcon, BotIcon, BarChartIcon, GridIcon, SearchIcon, type RecentItem } from '../../../components/common';
import { AITutorSetupModal } from '../../../components/AITutorSetup';
import type { TutorSessionConfig } from '../../../../shared/types';
import { getRecentItems } from '../../../services/thumbnailService';
import Icon from '../../../components/common/Icons/Icon';
import { isMobile } from '../../../../shared/platform';
import './welcome.css';
import AppLogo from "@renderer/components/common/Misc/AppLogo";

const OPEN_VIDEO_SESSION_KEY = 'mlearn_open_video';
const OPEN_VIDEO_SUBTITLE_SESSION_KEY = 'mlearn_open_video_subtitles';

export const WelcomeRoute: Component = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { t } = useLocalization();
  
  const [recentItems, setRecentItems] = createSignal<RecentItem[]>([]);
  const [showTutorModal, setShowTutorModal] = createSignal(false);

  onMount(async () => {
    try {
      const items = await getRecentItems();
      setRecentItems(items);
    } catch (e) {
      console.error('Failed to load recent items:', e);
    }
  });

  const openVideoPlayer = () => {
    navigate('/video');
  };

  const openReader = () => {
    navigate('/reader');
  };

  const openSettings = () => {
    getBridge().window.openWindow({ type: 'settings' });
  };

  const openFlashcards = () => {
    getBridge().window.openWindow({ type: 'flashcards' });
  };

  const openStatistics = () => {
    if (isMobile()) {
      navigate('/statistics');
    } else {
      getBridge().window.openWindow({ type: 'statistics' });
    }
  };

  const openWordDatabase = () => {
    if (isMobile()) {
      navigate('/word-db-editor');
    } else {
      getBridge().window.openWindow({ type: 'word-db-editor' });
    }
  };

  const openCharacterGrid = () => {
    if (isMobile()) {
      navigate('/kanji-grid');
    } else {
      getBridge().window.openWindow({ type: 'kanji-grid' });
    }
  };

  const openAITutor = () => {
    setShowTutorModal(true);
  };

  const handleStartTutor = (config: TutorSessionConfig) => {
    setShowTutorModal(false);
    getBridge().window.openWindow({
      type: 'conversation-agent',
      context: { tutorConfig: config } as unknown as Record<string, unknown>,
    });
  };

  const openRecent = (item: RecentItem) => {
    // Don't try to open items with no path (legacy items or failed saves)
    if (!item.path || !item.path.trim()) {
      console.warn('[Welcome] Cannot open recent item - no path saved:', item.name);
      // Show alert and navigate to the appropriate route - user can then drag/drop
      alert(t('mlearn.Home.Errors.UnableToOpen'));
      if (item.type === 'video') {
        navigate('/video');
      } else {
        navigate('/reader');
      }
      return;
    }
    
    if (item.type === 'video') {
      // Store the path and navigate
      sessionStorage.setItem(OPEN_VIDEO_SESSION_KEY, item.path);
      if (item.subtitlePath?.trim()) {
        sessionStorage.setItem(OPEN_VIDEO_SUBTITLE_SESSION_KEY, item.subtitlePath);
      } else {
        sessionStorage.removeItem(OPEN_VIDEO_SUBTITLE_SESSION_KEY);
      }
      navigate('/video');
    } else {
      sessionStorage.removeItem(OPEN_VIDEO_SESSION_KEY);
      sessionStorage.removeItem(OPEN_VIDEO_SUBTITLE_SESSION_KEY);
      sessionStorage.setItem('mlearn_open_book', item.path);
      navigate('/reader');
    }
  };

  // Get the language name from the localization system
  const getLanguageName = () => {
    const langKey = `mlearn.Languages.${settings.language}`;
    return t(langKey);
  };

  return (
    <div class="welcome-container">
      <WindowDragRegion />
      
      {/* Header */}
      <header class="welcome-header">
        <div class="welcome-logo">
          <AppLogo size={"2.5rem"}/>
          <h1>{t('mlearn.Home.UI.Title')}</h1>
        </div>
        <p class="welcome-subtitle">{t('mlearn.Home.UI.TitleDescription')}</p>
      </header>

      {/* Main Actions */}
      <section class="welcome-actions">
        <ActionCard
          icon={<VideoIcon size={24} />}
          title={t('mlearn.Home.Cards.Video.Title')}
          description={t('mlearn.Home.Cards.Video.Description')}
          onClick={openVideoPlayer}
          primary
        />

        <ActionCard
          icon={<BookIcon size={24} />}
          title={t('mlearn.Home.Cards.Reader.Title')}
          description={t('mlearn.Home.Cards.Reader.Description')}
          onClick={openReader}
          primary
        />

        <ActionCard
          icon={<Icon icon="cards" color="currentColor" class="" />}
          title={t('mlearn.Home.Cards.Flashcards.Title')}
          description={t('mlearn.Home.Cards.Flashcards.Description')}
          onClick={openFlashcards}
        />

        <ActionCard
          icon={<SettingsIcon size={24} />}
          title={t('mlearn.Home.Cards.Settings.Title')}
          description={t('mlearn.Home.Cards.Settings.Description')}
          onClick={openSettings}
        />

        <ActionCard
          icon={<BarChartIcon size={24} />}
          title={t('mlearn.Home.Cards.Statistics.Title')}
          description={t('mlearn.Home.Cards.Statistics.Description')}
          onClick={openStatistics}
        />

        <ActionCard
          icon={<SearchIcon size={24} />}
          title={t('mlearn.Home.Cards.WordDatabase.Title')}
          description={t('mlearn.Home.Cards.WordDatabase.Description')}
          onClick={openWordDatabase}
        />

        <ActionCard
          icon={<GridIcon size={24} />}
          title={t('mlearn.Home.Cards.CharacterGrid.Title')}
          description={t('mlearn.Home.Cards.CharacterGrid.Description')}
          onClick={openCharacterGrid}
        />

        <ActionCard
          icon={<BotIcon size={24} />}
          title={t('mlearn.Home.Cards.AITutor.Title')}
          description={t('mlearn.Home.Cards.AITutor.Description')}
          onClick={openAITutor}
          primary
          disabled={!settings.llmEnabled || !settings.llmConfigured}
          class="welcome-ai-tutor-card"
        />
      </section>

      <AITutorSetupModal
        isOpen={showTutorModal()}
        onClose={() => setShowTutorModal(false)}
        onStart={handleStartTutor}
      />

      {/* Recent Items */}
      <Show when={recentItems().length > 0}>
        <section class="welcome-recent">
          <h2>{t('mlearn.Home.UI.ContinueLearning')}</h2>
          <div class="recent-grid">
            <For each={recentItems().slice(0, 4)}>
              {(item) => (
                <RecentCard 
                  item={item} 
                  onClick={() => openRecent(item)} 
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      {/* Footer */}
      <footer class="welcome-footer">
        <span>{t('mlearn.Home.UI.LearningLanguage', { language: getLanguageName() })}</span>
        <span>•</span>
        <Btn variant="ghost" size="sm" onClick={openSettings}>{t('mlearn.Home.UI.ChangeLanguage')}</Btn>
      </footer>
    </div>
  );
};
