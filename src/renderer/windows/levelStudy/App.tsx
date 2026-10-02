import { Component, Show, batch, createEffect, createSignal, createMemo, on, onMount, onCleanup } from 'solid-js';
import { WindowWrapper, useLanguage, useLocalization, useSettings } from '../../context';
import { Button, ArrowLeftIcon, Panel, TargetIcon } from '../../components/common';
import { WordSyncContent } from '../wordSync/App';
import { CharacterGridContent } from '../characterGrid/App';
import { LevelStudyTab } from './LevelStudyTab';
import { LearningPlanSettings } from './LearningPlanSettings';
import { getCharacterStudyScripts, getLearningLanguageLevelForLanguage, getFrequencyLevelLabel } from '../../../shared/languageFeatures';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';
import { hashWordSync } from '../../services/srsAlgorithm';
import { materialPracticeContext, type MaterialPracticeContext } from './materialPracticeContext';
import './LevelStudy.css';

type PlanDestination = 'plan' | 'assessment' | 'word-sync' | 'character-grid';

export const LevelStudyContent: Component = () => {
  const { t } = useLocalization();
  const { currentLangData, getFreqLevelNames } = useLanguage();
  const { settings, isLoading: settingsLoading } = useSettings();
  let planControls: HTMLDetailsElement | undefined;
  const editPlan = () => {
    setDestination('plan');
    if (planControls) planControls.open = true;
    planControls?.scrollIntoView({ block: 'start' });
    planControls?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true });
  };
  const [destination, setDestination] = createSignal<PlanDestination>('plan');
  const [studyIntent, setStudyIntent] = createSignal<'reinforce' | undefined>();
  const [materialPractice, setMaterialPractice] = createSignal<MaterialPracticeContext>();
  const openStudy = () => { batch(() => { setMaterialPractice(undefined); setStudyIntent(undefined); setDestination('word-sync'); }); };
  const [incomingContext, setIncomingContext] = createSignal<Record<string, unknown> | null>(null);
  createEffect(on(() => settingsLoading() ? null : incomingContext(), context => {
    if (!context) return;
    batch(() => {
      const material = materialPracticeContext(context.material, settings.language);
      setMaterialPractice(material);
      if (context.material !== undefined && !material) { setDestination('plan'); return; }
      if (context.activity === 'practice' || context.activity === 'reinforce') {
        setStudyIntent(context.activity === 'reinforce' ? 'reinforce' : undefined);
        setDestination('word-sync');
      }
      else if (context.activity === 'assessment') setDestination('assessment');
      else if (context.activity === 'plan') setDestination('plan');
    });
  }));
  onMount(() => {
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext(setIncomingContext);
    if (cleanup) onCleanup(cleanup);
    bridge.window.getWindowContext('level-study');
  });
  const showCharacterGrid = createMemo(() => getCharacterStudyScripts(currentLangData()).length > 0);
  const planSummary = () => {
    const data = currentLangData();
    const provider = data?.frequencyProviders?.[(settings.frequencyProviderSelections ?? DEFAULT_SETTINGS.frequencyProviderSelections)[settings.language]
      ?? data?.activeFrequencyProvider ?? data?.defaultFrequencyProvider ?? ''];
    const target = getLearningLanguageLevelForLanguage(settings, settings.language);
    const label = target === null ? t('mlearn.Settings.Behaviour.LearningLanguageLevel.NoLimit') : getFrequencyLevelLabel(target, getFreqLevelNames(), data);
    const intensity = settings.sessionIntensity ?? DEFAULT_SETTINGS.sessionIntensity;
    const intensityKey = { gentle: 'Gentle', steady: 'Steady', intensive: 'Intensive' }[intensity];
    return [provider?.name, label, t(`mlearn.Settings.Behaviour.SessionIntensity.${intensityKey}`)].filter(Boolean).join(' · ');
  };
  createEffect(() => {
    if (destination() === 'character-grid' && !showCharacterGrid()) setDestination('plan');
    if (materialPractice() && materialPractice()!.language !== settings.language) {
      batch(() => { setMaterialPractice(undefined); setDestination('plan'); });
    }
  });
  const title = () => destination() === 'plan' ? t('mlearn.LevelStudy.Title')
    : destination() === 'assessment' ? t('mlearn.LearningPlan.Assess')
    : materialPractice() && destination() === 'word-sync' ? t('mlearn.StudyEncounter.Task')
    : t(destination() === 'word-sync' ? 'mlearn.LevelStudy.Tabs.WordSync' : 'mlearn.LevelStudy.Tabs.CharacterGrid');

  return (
    <div class="level-study">
      <header class="level-study-header">
        <div class="level-study-header-title"><TargetIcon size={20} /><span>{title()}</span></div>
        <Show when={destination() !== 'plan'}>
          <Button buttonType="nav" onClick={() => materialPractice() ? getBridge().window.closeWindow() : setDestination('plan')} icon={<ArrowLeftIcon size={16} />}>
            {t(materialPractice() ? 'mlearn.LearningPlan.BackToMaterial' : 'mlearn.LearningPlan.Back')}
          </Button>
        </Show>
      </header>
      <div class="level-study-content">
        <Show when={destination() === 'plan'}>
          <div class="learning-plan-page">
            <Show when={destination() === 'plan'}>
              <p class="learning-plan-intro">{t('mlearn.LearningPlan.Description')}</p>
              <section class="learning-plan-activity-section" aria-label={t('mlearn.LearningPlan.Activities')}>
                <Panel class="learning-plan-practice" padding="lg">
                  <div><h2>{t('mlearn.StudyEncounter.Task')}</h2><p>{t('mlearn.LearningPlan.WordSyncDescription')}</p></div>
                  <Button variant="primary" onClick={openStudy}>{t('mlearn.Home.Today.PracticeAction')}</Button>
                </Panel>
                <div class="learning-plan-secondary-activities">
                  <div><Button variant="ghost" onClick={() => setDestination('assessment')}>{t('mlearn.LearningPlan.Assess')}</Button><p>{t('mlearn.LearningPlan.AssessDescription')}</p></div>
                  <Show when={showCharacterGrid()}><div><Button variant="ghost" onClick={() => setDestination('character-grid')}>{t('mlearn.LevelStudy.Tabs.CharacterGrid')}</Button><p>{t('mlearn.LearningPlan.CharactersDescription')}</p></div></Show>
                </div>
              </section>
              <details ref={planControls} class="learning-plan-configuration">
                <summary><span>{planSummary()}</span><span class="learning-plan-edit-label">{t('mlearn.LearningPlan.Edit')}</span></summary>
                <LearningPlanSettings />
              </details>
              <h2 class="learning-plan-progress-heading">{t('mlearn.LearningPlan.Progress')}</h2>
            </Show>
            <LevelStudyTab onEditPlan={editPlan} />
          </div>
        </Show>
        <Show when={destination() === 'word-sync' || destination() === 'assessment'}>
          <Show keyed when={destination() === 'assessment' ? 'assessment' : materialPractice() ? `material:${hashWordSync(materialPractice()!.words.join('\u0000'))}` : studyIntent() ?? 'study'}>{mode =>
            <WordSyncContent mode={mode === 'assessment' ? 'assessment' : 'study'} intent={mode === 'reinforce' ? 'reinforce' : undefined} words={materialPractice()?.words} sourceLabel={materialPractice()?.label} onAssessmentApplied={() => setDestination('plan')} />
          }</Show>
        </Show>
        <Show when={destination() === 'character-grid' && showCharacterGrid()}><CharacterGridContent /></Show>
      </div>
    </div>
  );
};

export const LevelStudyApp: Component = () => <WindowWrapper><LevelStudyContent /></WindowWrapper>;
export default LevelStudyApp;
