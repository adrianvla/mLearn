import { learningScopeForSettings } from '../../../shared/learningScope';
import { useLearningModel } from '../../hooks/useLearningModel';
import { policyContextFromSettings } from '../../learning/policyContext';
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
import { grammarSelfAssessmentHandoffMatches } from './grammarSelfAssessmentDecision';
import './LevelStudy.css';

type PlanDestination = 'plan' | 'assessment' | 'word-sync' | 'character-grid';

export const LevelStudyContent: Component<{ onClose?: () => void; workspace?: 'plan' | 'grammar' | 'mock'; launchContext?: Record<string, unknown> }> = (props) => {
  const { t } = useLocalization();
  const { currentLangData, getFreqLevelNames } = useLanguage();
  const { settings, isLoading: settingsLoading } = useSettings();
  const targetScope = createMemo(() => learningScopeForSettings(settings, currentLangData()));
  const learning = useLearningModel(() => settings.language);
  const policyContext = () => learning.model() ? policyContextFromSettings(settings, settings.language, { model: learning.model()!, events: learning.snapshot()!.events, data: currentLangData() }) : undefined;
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
  const openStudy = () => { batch(() => {
    const scope = targetScope();
    if (scope.selected && !scope.goals.length) { editPlan(); return; }
    if (scope.selected && !scope.words.length && scope.patterns.length) {
      getBridge().window.openWindow({ type: 'level-study', context: { activity: 'grammar', patterns: scope.patterns, returnTo: 'plan' } }); return;
    }
    getBridge().window.openWindow({ type: 'level-study', context: { activity: 'practice', returnTo: 'plan',
      ...(scope.selected ? { material: { language: settings.language, label: scope.goals.map(goal => goal.outcome).join(' · '), words: scope.words } } : {}) } });
  }); };
  const [sessionConstraint, setSessionConstraint] = createSignal<{ encounterLimit: number; requestId?: string }>();
  const [incomingContext, setIncomingContext] = createSignal<Record<string, unknown> | null>(null);
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

  createEffect(on(() => settingsLoading() ? null : incomingContext(), context => {
    if (!context || props.workspace) return;
    const session = context.session as { encounterLimit?: unknown; requestId?: unknown } | undefined;
    if (session && typeof session.encounterLimit === 'number' && Number.isFinite(session.encounterLimit)) {
      setSessionConstraint({ encounterLimit: Math.max(1, Math.min(120, Math.floor(session.encounterLimit))),
        ...(typeof session.requestId === 'string' ? { requestId: session.requestId } : {}) });
    }
    batch(() => {
      const material = materialPracticeContext(context.material, settings.language);
      setMaterialPractice(material);
      if (context.material !== undefined && !material) { setDestination('plan'); return; }
      if (context.activity === 'practice' || context.activity === 'reinforce') {
        setStudyIntent(context.activity === 'reinforce' ? 'reinforce' : undefined);
        setDestination('word-sync');
      }
      else if (context.activity === 'assessment') setDestination('assessment');
      else if (context.activity === 'plan' || context.activity === 'grammar') { setDestination('plan'); if (context.edit === true) editPlan(); }
    });
  }));
  createEffect(() => { if (props.workspace) { setGrammarRequestConsumed(false); setIncomingContext(props.launchContext ?? {}); if (props.workspace === 'plan' && props.launchContext?.edit === true) editPlan(); } });
  onMount(() => {
    if (props.workspace) return;
    const bridge = getBridge();
    const cleanup = bridge.window.onWindowContext(context => { setGrammarRequestConsumed(false); setIncomingContext(context); });
    if (cleanup) onCleanup(cleanup);
    bridge.window.getWindowContext('level-study');
  });
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
  createEffect(() => {
    if (destination() === 'character-grid' && !showCharacterGrid()) setDestination('plan');
    if (materialPractice() && materialPractice()!.language !== settings.language) {
      batch(() => { setMaterialPractice(undefined); setDestination('plan'); });
    }
  });
  const title = () => props.workspace === 'grammar' ? t('mlearn.LevelStudy.Grammar.Title')
    : props.workspace === 'mock' ? t('mlearn.Product.Evaluate') : destination() === 'plan' ? t('mlearn.LevelStudy.Title')
    : destination() === 'assessment' ? t('mlearn.LearningPlan.Assess')
    : destination() === 'word-sync' ? t('mlearn.Home.Today.Practice')
    : t(destination() === 'word-sync' ? 'mlearn.LevelStudy.Tabs.WordSync' : 'mlearn.LevelStudy.Tabs.CharacterGrid');

  return (
    <div class="level-study">
      <header class="level-study-header">
        <div class="level-study-header-title"><TargetIcon size={20} /><span>{title()}</span></div>
        <Show when={props.workspace === 'grammar' || props.workspace === 'mock' || destination() !== 'plan'}>
          <Button buttonType="nav" onClick={() => props.workspace || incomingContext()?.returnTo === 'home' || materialPractice() ? (props.onClose ?? (() => getBridge().window.closeWindow()))() : setDestination('plan')} icon={<ArrowLeftIcon size={16} />}>
            {t(incomingContext()?.returnTo === 'home' ? 'mlearn.Tabs.Home' : materialPractice() ? 'mlearn.LearningPlan.BackToMaterial' : 'mlearn.LearningPlan.Back')}
          </Button>
        </Show>
      </header>
      <div class="level-study-content">
        <Show when={destination() === 'plan'}>
          <div class="learning-plan-page">
            <Show when={destination() === 'plan' && (!props.workspace || props.workspace === 'plan')}>
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
        </Show>
        <Show when={destination() === 'word-sync' || destination() === 'assessment'}>
          <Show keyed when={destination() === 'assessment' ? 'assessment' : materialPractice() ? `material:${hashWordSync(materialPractice()!.words.join('\u0000'))}` : studyIntent() ?? 'study'}>{mode =>
            <WordSyncContent onClose={incomingContext()?.returnTo === 'home' ? () => (props.onClose ?? (() => getBridge().window.closeWindow()))() : undefined} encounterLimit={sessionConstraint()?.encounterLimit} sessionRequestId={sessionConstraint()?.requestId} mode={mode === 'assessment' ? 'assessment' : 'study'} intent={mode === 'assessment' ? undefined : studyIntent()} words={materialPractice()?.words} sourceLabel={materialPractice()?.label} onAssessmentApplied={() => setDestination('plan')} />
          }</Show>
        </Show>
        <Show when={destination() === 'character-grid' && showCharacterGrid()}><CharacterGridContent /></Show>
      </div>
    </div>
  );
};

export const LevelStudyApp: Component = () => <WindowWrapper><LevelStudyContent /></WindowWrapper>;
export default LevelStudyApp;
