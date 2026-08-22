/**
 * Welcome Route
 * Start menu showing options to watch videos, open reader, or continue recent content
 */

import { Component, createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { Tooltip, VideoIcon, BookIcon, SettingsIcon, BotIcon, BarChartIcon, TargetIcon, SearchIcon, LanguageVariantGate, type RecentItem } from '../../../components/common';
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
import { ActionCard } from '../../../components/common/Card/ActionCard';
import { AITutorSetupModal } from '../../../components/AITutorSetup';
import type { TutorSessionConfig } from '../../../../shared/types';
import { getRecentItems } from '../../../services/thumbnailService';
import { isLLMReady } from '../../../services/llmProvider';
import { openWordLookup } from '../../../services/wordLookupService';
import { computeLevelStats, getLevelStudyFrequency, getLevelStudyLevelNames, summarizeLevelCoverage } from '../../../utils/wordLevelStats';
import { qualityToSrsRating, type AttemptQuality } from '../../../../shared/constants';
import { buildAnkiStatusKeySets } from '../../../services/ankiWordsCache';
import { getLearningLanguageLevelForLanguage, isFrequencyLevelAtOrEasierThanTarget } from '../../../../shared/languageFeatures';
import { mergeRowLists, mergeWordRows, selectDictionaryRows, selectLevelChips, selectRecentWordRows, selectWeekStats, selectWordSearchRows } from './welcomeSelectors';
import { fetchTranslation } from '../../../hooks/useTranslation';
import { getDictionaryTargetLanguageForSettings } from '../../../utils/dictionaryTargetLanguage';
import { ankiCacheVersion, searchAnkiWordsCache } from '../../../services/ankiWordsCache';
import Icon from '../../../components/common/Icons/Icon';
import { isMobile } from '../../../../shared/platform';
import './welcome.css';
import AppLogo from "@renderer/components/common/Misc/AppLogo";
import { getLogger } from '../../../../shared/utils/logger';
import { getLocalizedLanguageName } from '../../../utils/languageDisplayName';

const log = getLogger("renderer.welcome");

const OPEN_VIDEO_SESSION_KEY = 'mlearn_open_video';
const OPEN_VIDEO_SUBTITLE_SESSION_KEY = 'mlearn_open_video_subtitles';

/** Blank tutor session used when the composer launches a conversation from a draft message. */
const DEFAULT_TUTOR_CONFIG: TutorSessionConfig = {
  selectedGrammar: [],
  selectedWords: [],
  selectedMedia: [],
  customInstructions: '',
};

export const WelcomeRoute: Component = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const language = useLanguage();
  const flashcards = useFlashcards();

  const [recentItems, setRecentItems] = createSignal<RecentItem[]>([]);
  const [showTutorModal, setShowTutorModal] = createSignal(false);
  const [lookupDraft, setLookupDraft] = createSignal('');
  const [tutorDraft, setTutorDraft] = createSignal('');

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

  const openSettingsSection = (section: string) => {
    getBridge().window.openWindow({ type: 'settings', context: { section } });
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

  const handleTutorSubmit = () => {
    const draft = tutorDraft().trim();
    if (draft) {
      getBridge().window.openWindow({
        type: 'conversation-agent',
        context: {
          tutorConfig: DEFAULT_TUTOR_CONFIG,
          initialMessage: draft,
        } as unknown as Record<string, unknown>,
      });
      setTutorDraft('');
      return;
    }
    openAITutor();
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

  const currentCard = createMemo(() => flashcards.getCurrentCard());
  // Meaning-row matrix semantics: the widget's card front supplies the reading
  // (rendered beneath it), so only Meaning is tested here.
  const ratingButtons = createMemo(() => [
    { quality: 'missed' as const, label: t('mlearn.Rating.Matrix.Missed') },
    { quality: 'struggled' as const, label: t('mlearn.Rating.Matrix.Struggled') },
    { quality: 'fluent' as const, label: t('mlearn.Rating.Matrix.Fluent') },
  ]);
  const rateCard = (quality: AttemptQuality) => {
    const card = currentCard();
    if (!card) return;
    const language = card.language || settings.language;
    const { attemptId, knowledgeBefore } = flashcards.recordAttempt(card.content.front, 'meaning', quality, { language });
    flashcards.answerCard(qualityToSrsRating(quality), card.id, undefined, { attemptId, knowledgeBefore });
  };
  const recentWordRows = createMemo(() =>
    selectRecentWordRows(flashcards.store.flashcards, settings.language, 3),
  );
  const lookupRows = createMemo(() => {
    ankiCacheVersion();
    const draft = lookupDraft().trim();
    if (!draft) return recentWordRows();
    const flashcardRows = selectWordSearchRows(flashcards.store.flashcards, settings.language, draft, 4);
    const personalRows = settings.use_anki
      ? mergeWordRows(
          flashcardRows,
          searchAnkiWordsCache(draft, 6, {
            language: settings.language,
            languageData: language.currentLangData(),
          }),
          4,
        )
      : flashcardRows;
    return mergeRowLists(personalRows, selectDictionaryRows(dictResponse() ?? null, draft, 4), 4);
  });

  const [dictLookupWord, setDictLookupWord] = createSignal('');
  createEffect(() => {
    const draft = lookupDraft().trim();
    if (!draft) {
      setDictLookupWord('');
      return;
    }
    const timer = setTimeout(() => setDictLookupWord(draft), 300);
    onCleanup(() => clearTimeout(timer));
  });
  const [dictResponse] = createResource(
    () => dictLookupWord() || undefined,
    async (word) => {
      if (!word) return null;
      return fetchTranslation(word, settings.language, {
        getCanonicalForm: language.getCanonicalForm,
        getWordVariants: language.getWordVariants,
        dictionaryTargetLanguage: getDictionaryTargetLanguageForSettings(settings),
        languageData: language.currentLangData,
      });
    },
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
      settings.use_anki
        ? buildAnkiStatusKeySets(
          settings.language,
          settings.ankiLearningThreshold,
          settings.ankiKnownThreshold,
          (word) => [language.getCanonicalFormForLanguage(settings.language, word)],
          source.langData,
        )
        : undefined,
    );
    if (stats.length === 0) return null;
    return { levels: stats };
  });
  const levelCoverage = createMemo(() => {
    const data = levelStudy();
    if (data === null) return null;
    const examLevel = getLearningLanguageLevelForLanguage(settings, settings.language || null);
    const scoped = examLevel === null
      ? data.levels
      : data.levels.filter((level) => (
        isFrequencyLevelAtOrEasierThanTarget(level.level, examLevel, language.currentLangData())
      ));
    const { total, tracked, pct } = summarizeLevelCoverage(scoped);
    return { total, tracked, pct };
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
          <button type="button" class="welcome-change-language" onClick={openSettings}>
            {t('mlearn.Home.UI.ChangeLanguage')}
          </button>
        </div>
      </header>

      {/* Main Actions */}
      <Show
        when={settings.simplifyHomeScreen}
        fallback={
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
              card={currentCard()}
              loading={flashcards.isLoading()}
              dueCount={flashcards.queueCounts().total}
              dueLabel={t('mlearn.Flashcards.Statistics.DueToday')}
              emptyLabel={t('mlearn.Flashcards.EmptyState.NoCardsTitle')}
              loadingLabel={t('mlearn.Global.Loading')}
              openLabel={t('mlearn.Global.Continue')}
              ratingButtons={ratingButtons()}
              onOpen={openFlashcards}
              onRate={rateCard}
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
              rows={[
                { label: t('mlearn.Settings.Tabs.General'), section: 'general' },
                { label: t('mlearn.Settings.Tabs.Appearance'), section: 'appearance' },
                { label: t('mlearn.Settings.Tabs.AI'), section: 'ai' },
                { label: t('mlearn.About.KeyboardShortcuts.Title'), section: 'about' },
              ]}
              onOpen={openSettingsSection}
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
              emptyHint={t('mlearn.Home.Cards.WordDatabase.EmptyHint')}
              searching={lookupDraft().trim().length > 0}
              noMatchesLabel={t('mlearn.Home.Cards.WordDatabase.NoMatches')}
              lookupHint={t('mlearn.Home.Cards.WordDatabase.LookupHint', { query: lookupDraft().trim() })}
              rows={lookupRows()}
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
                  placeholder={t('mlearn.ConversationAgent.InputPlaceholder', { language: getLanguageName() })}
                  mobile={isMobile()}
                  draft={tutorDraft()}
                  onDraftChange={setTutorDraft}
                  onSubmit={handleTutorSubmit}
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
                  placeholder={t('mlearn.ConversationAgent.InputPlaceholder', { language: getLanguageName() })}
                  mobile={isMobile()}
                  draft={tutorDraft()}
                  onDraftChange={setTutorDraft}
                  onSubmit={handleTutorSubmit}
                />
              }
            />
          </Tooltip>
        </Show>
          </section>
        }
      >
        <section class="welcome-actions welcome-actions--simple">
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
            icon={<TargetIcon size={24} />}
            title={t('mlearn.Home.Cards.LevelStudy.Title')}
            description={t('mlearn.Home.Cards.LevelStudy.Description')}
            onClick={openLevelStudy}
          />

          <ActionCard
            icon={<BotIcon size={24} />}
            title={t('mlearn.Home.Cards.AITutor.Title')}
            description={
              isLLMReady(settings)
                ? t('mlearn.Home.Cards.AITutor.Description')
                : t('mlearn.Home.Cards.AITutor.SetupRequiredDescription')
            }
            onClick={openAITutor}
            primary
            disabled={!isLLMReady(settings)}
            class="welcome-ai-tutor-card"
          />
        </section>
      </Show>

      <AITutorSetupModal
        isOpen={showTutorModal()}
        onClose={() => setShowTutorModal(false)}
        onStart={handleStartTutor}
      />

      {/* Recent items: continue rows */}
      <Show when={recentItems().length > 0}>
        <section class="welcome-continue-section">
          <h2>{t('mlearn.Home.UI.ContinueLearning')}</h2>
          <div class="welcome-continue-list">
            <For each={recentItems().slice(0, 5)}>
              {(item) => (
                <WelcomeContinueRow
                  item={item}
                  continueLabel={t('mlearn.Global.Continue')}
                  lastWatchedLabel={formatLastWatched(item.lastWatched)}
                  onContinue={openRecent}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

    </div>
  );
};
