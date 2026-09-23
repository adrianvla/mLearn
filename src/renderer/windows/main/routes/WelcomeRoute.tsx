/**
 * Welcome Route
 * Start menu showing options to watch videos, open reader, or continue recent content
 */

import { Component, createEffect, createMemo, createResource, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../../context';
import type { Flashcard } from '../../../../shared/types';
import { getBridge } from '../../../../shared/bridges';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { VideoIcon, BookIcon, BotIcon, BarChartIcon, TargetIcon, SearchIcon, LanguageVariantGate, type RecentItem } from '../../../components/common';
import {
  WelcomeFeatureCard,
  WelcomeVideoPreview,
  WelcomeReaderPreview,
  WelcomeFlashcardPreview,
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
import { getLearningLanguageLevelForLanguage, isFrequencyLevelAtOrEasierThanTarget } from '../../../../shared/languageFeatures';
import { mergeRowLists, mergeWordRows, selectDictionaryRows, selectLevelChips, selectRecentWordRows, selectWeekStats, selectWordSearchRows } from './welcomeSelectors';
import { fetchTranslation } from '../../../hooks/useTranslation';
import { getDictionaryTargetLanguageForSettings } from '../../../utils/dictionaryTargetLanguage';
import { ankiCacheVersion, searchAnkiWordsCache } from '../../../services/ankiWordsCache';
import { policyContextFromSettings } from '../../../learning/policyContext';
import Icon from '../../../components/common/Icons/Icon';
import { isMobile } from '../../../../shared/platform';
import { createEncounterTimer, type AttemptTiming, type EncounterTimer } from '../../../../shared/encounterTiming';
import './welcome.css';
import AppLogo from "@renderer/components/common/Misc/AppLogo";
import { getLogger } from '../../../../shared/utils/logger';
import { getLocalizedLanguageName } from '../../../utils/languageDisplayName';
import { selectNextEncounter } from '../../../learning/engine';
import { useDecisionPin } from '../../../hooks/useDecisionPin';

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
    // The unconfigured state must not be a dead card: with no LLM ready, the
    // card routes to Settings → AI where the provider is configured. A
    // disabled button swallows clicks (and even hover tooltips), which read as
    // a broken sidebar item rather than a setup requirement.
    if (!isLLMReady(settings)) {
      getBridge().window.openWindow({
        type: 'settings',
        context: { section: 'ai' } as unknown as Record<string, unknown>,
      });
      return;
    }
    setShowTutorModal(true);
  };

  const handleTutorSubmit = () => {
    const draft = tutorDraft().trim();
    // Both tutor launch paths funnel through the same readiness gate: an
    // unconfigured LLM routes to Settings → AI instead of opening an agent
    // that cannot run.
    if (!isLLMReady(settings)) {
      openAITutor();
      return;
    }
    if (draft) {
      getBridge().window.openWindow({
        type: 'conversation-agent',
        context: {
          tutorConfig: { ...DEFAULT_TUTOR_CONFIG, customInstructions: draft },
        } as unknown as Record<string, unknown>,
      });
      setTutorDraft('');
      return;
    }
    openAITutor();
  };

  const handleStartTutor = (config: TutorSessionConfig) => {
    if (!isLLMReady(settings)) {
      openAITutor();
      return;
    }
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

  // One pinned decision per encounter (see useDecisionPin): unrelated
  // reactive updates re-run the selection memo, and the pin re-serves the
  // SAME decision instead of re-drawing with a fresh unseeded rng draw.
  const decisionPin = useDecisionPin();

  const currentCard = createMemo(() => {
    const fallback = flashcards.getCurrentCard();
    if (!fallback) return null;
    const language = fallback.language || settings.language;
    // The policy arbitrates within the scheduler's OWN visible workload for
    // today (the queue — respecting daily caps and same-day scheduling), not
    // just its first card (R07/R08). Queued-new cards carry their state so
    // the source scores them as exploration (novelty), never as fabricated
    // overdue repair.
    const nowMs = Date.now();
    const targetsFor = (word: string, cardLanguage: string) =>
      [{ entityId: `${cardLanguage}:surface:${word}`, capability: 'surface-recognition' as const }];
    const reviewQueueEntries = [...flashcards.queue().newQueue, ...flashcards.queue().scheduledQueue]
      .map((id) => flashcards.store.flashcards[id])
      .filter((card): card is Flashcard => !!card && !card.suspended && !card.buried
        && (card.language || settings.language) === language)
      .map((card) => ({
        id: card.id,
        word: card.content.front,
        language: card.language || settings.language,
        targets: targetsFor(card.content.front, card.language || settings.language),
        dueDate: card.dueDate,
        interval: card.interval,
        suspended: card.suspended,
        buried: card.buried,
        state: card.state,
        // Queue membership IS the scheduler's same-day admission.
        scheduledForToday: true,
        // Scheduler-replayed journal state feeding the momentum producer (R08).
        lastReviewed: card.lastReviewed,
        ease: card.ease,
        reviews: card.reviews,
      }));
    if (!reviewQueueEntries.some((entry) => entry.id === fallback.id)) {
      reviewQueueEntries.push({
        id: fallback.id,
        word: fallback.content.front,
        language,
        targets: targetsFor(fallback.content.front, language),
        dueDate: fallback.dueDate,
        interval: fallback.interval,
        suspended: fallback.suspended,
        buried: fallback.buried,
        state: fallback.state,
        scheduledForToday: true,
        lastReviewed: fallback.lastReviewed,
        ease: fallback.ease,
        reviews: fallback.reviews,
      });
    }
    // Pinned for the active encounter (R20 repair): this memo re-runs on
    // every unrelated queue/store/settings update, and the unseeded weighted
    // draw would silently replace the displayed card. The pin re-serves the
    // same decision until an explicit review action advances the epoch.
    const decision = decisionPin.pin(fallback.id, () => selectNextEncounter({
      preset: 'RETENTION',
      nowMs,
      // The goal applies only to the queue's own learning language (R07).
      context: policyContextFromSettings(settings, language),
      reviewQueueEntries,
    }));
    return decision?.action === 'DEFER'
      ? fallback
      : flashcards.store.flashcards[decision?.candidate.key ?? ''] ?? fallback;
  });
  // Active-engagement timing per welcome card (shared encounter
  // instrumentation): blur/hidden pauses never count as retrieval latency.
  let welcomeTimer: EncounterTimer | null = null;
  const stopWelcomeTiming = (): AttemptTiming | null => {
    const timing = welcomeTimer?.stop() ?? null;
    welcomeTimer?.dispose();
    welcomeTimer = null;
    return timing;
  };
  onCleanup(() => stopWelcomeTiming());
  createEffect(on(
    () => currentCard()?.id,
    (cardId) => {
      stopWelcomeTiming();
      if (!cardId) return;
      welcomeTimer = createEncounterTimer();
      welcomeTimer.start();
    },
  ));
  const rateCard = (quality: AttemptQuality, easy?: boolean) => {
    const card = currentCard();
    if (!card) return;
    const language = card.language || settings.language;
    const timing = stopWelcomeTiming();
    // Meaning-row matrix semantics: the widget's card front supplies the
    // reading (rendered beneath it), so only Meaning is tested here — and the
    // evidence records that presentation honestly.
    const { attemptId } = flashcards.recordAttempt(card.content.front, 'sense-recognition', quality, {
      language,
      taskType: 'welcome-review',
      ...(timing ? { timing } : {}),
      scaffolds: { reading: true },
    });
    flashcards.answerCard(qualityToSrsRating(quality, easy), card.id, timing?.wallLatencyMs, {
      attemptId,
      taskType: 'welcome-review',
      tested: ['sense-recognition'],
      scaffolds: { reading: true },
    });
    // The answer changed the pool: end the encounter so the next displayed
    // card re-selects instead of replaying the just-rated pick (R20 repair).
    decisionPin.advance();
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
  // The coverage dial must never render intermediate percentages: the store
  // arriving, the legacy knowledge migrations settling, and the language
  // data landing each change the numbers. Until all three are authoritative,
  // levelStudy is pending (skeleton), not empty (0%).
  const levelStudyPending = createMemo(() => (
    flashcards.isLoading() || !flashcards.isKnowledgeReady() || language.isLoading()
  ));
  const levelStudy = createMemo(() => {
    if (levelStudyPending()) return null;
    const source = levelStudySource();
    if (!source) return null;
    const stats = computeLevelStats(
      flashcards.store,
      source.freq,
      settings.language,
      settings.easeThresholdKnown * 1000,
      settings.easeThresholdLearning * 1000,
      source.levelNames,
      source.langData,
      language.getCanonicalFormForLanguage,
      flashcards.getComprehensiveWordStatusWithSourceSync,
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
            <Show when={language.currentLangData()?.flagEmoji}>
              {(flag) => <span class="welcome-language-flag" aria-hidden="true">{flag()}</span>}
            </Show>
            {t('mlearn.Home.UI.LearningLanguage', { language: getLanguageName() })}
          </span>
          <button type="button" class="welcome-change-language" onClick={openSettings}>
            {t('mlearn.Home.Cards.Settings.Title')}
          </button>
        </div>
      </header>

      {/* Main Actions */}
      <Show
        when={settings.simplifyHomeScreen}
        fallback={
          <section class="welcome-actions">
            <WelcomeFeatureCard
          icon={<TargetIcon size={24} />}
          title={t('mlearn.Home.Cards.LevelStudy.Title')}
          description={t('mlearn.Home.Cards.LevelStudy.Description')}
          onClick={openLevelStudy}
          preview={
            <WelcomeLevelPreview
              pending={levelStudyPending()}
              coverage={levelCoverage()}
              active={levelChips().active}
              chips={levelChips().chips}
              titleLabel={t('mlearn.LevelStudy.Coverage.Title')}
              assessedLabel={t('mlearn.LevelStudy.Coverage.Assessed')}
              knownLabel={t('mlearn.LevelStudy.LevelCard.Known')}
              emptyLabel={t('mlearn.Home.Cards.LevelStudy.Description')}
              onOpen={openLevelStudy}
            />
          }
        />
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
              loading={flashcards.isLoading() || !flashcards.isKnowledgeReady()}
              dueCount={flashcards.queueCounts().total}
              dueLabel={t('mlearn.Flashcards.Statistics.DueToday')}
              emptyLabel={t(Object.keys(flashcards.store.flashcards).length > 0
                ? 'mlearn.Flashcards.EmptyState.NoCardsDueTitle'
                : 'mlearn.Flashcards.EmptyState.NoCardsTitle')}
              loadingLabel={t('mlearn.Global.Loading')}
              openLabel={t('mlearn.Global.Continue')}
              keyboardMode={settings.ratingKeyboardMode}
              onOpen={openFlashcards}
              onRate={rateCard}
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
          icon={<BotIcon size={24} />}
          title={t('mlearn.Home.Cards.AITutor.Title')}
          description={isLLMReady(settings)
            ? t('mlearn.Home.Cards.AITutor.Description')
            : t('mlearn.Home.Cards.AITutor.SetupRequiredDescription')}
          onClick={openAITutor}
          class="welcome-ai-tutor-card"
          preview={
            <WelcomeTutorPreview
              ready={isLLMReady(settings)}
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
          </section>
        }
      >
        <section class="welcome-actions welcome-actions--simple">
          <ActionCard
            icon={<TargetIcon size={24} />}
            title={t('mlearn.Home.Cards.LevelStudy.Title')}
            description={t('mlearn.Home.Cards.LevelStudy.Description')}
            onClick={openLevelStudy}
            primary
          />

          <ActionCard
            icon={<VideoIcon size={24} />}
            title={t('mlearn.Home.Cards.Video.Title')}
            description={t('mlearn.Home.Cards.Video.Description')}
            onClick={openVideoPlayer}
          />

          <ActionCard
            icon={<BookIcon size={24} />}
            title={t('mlearn.Home.Cards.Reader.Title')}
            description={t('mlearn.Home.Cards.Reader.Description')}
            onClick={openReader}
          />

          <ActionCard
            icon={<Icon icon="cards" color="currentColor" class="" />}
            title={t('mlearn.Home.Cards.Flashcards.Title')}
            description={t('mlearn.Home.Cards.Flashcards.Description')}
            onClick={openFlashcards}
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
            icon={<BotIcon size={24} />}
            title={t('mlearn.Home.Cards.AITutor.Title')}
            description={
              isLLMReady(settings)
                ? t('mlearn.Home.Cards.AITutor.Description')
                : t('mlearn.Home.Cards.AITutor.SetupRequiredDescription')
            }
            onClick={openAITutor}
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
