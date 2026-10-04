import { eligibleReviewActivities, renderableReviewActivities } from '../../../components/flashcard/reviewActivities';
import { discoverReviewRecordings } from '../../../services/reviewRecordings';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { useLearningModel } from '../../../hooks/useLearningModel';
import { policyContextFromSettings } from '../../../learning/policyContext';
import { forecastPreparationOffThread } from '../../../services/learningPreparationForecast';
import { chooseHomeOffThread, type HomeChoice } from '../../../services/homeLearningChoice';
import { homePracticePool, type HomeLearningCandidate } from './homeLearningDecision';
import { forecastScopeWorkload } from '../../../../shared/learningWorkload';
import { inferLearningOpportunities } from '../../../../shared/learningOpportunities';
import { learningAddress, type LearningAction } from '../../../../shared/learningModel';
import { surfaceEntityId, grammarEntityId } from '../../../../shared/graph/load';
import { GRAMMAR_SELF_ASSESS_TASK } from '../../levelStudy/grammarSelfAssessmentDecision';
import { hashWordSync } from '../../../services/srsAlgorithm';
import { flashcardReviewPolicyEntry } from '../../../components/flashcard/flashcardReviewDecision';
import { resolveLearningOutcome } from '../../../../shared/learningOutcomes';
import type { LearningDecision } from '../../../../shared/learningDecision';
import type { MediaStats } from '../../../../shared/types';
import { type Component, createEffect, createMemo, createResource, createSignal, For, onMount, onCleanup, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../../context';
import { useEvidenceLinkedProjections } from '../../../hooks/useEvidenceLinkedProjections';
import { eventsVersion } from '../../../services/knowledgeEvents';
import { useWindowActivity } from '../../../hooks/useWindowActivity';
import { grammarEvidenceKey } from '../../../../shared/grammar/evidence';
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
import { getTestedAccesses, getLearningLanguageLevelForLanguage, isFrequencyLevelAtOrEasierThanTarget } from '../../../../shared/languageFeatures';
import { effectiveThresholds } from '../../../../shared/knowledge/effectiveKnowledge';
import { selectWeekStats } from './welcomeSelectors';
import { getLocalizedLanguageName } from '../../../utils/languageDisplayName';
import { formatDate } from '../../../utils/timeFormatting';
import { getLogger } from '../../../../shared/utils/logger';
import { homeGrammarResume } from './homeGrammarResume';
import { homePracticeResume } from './homePracticeResume';
import { activeLearningGoals, learningGoalsForSettings } from '../../../../shared/learningGoals';
import { reviewSessionHasAvailableCards, reviewCardAvailableNow } from '../../../../shared/reviewSession';
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
  const learning = useLearningModel(() => settings.language);
  const [mediaStats, setMediaStats] = createSignal<MediaStats[]>([]);
  const [starting, setStarting] = createSignal(false);
  const [decisionTime, setDecisionTime] = createSignal(Date.now());
  onMount(() => {
    const media = getBridge().mediaStats;
    const cleanup = media.onMediaStatsList(setMediaStats);
    onCleanup(cleanup);
    media.listMediaStats();
  });
  const [recentItems, setRecentItems] = createSignal<RecentItem[]>([]);
  const [grammarResume, setGrammarResume] = createSignal<ReturnType<typeof homeGrammarResume>>(null);
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
  const goalScopes = createMemo(() => new Map(goals().map(goal => [goal.id,
    goal.outcomeRef ? resolveLearningOutcome(language.currentLangData(), goal.outcomeRef.id) : null])));
  const goalWords = createMemo(() => [...new Set(goals().flatMap(goal => goalScopes().get(goal.id)?.words ?? goal.scope?.words ?? []))]);
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
  const active = useWindowActivity();
  const requiresGrammarWorkload = createMemo(() => goals().some(goal => goal.deadline && Date.parse(goal.deadline) > decisionTime()
    && (goalScopes().get(goal.id)?.patterns.length ?? 0) > 0));
  let grammarWasActive = false;
  let grammarAdmission = 0;
  const grammarWorkloadRequest = createMemo<{ language: string; version: number; admission: number } | undefined>(previous => {
    if (!active()) { grammarWasActive = false; return previous; }
    if (!grammarWasActive) grammarAdmission++;
    grammarWasActive = true;
    return requiresGrammarWorkload() && flashcards.isKnowledgeReady() && !language.isLoading()
      ? { language: settings.language, version: eventsVersion(), admission: grammarAdmission } : undefined;
  }, undefined, { equals: (a, b) => a?.language === b?.language && a?.version === b?.version && a?.admission === b?.admission });
  const [grammarWorkloadProjections, { refetch: retryGrammarWorkload }] = createResource(grammarWorkloadRequest,
    request => getBridge().knowledgeEvents.getGrammarProjections(request.language));
  const grammarWorkloadReady = () => !requiresGrammarWorkload() || grammarWorkloadProjections.state === 'ready';
  const evidenceReady = () => learning.ready() && (grammarWorkloadReady() || resumableGrammar() || resumablePractice() || resumableReview()) && materialReady() && !flashcards.isLoading() && flashcards.isKnowledgeReady()
    && !language.isLoading() && (!(levelStudySource() || goalWords().length) || curriculumProjection.ready());
  const refreshResume = () => {
    setDecisionTime(Date.now());
    setPracticeResume(homePracticeResume(localStorage, { language: settings.language,
      provider: settings.frequencyProviderSelections?.[settings.language], packageVersion: language.currentLangData()?.languageData?.version }));
    setGrammarResume(homeGrammarResume(localStorage, settings.language, language.currentLangData()));
  };
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
  const resumableGrammar = () => Boolean(grammarResume() && (!resumableReview()
    || grammarResume()!.at > (flashcards.store.meta?.reviewPresentations?.[settings.language]?.decision?.at
      ?? flashcards.store.meta?.reviewSessions?.[settings.language]?.startedAt ?? 0))
    && (!practiceResume() || grammarResume()!.at > practiceResume()!.at));
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
  const practiceScopeIndex = createMemo(() => new Map((goalWords().length ? goalWords() : Object.keys(levelStudySource()?.freq ?? {}))
    .map(word => [surfaceEntityId(settings.language, hashWordSync(word)), word])));
  const goalWork = createMemo(() => goalWords().filter(word => curriculumProjection.resolveState(word).status !== 'known'));
  const deadlineWorkloads = createMemo(() => {
    const model = learning.model();
    if (!evidenceReady() || !grammarWorkloadReady() || !recordingsReady() || !model) return [];
    const opportunities = inferLearningOpportunities(learning.snapshot()!.events, decisionTime());
    return goals().flatMap(goal => {
      const deadline = goal.deadline ? Date.parse(goal.deadline) : NaN;
      if (!Number.isFinite(deadline) || deadline <= decisionTime()) return [];
      const resolved = goalScopes().get(goal.id);
      const pending = [...new Set(resolved?.words ?? goal.scope?.words ?? [])]
        .filter(word => curriculumProjection.resolveState(word).basis === 'unmeasured');
      const grammar = (resolved?.patterns ?? []).filter(pattern => !grammarWorkloadProjections()?.[
        grammarEvidenceKey(settings.language, pattern, 'grammar-recognition')]?.hasActiveEvidence);
      return [{ goalId: goal.id, ...forecastScopeWorkload(model, { items: [
        ...pending.map(word => ({ id: surfaceEntityId(settings.language, hashWordSync(word)), family: 'word-sync' })),
        ...grammar.map(pattern => ({ id: grammarEntityId(settings.language, pattern), family: GRAMMAR_SELF_ASSESS_TASK.taskTemplateId })),
      ] }, opportunities, decisionTime(), deadline) }];
    });
  });
  const deadlineWarnings = createMemo(() => Object.fromEntries(deadlineWorkloads()
    .filter(workload => workload.status === 'one-pass-exceeds-opportunity-scenarios').map(workload => [workload.goalId, true])));
  const reviewCandidates = createMemo(() => {
    const queue = flashcards.queue();
    return [...new Set([...queue.newQueue, ...queue.scheduledQueue])].map(id => flashcards.store.flashcards[id])
      .filter(card => reviewCardAvailableNow(card, flashcards.store, settings.language, decisionTime()));
  });
  const recordingRequest = createMemo(() => active() && !resumableGrammar() && !resumablePractice() && !resumableReview()
    && (settings.reviewActivities ?? DEFAULT_SETTINGS.reviewActivities).audio && !settings.flashcardMuteAudio
    ? JSON.stringify([settings.language, reviewCandidates().map(card => [card.id, card.lastUpdated]), eventsVersion()]) : undefined);
  let recordingController: AbortController | undefined;
  const [reviewRecordings, { refetch: retryReviewRecordings }] = createResource(recordingRequest, async request => {
    recordingController?.abort(); recordingController = new AbortController();
    const [, cards] = JSON.parse(request) as [string, Array<[string, number]>];
    return discoverReviewRecordings(cards.map(([id]) => id), id => getBridge().flashcards.getFlashcardTts(id, 'word'), recordingController.signal);
  });
  createEffect(() => { if (!recordingRequest()) recordingController?.abort(); });
  onCleanup(() => recordingController?.abort());
  const recordingsReady = () => !recordingRequest() || reviewRecordings.state === 'ready';
  const desiredHomeChoiceInput = createMemo(() => {
    if (!active() || resumableGrammar() || resumablePractice() || resumableReview()) return undefined;
    const model = learning.model();
    if (!evidenceReady() || !grammarWorkloadReady() || !recordingsReady() || !model) return undefined;
    const context = policyContextFromSettings(settings, settings.language, { model, events: learning.snapshot()!.events, data: language.currentLangData(), nowMs: decisionTime() });
    const opportunities = inferLearningOpportunities(learning.snapshot()!.events, decisionTime());
    const candidates: HomeLearningCandidate[] = [];
    for (const card of reviewCandidates()) {
      const preferences = settings.reviewActivities ?? DEFAULT_SETTINGS.reviewActivities;
      const activities = renderableReviewActivities(eligibleReviewActivities(card, language.currentLangData(), preferences,
        !settings.flashcardMuteAudio && reviewRecordings()?.[card.id] === true, {
          focused: t('mlearn.Flashcards.Review.Focused'), focusedTarget: t('mlearn.Knowledge.Capability.prosodic-pattern'),
          focusedPrompt: target => t('mlearn.Flashcards.Review.FocusedPrompt', { target }),
          audio: t('mlearn.Flashcards.Review.Audio'), audioPrompt: t('mlearn.Flashcards.Review.AudioPrompt'),
        }), card, language.currentLangData());
      for (const activity of activities) {
        const entry = flashcardReviewPolicyEntry(card, settings.language, language.currentLangData(), activity);
        const measured = entry.task?.responseModality === 'recall' ? entry.targets.find(target => !entry.task!.supplied.includes(target.capability)) : undefined;
        candidates.push({ key: `review:${card.id}:${activity.id}`, action: 'review', cardId: card.id,
          reviewActivityId: activity.id, retrievalTask: entry.task!, presentation: entry.presentation,
          family: entry.task!.taskTemplateId, mode: 'practice', targets: entry.targets,
          ...(measured ? { measurement: { address: learningAddress(measured), provenance: 'Prospective unassisted self-reported recall in the offered review task. Supplied accesses excluded; assisted answers remain excluded by canonical evidence admission.' } } : {}) });
      }
    }
    const words = goalWords().length ? goalWork() : Object.keys(levelStudySource()?.freq ?? {})
      .filter(word => curriculumProjection.resolveState(word).status !== 'known');
    const pool = homePracticePool(model, practiceScopeIndex(), words,
      word => curriculumProjection.resolveState(word).status === 'known', decisionTime(),
      context.learning!.assessmentAt ?? decisionTime() + context.learning!.horizonDays * 86_400_000);
    for (const { word, intent } of pool) {
      // Handoff forecasts use the same package-owned accesses as the actual
      // word prompt, without assuming dictionary reading/prosody availability.
      const targets = getTestedAccesses({ languageData: language.currentLangData(), surface: word,
        hasReadingData: false, hasProsodyData: false }).map(capability => ({ entityId: surfaceEntityId(settings.language, hashWordSync(word)), capability }));
      if (targets.length) candidates.push({ key: `practice:${word}`, action: 'practice', family: 'word-sync', mode: 'practice',
        targets, ...(intent ? { intent } : {}), words: [word], measurement: { address: learningAddress(targets[0]),
          provenance: 'Prospective self-reported recall before the existing Word Sync reveal. Actual requested accesses and assistance are frozen by its admission; placement and legacy familiarity ratings are not recalled outcomes.' } });
    }
    const patterns = [...new Set(goals().flatMap(goal => goalScopes().get(goal.id)?.patterns ?? []))];
    for (const pattern of patterns) {
      const target = { entityId: grammarEntityId(settings.language, pattern), capability: 'grammar-recognition' };
      candidates.push({ key: `grammar:${pattern}`, action: 'grammar', family: GRAMMAR_SELF_ASSESS_TASK.taskTemplateId, mode: 'practice',
        targets: [target], patterns: [pattern], measurement: { address: learningAddress(target),
          provenance: 'Prospective self-reported recall before the existing grammar reveal; explicit method=recall producer. Not independently scored assessment performance.' } });
    }
    const recent = recentItems()[0];
    if (recent) {
      // This bridge is lexical access in selected content, not global comprehension or exam section performance.
      const stats = mediaStats().find(item => item.language === settings.language && item.mediaName === recent.name);
      const recurring = Object.values(stats?.wordsEncountered ?? {}).filter(item => item.timesSeen > 1).slice(0, 8);
      candidates.push({ key: `continue:${recent.path}`, action: 'continue', family: recent.type === 'book' ? 'reader' : 'video', mode: 'immersion',
        targets: recurring.map(item => ({ entityId: surfaceEntityId(settings.language, hashWordSync(item.word)), capability: 'surface-recognition' })),
        durationSeconds: 120,
        ...(recurring.length ? { transfer: { probability: 0.1, sensitivity: [0, 0.1, 0.3],
          provenance: 'Unfitted incidental lexical-learning prior. Waring & Takaki 2003 supports small, access-dependent, delayed reading gains; these rates are engineering assumptions, not transferred fitted coefficients. Upcoming recurrence in the selected content is uncertain. Passive exposure is not evidence of comprehension.' } } : {}) });
    }
    return { model, candidates, context: { nowMs: decisionTime(), horizonDays: context.learning!.horizonDays,
      deferDays: context.learning!.deferDays, targetWeights: context.learning!.targetWeights, assessmentAt: context.learning!.assessmentAt }, opportunities, preparationTasks: () => {
        // Resolve runnable tasks from the same installed scope/access declarations as
        // actual handoffs. Construct only at forecast admission, not each Home render.
        const tasks: LearningAction[] = [];
        for (const word of goalWords()) {
          const targets = getTestedAccesses({ languageData: language.currentLangData(), surface: word,
            hasReadingData: false, hasProsodyData: false }).map(capability => ({
              entityId: surfaceEntityId(settings.language, hashWordSync(word)), capability }));
          if (targets.length) tasks.push({ key: `practice:${word}`, family: 'word-sync', mode: 'practice', targets });
        }
        for (const pattern of patterns) tasks.push({ key: `grammar:${pattern}`, family: GRAMMAR_SELF_ASSESS_TASK.taskTemplateId, mode: 'practice',
          targets: [{ entityId: grammarEntityId(settings.language, pattern), capability: 'grammar-recognition' }] });
        return tasks;
      }, deadlineWorkloads: deadlineWorkloads() };
  });
  const homeChoiceInput = createMemo<ReturnType<typeof desiredHomeChoiceInput>>(previous => active() ? desiredHomeChoiceInput() : previous);
  let homeChoiceController: AbortController | undefined;
  let homeDisposed = false;
  const assembleHomeChoice = (input: NonNullable<ReturnType<typeof desiredHomeChoiceInput>>, chosen: HomeChoice) => ({
    ...chosen, candidatesOmitted: 0, trace: { ...chosen.trace, deadlineWorkloads: input.deadlineWorkloads },
    preparationForecast: () => forecastPreparationOffThread(input.model, input.candidates, chosen.selected,
      input.context, input.opportunities, input.preparationTasks()),
  });
  let pendingHomeChoice: Promise<ReturnType<typeof assembleHomeChoice>> | undefined;
  const [homeChoice, { refetch: retryHomeChoice }] = createResource(homeChoiceInput, input => {
    homeChoiceController?.abort();
    homeChoiceController = new AbortController();
    pendingHomeChoice = chooseHomeOffThread([input.model, input.candidates, input.context, input.opportunities.availableSeconds], homeChoiceController.signal)
      .then(choice => assembleHomeChoice(input, choice));
    return pendingHomeChoice;
  });
  createEffect(() => { if (!homeChoiceInput()) homeChoiceController?.abort(); });
  onCleanup(() => { homeDisposed = true; homeChoiceController?.abort(); });
  const homeDecision = () => homeChoice.state === 'ready' ? homeChoice() : undefined;
  const ready = () => evidenceReady() && (resumableGrammar() || resumablePractice() || resumableReview() || homeChoice.state === 'ready');
  const next = createMemo<'review' | 'practice' | 'continue' | 'read'>(() => {
    if (resumableGrammar()) return 'practice';
    if (resumablePractice()) return 'practice';
    if (resumableReview()) return 'review';
    const action = homeDecision()?.selected.action;
    return action === 'grammar' ? 'practice' : action ?? (recentItems().length ? 'continue' : 'read');
  });
  const nextCopy = () => {
    const keys = {
      review: ['ReviewTitle', 'ReviewReason', 'ReviewAction'],
      practice: ['PracticeTitle', 'PracticeReason', 'PracticeAction'],
      assessment: ['AssessmentTitle', 'AssessmentReason', 'AssessmentAction'],
      continue: ['ContinueTitle', 'ContinueReason', 'ContinueAction'],
      read: ['ReadTitle', 'ReadReason', 'ReadAction'],
    } as const;
    const params = { count: String(next() === 'review' ? dueCount() : next() === 'practice' ? goalWork().length || summary().needsPractice || Math.min(summary().unassessed, homeDecision()?.encounterLimit ?? 1) : summary().unassessed),
      material: recentItems()[0]?.name ?? '' };
    if (next() === 'practice' && !resumableGrammar() && homeDecision()?.selected.action !== 'grammar' && !summary().needsPractice && !goalWork().length) return [
      t('mlearn.Home.Today.DiscoverTitle'), t('mlearn.Home.Today.DiscoverReason', params), t('mlearn.Home.Today.PracticeAction')];
    return keys[next()].map(key => t(`mlearn.Home.Today.${key}`, params));
  };
  const startNext = async () => {
    if (starting()) return;
    refreshResume();
    if (resumableGrammar()) { getBridge().window.openWindow({ type: 'level-study', context: { ...grammarResume()!.context, returnTo: 'home' } }); return; }
    if (resumablePractice()) { getBridge().window.openWindow({ type: 'level-study', context: { ...practiceResume()!.context, returnTo: 'home' } }); return; }
    if (resumableReview()) { openFlashcards(); return; }
    const admittedInput = homeChoiceInput();
    if (!admittedInput || !pendingHomeChoice) return;
    setStarting(true);
    try {
      const chosen = await pendingHomeChoice;
      if (homeDisposed || admittedInput !== homeChoiceInput()) return;
      const selected = chosen.selected;
      const selectedLanguage = settings.language;
      const selectedLabel = goals()[0]?.outcome || t('mlearn.Goals.Purpose');
      const selectedMaterial = recentItems().find(item => selected.key === `continue:${item.path}`);
      const preparationForecast = await chosen.preparationForecast();
      if (homeDisposed || admittedInput !== homeChoiceInput()) return;
      const provenance: LearningDecision = { id: crypto.randomUUID(), at: Date.now(), policyVersion: 'home-learning-controller@13',
        selected: { key: selected.key, action: selected.action,
          ...(selected.action === 'review' ? { presentation: { ...selected.presentation, reviewActivityId: selected.reviewActivityId, retrievalTask: selected.retrievalTask } } : {}), targets: selected.targets.map(target => ({ kind: selected.action === 'grammar' ? 'grammar-pattern' : 'surface', id: target.entityId, capability: target.capability })),
          task: { taskTemplateId: selected.family, inputModality: 'activity-handoff', responseModality: 'none', supplied: [],
            requested: selected.targets.map(target => target.capability), fluencyRequired: false, ratingMode: 'profile' } },
        baseline: null, detail: { homeController: { ...chosen.trace, preparationForecast }, candidatesOmitted: chosen.candidatesOmitted,
          scope: 'activity-handoff-only', limitation: 'Actual retrieval is separately pinned by the existing activity before presentation.' } };
      await getBridge().knowledgeEvents.recordLearningDecision(provenance);
      if (homeDisposed || admittedInput !== homeChoiceInput()) return;
      const session = { requestId: provenance.id, encounterLimit: chosen.encounterLimit };
      switch (selected.action) {
        case 'review': getBridge().window.openWindow({ type: 'flashcards', context: { activity: 'review', session: { ...session, initialCardId: selected.cardId, decision: provenance } } }); break;
        case 'grammar': getBridge().window.openWindow({ type: 'level-study', context: { activity: 'grammar', patterns: selected.patterns, returnTo: 'home', session: { ...session, decision: provenance } } }); break;
        case 'practice': getBridge().window.openWindow({ type: 'level-study', context: { activity: selected.intent ?? 'practice', returnTo: 'home', session,
          ...(selected.words?.length ? { material: { language: selectedLanguage, label: selectedLabel, words: [...selected.words] } } : {}) } }); break;
        case 'continue': if (selectedMaterial) openRecent(selectedMaterial); break;
        case 'read': openReader(); break;
      }
    } catch (error) { if (homeDisposed || admittedInput !== homeChoiceInput()) return; log.error('Learning handoff refused:', error); showToast({ message: t('mlearn.WordSync.ProjectionUnavailable'), variant: 'error' }); }
    finally { setStarting(false); }
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
        <LearningGoals coverage={goalCoverage()} deadlineWarnings={deadlineWarnings()} />
        <div class="welcome-workspace">
          <Panel class="welcome-next" padding="lg">
            <span class="welcome-section-label">{t('mlearn.Home.Today.Next')}</span>
            <Show when={ready()} fallback={
              <Show when={!curriculumProjection.failed() && !learning.failed() && grammarWorkloadProjections.state !== 'errored' && homeChoice.state !== 'errored' && reviewRecordings.state !== 'errored'} fallback={
                <div role="alert"><p>{t('mlearn.WordSync.ProjectionUnavailable')}</p>
                  <Button onClick={() => { curriculumProjection.retry(); learning.retry(); void retryGrammarWorkload(); void retryHomeChoice(); void retryReviewRecordings(); }}>{t('mlearn.Knowledge.Retry')}</Button></div>
              }><SkeletonRows rows={2} /></Show>
            }>
              <h2>{nextCopy()[0]}</h2><p class="welcome-next-reason">{nextCopy()[1]}</p>
              <Button variant="primary" size="lg" disabled={starting()} onClick={startNext}>{(resumableGrammar() || resumablePractice() || resumableReview()) ? t('mlearn.StudyEncounter.Resume') : nextCopy()[2]}</Button>
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
