import { learningScopeForSettings } from '../../../shared/learningScope';
import { useLearningModel } from '../../hooks/useLearningModel';
import { policyContextFromSettings } from '../../learning/policyContext';
import { Component, Show, createEffect, createSignal, createMemo } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../context';
import { Button, ArrowLeftIcon, Panel, TargetIcon } from '../../components/common';
import { LevelStudyTab } from './LevelStudyTab';
import { LearningPlanSettings } from './LearningPlanSettings';
import { getCharacterStudyScripts, getLearningLanguageLevelForLanguage, getFrequencyLevelLabel } from '../../../shared/languageFeatures';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { getBridge } from '../../../shared/bridges';
import { grammarSelfAssessmentHandoffMatches } from './grammarSelfAssessmentDecision';
import './LevelStudy.css';

export const LevelStudyContent: Component<{ onClose?: () => void; workspace?: 'plan' | 'grammar' | 'grammar-check' | 'mock'; launchContext?: Record<string, unknown> }> = (props) => {
  const { t } = useLocalization();
  const { currentLangData, getFreqLevelNames } = useLanguage();
  const { settings } = useSettings();
  const targetScope = createMemo(() => learningScopeForSettings(settings, currentLangData()));
  const learning = useLearningModel(() => settings.language);
  const policyContext = () => learning.model() ? policyContextFromSettings(settings, settings.language, { model: learning.model()!, events: learning.snapshot()!.events, data: currentLangData() }) : undefined;
  let planControls: HTMLDetailsElement | undefined;
  const editPlan = () => {
    if (planControls) planControls.open = true;
    planControls?.scrollIntoView({ block: 'start' });
    planControls?.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true });
  };
  const openStudy = () => {
    const scope = targetScope();
    if (scope.selected && !scope.goals.length) { editPlan(); return; }
    if (scope.selected && !scope.words.length && scope.patterns.length) {
      getBridge().window.openWindow({ type: 'level-study', context: { activity: 'grammar', patterns: scope.patterns, returnTo: 'plan' } }); return;
    }
    getBridge().window.openWindow({ type: 'level-study', context: { activity: 'practice', returnTo: 'plan',
      ...(scope.selected ? { material: { language: settings.language, label: scope.goals.map(goal => goal.outcome).join(' · '), words: scope.words } } : {}) } });
  };
  const incomingContext = () => props.launchContext ?? {};
  const [grammarRequestConsumed, setGrammarRequestConsumed] = createSignal(false);
  const grammarRequest = createMemo(() => {
    const context = incomingContext();
    if (context?.intent === 'resume' || grammarRequestConsumed() || context?.activity !== 'grammar' || !learning.ready() || !Array.isArray(context.patterns)) return undefined;
    const patterns = context.patterns.filter((value): value is string => typeof value === 'string' && !!currentLangData()?.grammar?.some(point => point.pattern === value));
    const level = currentLangData()?.grammar?.find(point => patterns.includes(point.pattern))?.level;
    const session = context.session as { requestId?: unknown; decision?: unknown } | undefined;
    const handoff = session?.decision;
    if (handoff !== undefined && !grammarSelfAssessmentHandoffMatches(handoff, session?.requestId, settings.language, patterns)) return undefined;
    return patterns.length && level !== undefined ? { level, patterns, requestedAt: 0,
      ...(handoff !== undefined ? { handoffDecision: handoff } : {}) } : undefined;
  });

  createEffect(() => { setGrammarRequestConsumed(false); if (props.workspace === 'plan' && props.launchContext?.edit === true) editPlan(); });
  const showCharacterGrid = createMemo(() => getCharacterStudyScripts(currentLangData()).length > 0);
  const planSummary = () => {
    if (targetScope().selected) return targetScope().goals.map(goal => goal.outcome).join(' · ') || t('mlearn.Goals.Unavailable');
    const data = currentLangData();
    const provider = data?.frequencyProviders?.[(settings.frequencyProviderSelections ?? DEFAULT_SETTINGS.frequencyProviderSelections)[settings.language]
      ?? data?.activeFrequencyProvider ?? data?.defaultFrequencyProvider ?? ''];
    const target = getLearningLanguageLevelForLanguage(settings, settings.language);
    const label = target === null ? t('mlearn.Settings.Behaviour.LearningLanguageLevel.NoLimit') : getFrequencyLevelLabel(target, getFreqLevelNames(), data);
    return [provider?.name, label].filter(Boolean).join(' · ');
  };
  const title = () => props.workspace === 'grammar-check' ? t('mlearn.Product.GrammarCheck') : props.workspace === 'grammar' ? t('mlearn.LevelStudy.Grammar.Title')
    : props.workspace === 'mock' ? t('mlearn.Product.Evaluate') : t('mlearn.LevelStudy.Title');

  return (
    <div class="level-study">
      <header class="level-study-header">
        <div class="level-study-header-title"><TargetIcon size={20} /><span>{title()}</span></div>
        <Show when={props.workspace === 'grammar' || props.workspace === 'grammar-check' || props.workspace === 'mock'}>
          <Button buttonType="nav" onClick={() => props.onClose?.()} icon={<ArrowLeftIcon size={16} />}>
            {t('mlearn.Global.Back')}
          </Button>
        </Show>
      </header>
      <div class="level-study-content">
          <div class="learning-plan-page">
            <Show when={!props.workspace || props.workspace === 'plan'}>
              <p class="learning-plan-intro">{t('mlearn.LearningPlan.Description')}</p>
              <section class="learning-plan-activity-section" aria-label={t('mlearn.LearningPlan.Activities')}>
                <Panel class="learning-plan-practice" padding="lg">
                  <div><h2>{t('mlearn.StudyEncounter.Task')}</h2><p>{t('mlearn.LearningPlan.WordSyncDescription')}</p></div>
                  <Button variant="primary" onClick={openStudy}>{t('mlearn.Home.Today.PracticeAction')}</Button>
                </Panel>
                <div class="learning-plan-secondary-activities">
                  <div><Button variant="ghost" onClick={() => getBridge().window.openWindow({ type: 'level-study', context: { activity: 'assessment', returnTo: 'plan' } })}>{t('mlearn.LearningPlan.Assess')}</Button><p>{t('mlearn.LearningPlan.AssessDescription')}</p></div>
                  <Show when={showCharacterGrid()}><div><Button variant="ghost" onClick={() => getBridge().window.openWindow({ type: 'character-grid' })}>{t('mlearn.LevelStudy.Tabs.CharacterGrid')}</Button><p>{t('mlearn.LearningPlan.CharactersDescription')}</p></div></Show>
                </div>
              </section>
              <details ref={planControls} class="learning-plan-configuration">
                <summary><span>{planSummary()}</span><span class="learning-plan-edit-label">{t('mlearn.LearningPlan.Edit')}</span></summary>
                <LearningPlanSettings />
              </details>
              <h2 class="learning-plan-progress-heading">{t('mlearn.LearningPlan.Progress')}</h2>
            </Show>
            <LevelStudyTab grammarResumeId={incomingContext()?.intent === 'resume' && typeof incomingContext()?.sessionId === 'string' ? incomingContext()!.sessionId as string : undefined} view={props.workspace ?? 'plan'} onEditPlan={editPlan} policyContext={policyContext()} grammarRequest={grammarRequest()} onGrammarRequestHandled={() => setGrammarRequestConsumed(true)} />
          </div>
      </div>
    </div>
  );
};
