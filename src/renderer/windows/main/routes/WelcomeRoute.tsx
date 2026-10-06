import { type Component, createEffect, createMemo, createSignal, onMount, onCleanup, Show, For } from 'solid-js';
import { useApplicationNavigate } from '../applicationHost';
import { useSettings, useLocalization, useLanguage, useFlashcards } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { Button, BookIcon, VideoIcon, BotIcon, TargetIcon, LanguageVariantGate, LearningGoals, Modal, Select } from '../../../components/common';
import AppLogo from '../../../components/common/Misc/AppLogo';
import { WelcomeFeatureCard, WelcomeReaderPreview, WelcomeVideoPreview, WelcomeContinueRow } from './components';
import { getRecentItems, type RecentItem } from '../../../services/thumbnailService';
import { getBilingualLanguageName, getLocalizedLanguageName } from '../../../utils/languageDisplayName';
import { canonicalLanguage } from '../../../../shared/languageVariants';
import { formatRelativeLastOpened } from '../../../utils/timeFormatting';
import { showToast } from '../../../components/common/Feedback/Toast';
import { homeGrammarResume } from './homeGrammarResume';
import { homePracticeResume } from './homePracticeResume';
import { learningScopeForSettings } from '../../../../shared/learningScope';
import { reviewSessionHasAvailableCards } from '../../../../shared/reviewSession';
import { getLogger } from '../../../../shared/utils/logger';
import './welcome.css';
import './welcomeRecent.css';

const log = getLogger('renderer.welcome');

/** Home opens identifiable activities. Selection and mutation belong to the task workspace. */
export const WelcomeRoute: Component = () => {
  const navigate = useApplicationNavigate();
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();
  const language = useLanguage();
  const flashcards = useFlashcards();
  const [languagePickerOpen, setLanguagePickerOpen] = createSignal(false);
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
    let revision = 0;
    const refreshHome = () => {
      refreshResume();
      const requested = ++revision;
      void getRecentItems().then(items => {
        if (!disposed && requested === revision) setRecentItems(items);
      }).catch(error => log.error('Recent material could not be loaded', error));
    };
    refreshHome();
    window.addEventListener('focus', refreshHome);
    window.addEventListener('storage', refreshHome);
    onCleanup(() => { disposed = true; window.removeEventListener('focus', refreshHome); window.removeEventListener('storage', refreshHome); });
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
  const languageOptions = createMemo(() => {
    const catalogCodes = language.languageDataCatalog().map(status => status.language);
    const codes = [...new Set([...catalogCodes, ...language.supportedLanguages()]
      .filter(Boolean).map(code => canonicalLanguage(code, language.langData)))];
    return codes.map(code => {
      const status = language.getLanguageDataStatus(code);
      const nativeName = language.langData[code]?.name_translated ?? status?.nameTranslated ?? status?.name;
      const name = getBilingualLanguageName(
        code,
        language.langData[code],
        t,
        settings.uiLanguage,
        nativeName ?? code.toUpperCase(),
        nativeName,
      );
      const label = status && !status.compatible
        ? `${name} — ${t('mlearn.Settings.Language.LanguageData.RequiresAppVersion', { version: status.minimumAppVersion ?? '' })}`
        : name;
      return {
        value: code,
        label,
        disabled: !settings.devMode && status?.compatible === false && code !== settings.language,
      };
    });
  });
  const openLanguagePicker = () => {
    setLanguagePickerOpen(true);
  };
  const closeLanguagePicker = () => setLanguagePickerOpen(false);
  const selectLanguage = (event: Event & { currentTarget: HTMLSelectElement }) => {
    const selectedLanguage = event.currentTarget.value;
    if (selectedLanguage !== settings.language) updateSetting('language', selectedLanguage);
    closeLanguagePicker();
  };
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
  const startReview = () => getBridge().window.openWindow({ type: 'flashcards', context: { activity: 'review', intent: 'start', returnTo: 'home' } });
  const resumeReview = () => getBridge().window.openWindow({ type: 'flashcards', context: {
    activity: 'review', intent: 'resume', sessionId: savedReview()?.id, returnTo: 'home',
  } });
  const currentLanguageName = () => getLocalizedLanguageName(settings.language,
    language.currentLangData(), t, t('mlearn.Common.Status.Unknown'), settings.uiLanguage);
  return <main class="welcome-container">
    <LanguageVariantGate />
    <div class="welcome-page">
      <header class="welcome-header">
        <div class="welcome-logo"><AppLogo size="1.75rem" /><h1>{t('mlearn.Global.AppName')}</h1></div>
        <Button
          variant="ghost"
          class="welcome-subtitle welcome-language-switch"
          aria-haspopup="dialog"
          aria-expanded={languagePickerOpen()}
          onClick={openLanguagePicker}
        >
          {t('mlearn.Home.UI.LearningLanguage', { language: currentLanguageName() })}
        </Button>
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
        <WelcomeFeatureCard icon={<BookIcon size={22} />} title={t('mlearn.Flashcards.UI.Title')}
          description={t('mlearn.Flashcards.UI.Tabs.Review')} onClick={startReview}
          preview={<div class="welcome-resume-actions">
            <Button variant="primary" onClick={() => savedReview() ? resumeReview() : startReview()}>{t(savedReview() ? 'mlearn.StudyEncounter.Resume' : 'mlearn.LevelStudy.Mock.Start')} · {t('mlearn.Flashcards.UI.Tabs.Review')}</Button>
            <Show when={grammarResume()}>{saved => <Button onClick={() => getBridge().window.openWindow({ type: 'level-study', context: {
              ...saved().context, intent: 'resume', returnTo: 'home',
            } })}>{t('mlearn.StudyEncounter.Resume')} · {t('mlearn.Product.GrammarPractice')}</Button>}</Show>
            <Show when={practiceResume()}>{saved => <Button onClick={() => getBridge().window.openWindow({ type: 'level-study', context: {
              ...saved().context, intent: 'resume', returnTo: 'home',
            } })}>{t('mlearn.StudyEncounter.Resume')} · {t('mlearn.Product.WordPractice')}</Button>}</Show>
          </div>} />
        <WelcomeFeatureCard icon={<TargetIcon size={22} />} title={t('mlearn.Product.Evaluate')}
          description={t('mlearn.Product.KnowledgeCheckDescription')} onClick={() => navigate('/evaluate', { state: {
            applicationRequestId: crypto.randomUUID(), applicationContext: { returnTo: 'home' },
          } })} />
      </div>
      <Show when={recentItems().length > 0}>
        <section class="welcome-recent-items" aria-labelledby="welcome-recent-title">
          <h2 id="welcome-recent-title">{t('mlearn.Home.UI.ContinueLearning')}</h2>
          <div class="welcome-recent-list">
            <For each={recentItems()}>{item => <WelcomeContinueRow item={item}
              continueLabel={t('mlearn.Global.Continue')}
              lastOpened={formatRelativeLastOpened(item.lastWatched, settings.uiLanguage)}
              onContinue={openRecent} />}</For>
          </div>
        </section>
      </Show>
      <footer class="welcome-secondary-actions">
        <Button onClick={() => getBridge().window.openWindow({ type: 'level-study' })}>{t('mlearn.LevelStudy.Title')}</Button>
        <Button onClick={() => getBridge().window.openWindow({ type: 'word-db-editor' })}>{t('mlearn.Home.Cards.WordDatabase.Title')}</Button>
        <Button onClick={() => getBridge().window.openWindow({ type: 'statistics' })}>{t('mlearn.Home.Cards.Statistics.Title')}</Button>
        <Button variant="ghost" onClick={() => getBridge().window.openWindow({ type: 'settings' })}>{t('mlearn.Settings.UI.Title')}</Button>
      </footer>
    </div>
    <Modal
      isOpen={languagePickerOpen()}
      onClose={closeLanguagePicker}
      title={t('mlearn.Settings.Language.LearningLanguage.Label')}
      panelClass="welcome-language-picker"
      footer={<div class="welcome-language-picker-actions">
        <Button variant="ghost" onClick={closeLanguagePicker}>{t('mlearn.Global.Cancel')}</Button>
      </div>}
    >
      <Select
        class="welcome-language-picker-select"
        aria-label={t('mlearn.Settings.Language.LearningLanguage.Label')}
        value={settings.language}
        onChange={selectLanguage}
        options={languageOptions()}
      />
    </Modal>
  </main>;
};
