/**
 * Welcome Route
 * Start menu showing options to watch videos, open reader, or continue recent content
 */

import { Component, createMemo, createSignal, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { Btn, Tooltip, VideoIcon, BookIcon, SettingsIcon, BotIcon, BarChartIcon, TargetIcon, SearchIcon, LanguageVariantGate, type RecentItem } from '../../../components/common';
import {
  WelcomeFeatureCard,
  WelcomeVideoPreview,
  WelcomeReaderPreview,
  WelcomeFlashcardPreview,
  WelcomeSettingsPreview,
  WelcomeStatsPreview,
  WelcomeLookupPreview,
  WelcomeLevelPreview,
  WelcomeTutorPreview,
  WelcomeContinueRow,
} from './components';
import { AITutorSetupModal } from '../../../components/AITutorSetup';
import type { TutorSessionConfig } from '../../../../shared/types';
import { getRecentItems } from '../../../services/thumbnailService';
import { isLLMReady } from '../../../services/llmProvider';
import { openWordLookup } from '../../../services/wordLookupService';
import { computeLevelStats, getLevelStudyFrequency, getLevelStudyLevelNames, summarizeLevelCoverage } from '../../../utils/wordLevelStats';
import { selectLevelChips, selectNewestFlashcard, selectRecentWordRows, selectWeekStats } from './welcomeSelectors';
import Icon from '../../../components/common/Icons/Icon';
import { isMobile } from '../../../../shared/platform';
import './welcome.css';
import AppLogo from "@renderer/components/common/Misc/AppLogo";
import { getLogger } from '../../../../shared/utils/logger';
import { getLocalizedLanguageName } from '../../../utils/languageDisplayName';

const log = getLogger("renderer.welcome");

const OPEN_VIDEO_SESSION_KEY = 'mlearn_open_video';
const OPEN_VIDEO_SUBTITLE_SESSION_KEY = 'mlearn_open_video_subtitles';

export const WelcomeRoute: Component = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const language = useLanguage();
  const flashcards = useFlashcards();

  const [recentItems, setRecentItems] = createSignal<RecentItem[]>([]);
  const [showTutorModal, setShowTutorModal] = createSignal(false);
  const [lookupDraft, setLookupDraft] = createSignal('');

  onMount(async () => {
    try {
      const items = await getRecentItems();
      setRecentItems(items);
    } catch (e) {
      log.error('Failed to load recent items:', e);
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

  const openLevelStudy = () => {
    if (isMobile()) {
      navigate('/level-study');
    } else {
      getBridge().window.openWindow({ type: 'level-study' });
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
      log.warn('[Welcome] Cannot open recent item - no path saved:', item.name);
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

  const getLanguageName = () => {
    return getLocalizedLanguageName(
      settings.language,
      language.currentLangData(),
      t,
      t('mlearn.Common.Status.Unknown'),
      settings.uiLanguage,
    );
  };

  const videoItem = () => recentItems().find((item) => item.type === 'video') ?? null;
  const bookItem = () => recentItems().find((item) => item.type === 'book') ?? null;

  const newestCard = createMemo(() =>
    selectNewestFlashcard(flashcards.store.flashcards, settings.language),
  );
  const recentWordRows = createMemo(() =>
    selectRecentWordRows(flashcards.store.flashcards, settings.language, 3),
  );
  const submitLookup = () => {
    openWordLookup(lookupDraft());
  };

  const levelStudySource = createMemo(() => {
    const langData = language.currentLangData();
    if (!langData) return null;
    const freq = getLevelStudyFrequency(langData);
    if (!freq || Object.keys(freq).length === 0) return null;
    return {
      langData,
      freq,
      levelNames: getLevelStudyLevelNames(langData, freq),
    };
  });
  const levelStudy = createMemo(() => {
    if (flashcards.isLoading()) return null;
    const source = levelStudySource();
    if (!source) return null;
    const stats = computeLevelStats(
      flashcards.store,
      source.freq,
      settings.language,
      settings.known_ease_threshold,
      settings.srsLearningThreshold,
      source.levelNames,
      source.langData,
      language.getCanonicalFormForLanguage,
    );
    if (stats.length === 0) return null;
    return { levels: stats, ...summarizeLevelCoverage(stats) };
  });
  const levelCoverage = createMemo(() => {
    const data = levelStudy();
    if (data === null) return null;
    return { total: data.total, tracked: data.tracked, pct: data.pct };
  });
  const levelChips = createMemo(() => selectLevelChips(levelStudy()?.levels ?? []));

  const weekStats = createMemo(() =>
    selectWeekStats(flashcards.store.dailyStats, settings.language, new Date()),
  );
  const weekTotals = createMemo(() => {
    const days = weekStats();
    return {
      newCards: days.reduce((sum, day) => sum + day.newCards, 0),
      reviews: days.reduce((sum, day) => sum + day.reviews, 0),
    };
  });
  const formatWeekday = (date: string) => {
    try {
      return new Intl.DateTimeFormat(settings.uiLanguage, { weekday: 'narrow' }).format(new Date(`${date}T00:00:00`));
    } catch {
      return date.slice(5);
    }
  };
  const weekdayLabels = createMemo(() => weekStats().map((day) => formatWeekday(day.date)));

  const formatLastWatched = (timestamp: number) => {
    try {
      const days = Math.round((timestamp - Date.now()) / 86_400_000);
      return new Intl.RelativeTimeFormat(settings.uiLanguage, { numeric: 'auto' }).format(days, 'day');
    } catch {
      return new Date(timestamp).toLocaleDateString(settings.uiLanguage);
    }
  };

  return (
    <div class="welcome-container">
      <LanguageVariantGate />
      <WindowDragRegion />
      
      {/* Header */}
      <header class="welcome-header">
        <div class="welcome-logo">
          <AppLogo size={"2.5rem"}/>
          <h1>{t('mlearn.Home.UI.Title')}</h1>
        </div>
        <div class="welcome-subtitle">
          <span>
            {t('mlearn.Home.UI.LearningLanguage', { language: getLanguageName() })}
            <Show when={language.currentLangData()?.flagEmoji}>
              {(flagEmoji) => <> {flagEmoji()}</>}
            </Show>
          </span>
          <Btn variant="ghost" size="sm" onClick={openSettings}>{t('mlearn.Home.UI.ChangeLanguage')}</Btn>
        </div>
      </header>

      {/* Main Actions */}
      <section class="welcome-actions">
        <WelcomeFeatureCard
          icon={<VideoIcon size={24} />}
          title={t('mlearn.Home.Cards.Video.Title')}
          description={t('mlearn.Home.Cards.Video.Description')}
          onClick={openVideoPlayer}
          preview={
            <WelcomeVideoPreview
              item={videoItem()}
              emptyLabel={t('mlearn.Home.Cards.Video.Description')}
              continueLabel={t('mlearn.Global.Continue')}
              onResume={openRecent}
            />
          }
        />

        <WelcomeFeatureCard
          icon={<BookIcon size={24} />}
          title={t('mlearn.Home.Cards.Reader.Title')}
          description={t('mlearn.Home.Cards.Reader.Description')}
          onClick={openReader}
          preview={
            <WelcomeReaderPreview
              item={bookItem()}
              emptyLabel={t('mlearn.Home.Cards.Reader.Description')}
              continueLabel={t('mlearn.Global.Continue')}
              onResume={openRecent}
            />
          }
        />

        <WelcomeFeatureCard
          icon={<Icon icon="cards" color="currentColor" class="" />}
          title={t('mlearn.Home.Cards.Flashcards.Title')}
          description={t('mlearn.Home.Cards.Flashcards.Description')}
          onClick={openFlashcards}
          preview={
            <WelcomeFlashcardPreview
              card={newestCard()}
              loading={flashcards.isLoading()}
              dueCount={flashcards.queueCounts().total}
              dueLabel={t('mlearn.Flashcards.Statistics.DueToday')}
              emptyLabel={t('mlearn.Flashcards.EmptyState.NoCardsTitle')}
              loadingLabel={t('mlearn.Global.Loading')}
              openLabel={t('mlearn.Global.Continue')}
              onOpen={openFlashcards}
            />
          }
        />

        <WelcomeFeatureCard
          icon={<SettingsIcon size={24} />}
          title={t('mlearn.Home.Cards.Settings.Title')}
          description={t('mlearn.Home.Cards.Settings.Description')}
          onClick={openSettings}
          preview={
            <WelcomeSettingsPreview
              generalLabel={t('mlearn.Settings.Tabs.General')}
              appearanceLabel={t('mlearn.Settings.Tabs.Appearance')}
              aiLabel={t('mlearn.Settings.Tabs.AI')}
              shortcutsLabel={t('mlearn.About.KeyboardShortcuts.Title')}
              onOpen={openSettings}
            />
          }
        />

        <WelcomeFeatureCard
          icon={<BarChartIcon size={24} />}
          title={t('mlearn.Home.Cards.Statistics.Title')}
          description={t('mlearn.Home.Cards.Statistics.Description')}
          onClick={openStatistics}
          preview={
            <WelcomeStatsPreview
              days={weekStats()}
              newTotal={weekTotals().newCards}
              reviewsTotal={weekTotals().reviews}
              newLabel={t('mlearn.Statistics.Dashboard.CardState.New')}
              reviewsLabel={t('mlearn.Statistics.Dashboard.Reviews')}
              weekdayLabels={weekdayLabels()}
              onOpen={openStatistics}
            />
          }
        />

        <WelcomeFeatureCard
          icon={<SearchIcon size={24} />}
          title={t('mlearn.Home.Cards.WordDatabase.Title')}
          description={t('mlearn.Home.Cards.WordDatabase.Description')}
          onClick={openWordDatabase}
          preview={
            <WelcomeLookupPreview
              mobile={isMobile()}
              draft={lookupDraft()}
              placeholder={t('mlearn.Global.Search')}
              searchLabel={t('mlearn.Global.Search')}
              emptyHint={t('mlearn.Flashcards.EmptyState.NoCardsTitle')}
              rows={recentWordRows()}
              onDraftChange={(value) => setLookupDraft(value)}
              onSubmit={submitLookup}
              onOpenDatabase={openWordDatabase}
              onLookupWord={openWordLookup}
            />
          }
        />

        <WelcomeFeatureCard
          icon={<TargetIcon size={24} />}
          title={t('mlearn.Home.Cards.LevelStudy.Title')}
          description={t('mlearn.Home.Cards.LevelStudy.Description')}
          onClick={openLevelStudy}
          preview={
            <WelcomeLevelPreview
              coverage={levelCoverage()}
              active={levelChips().active}
              chips={levelChips().chips}
              titleLabel={t('mlearn.LevelStudy.Coverage.Title')}
              emptyLabel={t('mlearn.Home.Cards.LevelStudy.Description')}
              onOpen={openLevelStudy}
            />
          }
        />

        <Show
          when={!isLLMReady(settings)}
          fallback={
            <WelcomeFeatureCard
              icon={<BotIcon size={24} />}
              title={t('mlearn.Home.Cards.AITutor.Title')}
              description={t('mlearn.Home.Cards.AITutor.Description')}
              onClick={openAITutor}
              class="welcome-ai-tutor-card"
              preview={
                <WelcomeTutorPreview
                  ready
                  readyLabel={t('mlearn.Global.Ready')}
                  setupLabel={t('mlearn.Home.Cards.AITutor.SetupRequiredDescription')}
                  continueLabel={t('mlearn.Global.Continue')}
                  settingsLabel={t('mlearn.Home.Cards.Settings.Title')}
                  onLaunch={openAITutor}
                  onOpenSettings={openSettings}
                />
              }
            />
          }
        >
          <Tooltip
            content={t('mlearn.Home.Cards.AITutor.SetupRequiredTooltip')}
          >
            <WelcomeFeatureCard
              icon={<BotIcon size={24} />}
              title={t('mlearn.Home.Cards.AITutor.Title')}
              description={t('mlearn.Home.Cards.AITutor.SetupRequiredDescription')}
              onClick={openAITutor}
              disabled
              class="welcome-ai-tutor-card"
              preview={
                <WelcomeTutorPreview
                  ready={false}
                  readyLabel={t('mlearn.Global.Ready')}
                  setupLabel={t('mlearn.Home.Cards.AITutor.SetupRequiredDescription')}
                  continueLabel={t('mlearn.Global.Continue')}
                  settingsLabel={t('mlearn.Home.Cards.Settings.Title')}
                  onLaunch={openAITutor}
                  onOpenSettings={openSettings}
                />
              }
            />
          </Tooltip>
        </Show>
      </section>

      <AITutorSetupModal
        isOpen={showTutorModal()}
        onClose={() => setShowTutorModal(false)}
        onStart={handleStartTutor}
      />

      {/* Recent item: full-width continue row */}
      <Show when={recentItems()[0]}>
        {(item) => (
          <section class="welcome-continue-section">
            <h2>{t('mlearn.Home.UI.ContinueLearning')}</h2>
            <WelcomeContinueRow
              item={item()}
              continueLabel={t('mlearn.Global.Continue')}
              lastWatchedLabel={formatLastWatched(item().lastWatched)}
              onContinue={openRecent}
            />
          </section>
        )}
      </Show>

    </div>
  );
};
