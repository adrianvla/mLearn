import { Component, Show, createEffect, createSignal, createMemo } from 'solid-js';
import { WindowWrapper, useLanguage, useLocalization } from '../../context';
import { Btn, TargetIcon } from '../../components/common';
import { WordSyncContent } from '../wordSync/App';
import { CharacterGridContent } from '../characterGrid/App';
import { LevelStudyTab } from './LevelStudyTab';
import { LearningPlanSettings } from './LearningPlanSettings';
import { getCharacterStudyScripts } from '../../../shared/languageFeatures';
import './LevelStudy.css';

type PlanDestination = 'plan' | 'assessment' | 'word-sync' | 'character-grid';

export const LevelStudyContent: Component = () => {
  const { t } = useLocalization();
  const { currentLangData } = useLanguage();
  let planControls: HTMLDivElement | undefined;
  const editPlan = () => {
    setDestination('plan');
    planControls?.scrollIntoView({ block: 'start' });
    planControls?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true });
  };
  const [destination, setDestination] = createSignal<PlanDestination>('plan');
  const showCharacterGrid = createMemo(() => getCharacterStudyScripts(currentLangData()).length > 0);
  createEffect(() => {
    if (destination() === 'character-grid' && !showCharacterGrid()) setDestination('plan');
  });
  const title = () => destination() === 'plan' ? t('mlearn.LevelStudy.Title')
    : destination() === 'assessment' ? t('mlearn.LearningPlan.Assess')
    : t(destination() === 'word-sync' ? 'mlearn.LevelStudy.Tabs.WordSync' : 'mlearn.LevelStudy.Tabs.CharacterGrid');

  return (
    <div class="level-study">
      <header class="level-study-header">
        <div class="level-study-header-title"><TargetIcon size={20} /><span>{title()}</span></div>
        <Show when={destination() !== 'plan'}>
          <Btn variant="ghost" onClick={() => setDestination('plan')}>{t('mlearn.LearningPlan.Back')}</Btn>
        </Show>
      </header>
      <div class="level-study-content">
        <Show when={destination() === 'plan' || destination() === 'assessment'}>
          <div class="learning-plan-page">
            <Show when={destination() === 'plan'}>
              <p class="learning-plan-intro">{t('mlearn.LearningPlan.Description')}</p>
              <div ref={planControls}><LearningPlanSettings /></div>
              <section class="learning-plan-activity-section" aria-label={t('mlearn.LearningPlan.Activities')}>
                <h2>{t('mlearn.LearningPlan.Activities')}</h2>
                <div class="learning-plan-activities">
                  <div><h3>{t('mlearn.LearningPlan.Assess')}</h3><p>{t('mlearn.LearningPlan.AssessDescription')}</p><Btn variant="primary" onClick={() => setDestination('assessment')}>{t('mlearn.LearningPlan.Assess')}</Btn></div>
                  <div><h3>{t('mlearn.LevelStudy.Tabs.WordSync')}</h3><p>{t('mlearn.LearningPlan.WordSyncDescription')}</p><Btn onClick={() => setDestination('word-sync')}>{t('mlearn.LevelStudy.Tabs.WordSync')}</Btn></div>
                  <Show when={showCharacterGrid()}><div><h3>{t('mlearn.LevelStudy.Tabs.CharacterGrid')}</h3><p>{t('mlearn.LearningPlan.CharactersDescription')}</p><Btn onClick={() => setDestination('character-grid')}>{t('mlearn.LevelStudy.Tabs.CharacterGrid')}</Btn></div></Show>
                </div>
              </section>
              <h2 class="learning-plan-progress-heading">{t('mlearn.LearningPlan.Progress')}</h2>
            </Show>
            <LevelStudyTab assessment={destination() === 'assessment'} onEditPlan={editPlan} />
          </div>
        </Show>
        <Show when={destination() === 'word-sync'}><WordSyncContent /></Show>
        <Show when={destination() === 'character-grid' && showCharacterGrid()}><CharacterGridContent /></Show>
      </div>
    </div>
  );
};

export const LevelStudyApp: Component = () => <WindowWrapper><LevelStudyContent /></WindowWrapper>;
export default LevelStudyApp;
