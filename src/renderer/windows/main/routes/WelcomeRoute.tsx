import { type Component, createEffect, createMemo, createSignal, For, onMount, onCleanup, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../../context';
import { useEvidenceLinkedProjections } from '../../../hooks/useEvidenceLinkedProjections';
import { getBridge } from '../../../../shared/bridges';
import { isMobile } from '../../../../shared/platform';
import { WindowDragRegion } from '../../../components/utils/WindowDragRegion';
import { Button, Panel, SkeletonRows, VideoIcon, BookIcon, BotIcon, TargetIcon, SearchIcon, BarChartIcon, LanguageVariantGate, LearningGoals } from '../../../components/common';
import AppLogo from '@renderer/components/common/Misc/AppLogo';
import { WelcomeContinueRow } from './components';
import { getRecentItems, type RecentItem } from '../../../services/thumbnailService';
import { isLLMReady } from '../../../services/llmProvider';
import { notifyCapabilityUnavailable, openCapabilitySettings } from '../../../services/capabilityUnavailable';
import { showToast } from '../../../components/common/Feedback/Toast';
import { computeLevelStats, getLevelStudyFrequency, getLevelStudyLevelNames, summarizeLevelProgress } from '../../../utils/wordLevelStats';
import { getLearningLanguageLevelForLanguage, isFrequencyLevelAtOrEasierThanTarget } from '../../../../shared/languageFeatures';
import { effectiveThresholds } from '../../../../shared/knowledge/effectiveKnowledge';
import { selectWeekStats } from './welcomeSelectors';
import { getLocalizedLanguageName } from '../../../utils/languageDisplayName';
import { formatDate } from '../../../utils/timeFormatting';
import { getLogger } from '../../../../shared/utils/logger';
import { homePracticeResume } from './homePracticeResume';
import { homeNextAction } from './homeNextAction';
import { activeLearningGoals, learningGoalsForSettings, goalSessionBudget } from '../../../../shared/learningGoals';
import { reviewSessionHasAvailableCards, reviewCardAvailableNow } from '../../../../shared/reviewSession';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import './welcome.css';

const log = getLogger('renderer.welcome');
const OPEN_VIDEO_SESSION_KEY = 'mlearn_open_video';
const OPEN_VIDEO_SUBTITLE_SESSION_KEY = 'mlearn_open_video_subtitles';

export const WelcomeRoute: Component = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const language = useLanguage();
  const flashcards = useFlashcards();
  const [recentItems, setRecentItems] = createSignal<RecentItem[]>([]);
  const [practiceResume, setPracticeResume] = createSignal<ReturnType<typeof homePracticeResume>>(null);
  const [materialReady, setMaterialReady] = createSignal(false);
  onMount(async () => {
    try { setRecentItems(await getRecentItems()); }
    catch (error) { log.error('Failed to load recent items:', error); }
    finally { setMaterialReady(true); }
  });
  const openVideoPlayer = () => navigate('/video');
  const openReader = () => navigate('/reader');
  const openSettings = () => getBridge().window.openWindow({ type: 'settings' });
  const openFlashcards = () => getBridge().window.openWindow({ type: 'flashcards' });
  const openStatistics = () => isMobile() ? navigate('/statistics') : getBridge().window.openWindow({ type: 'statistics' });
  const openWordDatabase = () => isMobile() ? navigate('/word-db-editor') : getBridge().window.openWindow({ type: 'word-db-editor' });
  const openLevelStudy = (activity: 'plan' | 'assessment' | 'practice' | 'reinforce' = 'plan') =>
    getBridge().window.openWindow({ type: 'level-study', context: { activity } });
  const openAITutor = () => {
    if (!isLLMReady(settings)) {
      notifyCapabilityUnavailable('llm', 'notConfigured', t);
      openCapabilitySettings('llm');
      return;
    }
    if (isMobile()) navigate('/conversation-agent');
    else getBridge().window.openWindow({ type: 'conversation-agent' });
  };
  const openRecent = (item: RecentItem) => {
    // Don't try to open items with no path (legacy items or failed saves)
    if (!item.path || !item.path.trim()) {
      log.warn('[Welcome] Cannot open recent item - no path saved:', item.name);
      // Explain, then navigate to the route that can accept the file. The
      // toast host sits above the route outlet, so the message survives the
      // navigation - which an `alert` was only doing by blocking the window
      // until it was dismissed.
      showToast({ message: t('mlearn.Home.Errors.UnableToOpen'), variant: 'error' });
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

  const goals = createMemo(() => activeLearningGoals(learningGoalsForSettings(settings), settings.language));
  const goalWords = createMemo(() => [...new Set(goals().flatMap(goal => goal.scope?.words ?? []))]);
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
  const curriculumProjection = useEvidenceLinkedProjections(() => !flashcards.isLoading() && flashcards.isKnowledgeReady() && !language.isLoading() && (levelStudySource() || goalWords().length) ? {
    language: settings.language,
    surfaces: [...new Set([...Object.keys(levelStudySource()?.freq ?? {}), ...goalWords()])],
    materializedKeys: Object.keys(flashcards.store.wordKnowledge),
  } : undefined);
  // Do not recommend an activity from an intermediate learner snapshot.
  const levelStudyPending = createMemo(() => (
    flashcards.isLoading() || !flashcards.isKnowledgeReady() || language.isLoading() || ((Boolean(levelStudySource()) || goalWords().length > 0) && !curriculumProjection.ready())
  ));
  const levelStudy = createMemo(() => {
    if (levelStudyPending()) return null;
    const source = levelStudySource();
    if (!source) return null;
    const stats = computeLevelStats(
      flashcards.store,
      source.freq,
      settings.language,
      effectiveThresholds(settings),
      source.levelNames,
      source.langData,
      undefined,
      curriculumProjection.resolveState,
    );
    if (stats.length === 0) return null;
    return { levels: stats };
  });
  const levelProgress = createMemo(() => {
    const data = levelStudy();
    if (data === null) return null;
    const examLevel = getLearningLanguageLevelForLanguage(settings, settings.language || null);
    const scoped = examLevel === null
      ? data.levels
      : data.levels.filter((level) => (
        isFrequencyLevelAtOrEasierThanTarget(level.level, examLevel, language.currentLangData())
      ));
    return summarizeLevelProgress(scoped);
  });
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
  const formatLastWatched = (timestamp: number) => {
    try {
      const days = Math.round((timestamp - Date.now()) / 86_400_000);
      return new Intl.RelativeTimeFormat(settings.uiLanguage, { numeric: 'auto' }).format(days, 'day');
    } catch {
      return formatDate(timestamp, settings.uiLanguage);
    }
  };


  const dueCount = createMemo(() => {
    const queue = flashcards.queue();
    return [...new Set([...queue.newQueue, ...queue.scheduledQueue])].filter(id =>
      reviewCardAvailableNow(flashcards.store.flashcards[id], flashcards.store, settings.language)).length;
  });
  const summary = createMemo(() => {
    const progress = levelProgress();
    return {
      assessed: progress?.tracked ?? 0,
      known: progress?.known ?? 0,
      needsPractice: progress ? progress.tracked - progress.known : 0,
      unassessed: progress ? progress.total - progress.tracked : 0,
    };
  });
  const ready = () => materialReady() && !flashcards.isLoading() && flashcards.isKnowledgeReady()
    && !language.isLoading() && (!(levelStudySource() || goalWords().length) || curriculumProjection.ready());
  const refreshResume = () => setPracticeResume(homePracticeResume(localStorage, { language: settings.language,
    provider: settings.frequencyProviderSelections?.[settings.language], packageVersion: language.currentLangData()?.languageData?.version }));
  createEffect(refreshResume);
  onMount(() => { refreshResume(); window.addEventListener('focus', refreshResume); window.addEventListener('storage', refreshResume); });
  onCleanup(() => { window.removeEventListener('focus', refreshResume); window.removeEventListener('storage', refreshResume); });
  const resumableReview = () => {
    const session = flashcards.store.meta?.reviewSessions?.[settings.language];
    return Boolean(session && reviewSessionHasAvailableCards(session, flashcards.store, settings.language));
  };
  const resumablePractice = () => Boolean(practiceResume() && (!resumableReview()
    || practiceResume()!.at > (flashcards.store.meta?.reviewPresentations?.[settings.language]?.decision?.at
      ?? flashcards.store.meta?.reviewSessions?.[settings.language]?.startedAt ?? 0)));
  const goalCoverage = createMemo(() => curriculumProjection.ready() ? Object.fromEntries(goals().map(goal => {
    const counts = { known: 0, learning: 0, unmeasured: 0 };
    for (const word of new Set(goal.scope?.words ?? [])) {
      const state = curriculumProjection.resolveState(word);
      if (state.basis === 'unmeasured') counts.unmeasured++;
      else if (state.status === 'known') counts.known++;
      else counts.learning++;
    }
    return [goal.id, counts];
  })) : undefined);
  const goalWork = createMemo(() => goalWords().filter(word => curriculumProjection.resolveState(word).status !== 'known'));
  const next = createMemo(() => resumablePractice() ? 'practice' : resumableReview() ? 'review' : goalWords().length && dueCount() === 0 ? (goalWork().length ? 'practice' : recentItems().length ? 'continue' : 'read') : homeNextAction({ ...summary(), due: dueCount(), hasMaterial: recentItems().length > 0 }));
  const nextCopy = () => {
    const keys = {
      review: ['ReviewTitle', 'ReviewReason', 'ReviewAction'],
      practice: ['PracticeTitle', 'PracticeReason', 'PracticeAction'],
      assessment: ['AssessmentTitle', 'AssessmentReason', 'AssessmentAction'],
      continue: ['ContinueTitle', 'ContinueReason', 'ContinueAction'],
      read: ['ReadTitle', 'ReadReason', 'ReadAction'],
    } as const;
    const params = { count: String(next() === 'review' ? dueCount() : next() === 'practice' ? goalWork().length || summary().needsPractice || Math.min(summary().unassessed, goalSessionBudget(settings.learningMinutes ?? DEFAULT_SETTINGS.learningMinutes)) : summary().unassessed),
      material: recentItems()[0]?.name ?? '' };
    if (next() === 'practice' && !summary().needsPractice && !goalWork().length) return [
      t('mlearn.Home.Today.DiscoverTitle'), t('mlearn.Home.Today.DiscoverReason', params), t('mlearn.Home.Today.PracticeAction')];
    return keys[next()].map(key => t(`mlearn.Home.Today.${key}`, params));
  };
  const startNext = () => {
    if (resumablePractice()) { getBridge().window.openWindow({ type: 'level-study', context: { ...practiceResume()!.context, returnTo: 'home' } }); return; }
    const session = { requestId: crypto.randomUUID(), minutes: settings.learningMinutes ?? DEFAULT_SETTINGS.learningMinutes, encounterLimit: goalSessionBudget(settings.learningMinutes ?? DEFAULT_SETTINGS.learningMinutes) };
    switch (next()) {
      case 'review': getBridge().window.openWindow({ type: 'flashcards', context: { activity: 'review', session } }); break;
      case 'practice': getBridge().window.openWindow({ type: 'level-study', context: { activity: goalWork().length || summary().needsPractice > 0 ? 'reinforce' : 'practice', returnTo: 'home', session, ...(goalWords().length ? { material: { language: settings.language, label: goals()[0]?.outcome || t('mlearn.Goals.Purpose'), words: goalWords() } } : {}) } }); break;
      case 'assessment': openLevelStudy('assessment'); break;
      case 'continue': { const item = recentItems()[0]; if (item) openRecent(item); break; }
      case 'read': openReader(); break;
    }
  };
  return (
    <main class="welcome-container">
      <LanguageVariantGate />
      <WindowDragRegion />
      <div class="welcome-page">
        <header class="welcome-header">
          <div class="welcome-logo"><AppLogo size="1.75rem" /><span>{t('mlearn.Global.AppName')}</span></div>
          <div class="welcome-subtitle">
            <span><Show when={language.currentLangData()?.flagEmoji}>{flag => <span class="welcome-language-flag" aria-hidden="true">{flag()}</span>}</Show>
              {t('mlearn.Home.UI.LearningLanguage', { language: getLanguageName() })}</span>
            <Button variant="ghost" size="sm" onClick={openSettings}>{t('mlearn.Home.Cards.Settings.Title')}</Button>
          </div>
        </header>
        <nav class="welcome-activities" aria-label={t('mlearn.Home.Today.Activities')}>
          <Button variant="ghost" icon={<BookIcon size={18} />} onClick={openReader}>{t('mlearn.Home.Today.Read')}</Button>
          <Button variant="ghost" icon={<VideoIcon size={18} />} onClick={openVideoPlayer}>{t('mlearn.Home.Today.Watch')}</Button>
          <Button variant="ghost" icon={<TargetIcon size={18} />} onClick={() => openLevelStudy('practice')}>{t('mlearn.Home.Today.Practice')}</Button>
          <Button variant="ghost" icon={<BotIcon size={18} />} onClick={openAITutor}>{t('mlearn.Home.Cards.AITutor.Title')}</Button>
          <Button variant="ghost" icon={<SearchIcon size={18} />} onClick={openWordDatabase}>{t('mlearn.Home.Cards.WordDatabase.Title')}</Button>
        </nav>
        <div class="welcome-today-heading"><h1>{t('mlearn.Home.Today.Title')}</h1><p>{t('mlearn.Home.Today.Description')}</p></div>
        <LearningGoals coverage={goalCoverage()} />
        <div class="welcome-workspace">
          <Panel class="welcome-next" padding="lg">
            <span class="welcome-section-label">{t('mlearn.Home.Today.Next')}</span>
            <Show when={ready()} fallback={
              <Show when={!curriculumProjection.failed()} fallback={
                <div role="alert"><p>{t('mlearn.WordSync.ProjectionUnavailable')}</p>
                  <Button onClick={() => curriculumProjection.retry()}>{t('mlearn.Knowledge.Retry')}</Button></div>
              }><SkeletonRows rows={2} /></Show>
            }>
              <h2>{nextCopy()[0]}</h2><p class="welcome-next-reason">{nextCopy()[1]}</p>
              <Button variant="primary" size="lg" onClick={startNext}>{(resumablePractice() || resumableReview()) ? t('mlearn.StudyEncounter.Resume') : nextCopy()[2]}</Button>
            </Show>
            <Show when={!ready() || next() !== 'review'}><Button variant="ghost" size="sm" onClick={openFlashcards}>{t('mlearn.Home.Cards.Flashcards.Title')}</Button></Show>
          </Panel>
          <section class="welcome-material" aria-label={t('mlearn.Home.UI.ContinueLearning')}>
            <h2>{t('mlearn.Home.UI.ContinueLearning')}</h2>
            <Show when={materialReady()} fallback={<SkeletonRows rows={2} />}>
              <Show when={recentItems().length > 0} fallback={
                <div class="welcome-material-empty"><p>{t('mlearn.Home.Today.NoMaterial')}</p>
                  <Button onClick={openReader}>{t('mlearn.Home.Today.ReadAction')}</Button>
                  <Button variant="ghost" onClick={openVideoPlayer}>{t('mlearn.Home.Today.Watch')}</Button></div>
              }>
                <div class="welcome-continue-list"><For each={recentItems().slice(0, 3)}>{item =>
                  <WelcomeContinueRow item={item} continueLabel={t('mlearn.Global.Continue')}
                    lastWatchedLabel={formatLastWatched(item.lastWatched)} onContinue={openRecent} />
                }</For></div>
              </Show>
            </Show>
          </section>
        </div>
        <footer class="welcome-support" classList={{ 'welcome-support--compact': settings.simplifyHomeScreen }}>
          <section class="welcome-plan-summary">
            <h2>{t('mlearn.Home.Cards.LevelStudy.Title')}</h2>
            <Show when={!settings.simplifyHomeScreen}>
              <Show when={!levelStudyPending()} fallback={<p>{t('mlearn.Global.Loading')}</p>}>
                <p>{levelProgress() ? t('mlearn.Home.Today.PlanSummary', { known: String(summary().known), needsPractice: String(summary().needsPractice), unassessed: String(summary().unassessed) }) : t('mlearn.Home.Today.PlanUnmeasured')}</p>
              </Show>
            </Show>
            <Button variant="ghost" size="sm" onClick={() => openLevelStudy()}>{t('mlearn.Home.Today.ViewPlan')}</Button>
          </section>
          <section class="welcome-week-summary">
            <h2>{t('mlearn.Home.Today.ThisWeek')}</h2>
            <Show when={!settings.simplifyHomeScreen}><p>{t('mlearn.Home.Today.WeekSummary', { reviews: String(weekTotals().reviews), newCards: String(weekTotals().newCards) })}</p></Show>
            <Button variant="ghost" size="sm" icon={<BarChartIcon size={16} />} onClick={openStatistics}>{t('mlearn.Home.Cards.Statistics.Title')}</Button>
          </section>
        </footer>
      </div>
    </main>
  );
};
