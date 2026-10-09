import { createMemo, Show, type Component } from 'solid-js';
import { useFlashcards, useLanguage, useLocalization, useSettings } from '../../../../context';
import { useLearningModel } from '../../../../hooks/useLearningModel';
import { policyContextFromSettings } from '../../../../learning/policyContext';
import { Button, LearningGoals } from '../../../../components/common';
import { homeLifetimeReviewTotals } from '../homeLearningSummary';

/** Read-only projections of the same requirement and daily-record owners as Plan/Progress. */
export const WelcomeLearningSummary: Component<{ onPlan: () => void }> = props => {
  const { settings } = useSettings(), { t } = useLocalization(), language = useLanguage(), flashcards = useFlashcards();
  const learning = useLearningModel(() => settings.language);
  const requirements = createMemo(() => learning.model() ? policyContextFromSettings(settings, settings.language, {
    model: learning.model()!, events: learning.snapshot()!.events, data: language.currentLangData(),
  }).requirementEvaluations : undefined);
  const totals = createMemo(() => homeLifetimeReviewTotals(flashcards.store.dailyStats, settings.language));
  return <section class="welcome-learning-summary" aria-label={t('mlearn.Home.Summary.Title')}>
    <div class="welcome-summary-heading"><h2>{t('mlearn.Home.Summary.Title')}</h2>
      <Button variant="ghost" size="sm" onClick={props.onPlan}>{t('mlearn.LearningPlan.Edit')}</Button></div>
    <Show when={settings.language} fallback={<p role="status">{t('mlearn.Settings.Language.LearningLanguage.Label')}</p>}>
    <LearningGoals summaryOnly compact requirementEvaluations={requirements()} />
    <Show when={!flashcards.libraryLoadError()} fallback={<div role="alert"><p>{flashcards.libraryLoadError()}</p><Button onClick={flashcards.retryLibraryLoad}>{t('mlearn.Knowledge.Retry')}</Button></div>}>
      <Show when={!flashcards.isLoading()} fallback={<p role="status">{t('mlearn.Common.Status.Loading')}</p>}>
        <dl class="welcome-lifetime-totals"><div><dt>{t('mlearn.Home.Summary.AllTimeReviews')}</dt><dd>{totals().reviews.toLocaleString(settings.uiLanguage)}</dd></div>
          <div><dt>{t('mlearn.Home.Summary.NewCardResponses')}</dt><dd>{totals().newCardResponses.toLocaleString(settings.uiLanguage)}</dd></div></dl>
        <p class="welcome-summary-definition">{t('mlearn.Home.Summary.RecordDefinition')}</p>
      </Show>
    </Show>
    <Show when={learning.failed()}><p role="alert">{t('mlearn.Home.Summary.EvidenceUnavailable')}</p><Button onClick={learning.retry}>{t('mlearn.Knowledge.Retry')}</Button></Show>
    </Show>
  </section>;
};
