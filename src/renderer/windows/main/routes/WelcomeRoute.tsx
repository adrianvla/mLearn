import { type Component, createEffect, createMemo, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { Button, BookIcon, VideoIcon, BotIcon, TargetIcon, LanguageVariantGate, LearningGoals } from '../../../components/common';
import AppLogo from '../../../components/common/Misc/AppLogo';
import { WelcomeFeatureCard, WelcomeReaderPreview, WelcomeVideoPreview } from './components';
import { getRecentItems, type RecentItem } from '../../../services/thumbnailService';
import { getLocalizedLanguageName } from '../../../utils/languageDisplayName';
import { showToast } from '../../../components/common/Feedback/Toast';
import { homeGrammarResume } from './homeGrammarResume';
import { homePracticeResume } from './homePracticeResume';
import { learningScopeForSettings } from '../../../../shared/learningScope';
import { reviewSessionHasAvailableCards } from '../../../../shared/reviewSession';
import { getLogger } from '../../../../shared/utils/logger';
import './welcome.css';

const log = getLogger('renderer.welcome');

/** Home opens identifiable activities. Selection and mutation belong to the task workspace. */
export const WelcomeRoute: Component = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { t } = useLocalization();
  const language = useLanguage();
  const flashcards = useFlashcards();
  const [recentItems, setRecentItems] = createSignal<RecentItem[]>([]);
  const [grammarResume, setGrammarResume] = createSignal<ReturnType<typeof homeGrammarResume>>(null);
  const [practiceResume, setPracticeResume] = createSignal<ReturnType<typeof homePracticeResume>>(null);
  let disposed = false;
  const refreshResume = () => {
    setGrammarResume(homeGrammarResume(localStorage, settings.language, language.currentLangData()));
    setPracticeResume(homePracticeResume(localStorage, { language: settings.language,
      provider: settings.frequencyProviderSelections?.[settings.language], packageVersion: language.currentLangData()?.languageData?.version }));
  };
  createEffect(refreshResume);
  onMount(() => {
    void getRecentItems().then(items => { if (!disposed) setRecentItems(items); }).catch(error => log.error('Recent material could not be loaded', error));
    window.addEventListener('focus', refreshResume);
    window.addEventListener('storage', refreshResume);
    onCleanup(() => { disposed = true; window.removeEventListener('focus', refreshResume); window.removeEventListener('storage', refreshResume); });
  });
  const targetScope = createMemo(() => learningScopeForSettings(settings, language.currentLangData()));
  const savedReview = createMemo(() => {
    const session = flashcards.store.meta?.reviewSessions?.[settings.language];
    if (session && reviewSessionHasAvailableCards(session, flashcards.store, settings.language)) return session;
    const presentation = flashcards.store.meta?.reviewPresentations?.[settings.language];
    const card = presentation && flashcards.store.flashcards[presentation.cardId];
    return card && !card.buried && !card.suspended && (card.language || settings.language) === settings.language ? { id: presentation!.id } : undefined;
  });
  const recent = (type: RecentItem['type']) => recentItems().find(item => item.type === type) ?? null;
  const openRecent = (item: RecentItem) => {
    const route = item.type === 'video' ? '/video' : '/reader';
    if (!item.path?.trim()) { showToast({ message: t('mlearn.Home.Errors.UnableToOpen'), variant: 'error' }); navigate(route); return; }
    if (item.type === 'video') {
      sessionStorage.setItem('mlearn_open_video', item.path);
      if (item.subtitlePath?.trim()) sessionStorage.setItem('mlearn_open_video_subtitles', item.subtitlePath);
      else sessionStorage.removeItem('mlearn_open_video_subtitles');
    } else sessionStorage.setItem('mlearn_open_book', item.path);
    navigate(route);
  };
  const resumeReview = () => getBridge().window.openWindow({ type: 'flashcards', context: {
    activity: 'review', intent: 'resume', sessionId: savedReview()?.id, returnTo: 'home',
  } });
  return <main class="welcome-container">
    <LanguageVariantGate />
    <div class="welcome-page">
      <header class="welcome-header">
        <div class="welcome-logo"><AppLogo size="1.75rem" /><h1>{t('mlearn.Global.AppName')}</h1></div>
        <span class="welcome-subtitle">{t('mlearn.Home.UI.LearningLanguage', { language: getLocalizedLanguageName(settings.language,
          language.currentLangData(), t, t('mlearn.Common.Status.Unknown'), settings.uiLanguage) })}</span>
      </header>
      <Show when={targetScope().selected}><LearningGoals compact onEdit={() => navigate('/plan')} /></Show>
      <div class="welcome-feature-grid">
        <WelcomeFeatureCard icon={<BookIcon size={22} />} title={t('mlearn.Home.Today.Read')}
          description={t('mlearn.Product.ReadDescription')} onClick={() => navigate('/reader')}
          preview={<WelcomeReaderPreview item={recent('book')} emptyLabel={t('mlearn.Product.OpenMaterial')}
            continueLabel={t('mlearn.Global.Continue')} onResume={openRecent} />} />
        <WelcomeFeatureCard icon={<VideoIcon size={22} />} title={t('mlearn.Home.Today.Watch')}
          description={t('mlearn.Product.WatchDescription')} onClick={() => navigate('/video')}
          preview={<WelcomeVideoPreview item={recent('video')} emptyLabel={t('mlearn.Product.OpenMaterial')}
            continueLabel={t('mlearn.Global.Continue')} onResume={openRecent} />} />
        <WelcomeFeatureCard icon={<BotIcon size={22} />} title={t('mlearn.Product.Messenger')}
          description={t('mlearn.Product.MessengerDescription')} onClick={() => navigate('/messenger')} />
        <WelcomeFeatureCard icon={<TargetIcon size={22} />} title={t('mlearn.Product.Practise')}
          description={t('mlearn.Flashcards.UI.Tabs.Review')} onClick={() => navigate('/practise')}
          preview={<div class="welcome-resume-actions">
            <Show when={savedReview()}><Button variant="primary" onClick={resumeReview}>{t('mlearn.StudyEncounter.Resume')} · {t('mlearn.Flashcards.UI.Tabs.Review')}</Button></Show>
            <Show when={grammarResume()}>{saved => <Button onClick={() => getBridge().window.openWindow({ type: 'level-study', context: {
              ...saved().context, intent: 'resume', returnTo: 'home',
            } })}>{t('mlearn.StudyEncounter.Resume')} · {t('mlearn.Product.GrammarPractice')}</Button>}</Show>
            <Show when={practiceResume()}>{saved => <Button onClick={() => getBridge().window.openWindow({ type: 'level-study', context: {
              ...saved().context, intent: 'resume', returnTo: 'home',
            } })}>{t('mlearn.StudyEncounter.Resume')} · {t('mlearn.Product.WordPractice')}</Button>}</Show>
          </div>} />
        <WelcomeFeatureCard icon={<TargetIcon size={22} />} title={t('mlearn.Product.Evaluate')}
          description={t('mlearn.Product.KnowledgeCheckDescription')} onClick={() => navigate('/evaluate')} />
      </div>
    </div>
  </main>;
};
