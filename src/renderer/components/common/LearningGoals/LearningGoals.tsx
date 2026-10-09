import { createMemo, For, Show, type Component } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { activeLearningGoals, learningGoalsForSettings, goalDeadlineDayDifference, type LearningGoal } from '../../../../shared/learningGoals';
import { learningGoalCompatibility, learningGoalSemanticBasis, revalidateLearningGoal } from '../../../../shared/learningGoalCompatibility';
import { learningOutcomeOptions, resolveLearningOutcome } from '../../../../shared/learningOutcomes';
import { Button } from '../Button';
import { Input } from '../Input';
import { Select } from '../Select';
import type { LearningGoalRequirementEvaluation, LearningRequirementConditionEvaluation } from '../../../../shared/learningRequirementEvaluation';
import './LearningGoals.css';

/** Lightweight semantic selection shared by Home and Learning Plan; intent persists with its existing owner. */
export const LearningGoals: Component<{ compact?: boolean; summaryOnly?: boolean; onEdit?: () => void;
  coverage?: Record<string, { known: number; learning: number; unmeasured: number }>;
  deadlineWarnings?: Record<string, boolean>; requirementEvaluations?: readonly LearningGoalRequirementEvaluation[] }> = (props) => {
  const { settings, updateSetting } = useSettings();
  const { currentLangData } = useLanguage();
  const { t } = useLocalization();
  const goals = createMemo(() => learningGoalsForSettings(settings));
  const active = createMemo(() => activeLearningGoals(goals(), settings.language));
  const options = createMemo(() => learningOutcomeOptions(currentLangData()).filter(option => !active().some(goal => goal.outcomeRef?.id === option.id)));
  const changedParts = (goal: LearningGoal) => {
    const current = learningGoalCompatibility(goal, currentLangData()).basis;
    const previous = goal.outcomeRef?.semanticBasis;
    if (!current || !previous) return ['unverified'];
    return (['declarationHash', 'membershipHash', 'contentHash'] as const).filter(key => current[key] !== previous[key]);
  };
  const outcomeUnavailable = (goal: LearningGoal) => !learningGoalCompatibility(goal, currentLangData()).supported;
  const revalidate = (goal: LearningGoal) => {
    const rebound = revalidateLearningGoal(goal, currentLangData());
    if (rebound) updateSetting('learningGoals', goals().map(item => item.id === goal.id ? rebound : item));
  };
  const evaluationFor = (goal: LearningGoal) => props.requirementEvaluations?.find(evaluation => evaluation.goalId === goal.id);
  const conditionLabel = (condition: LearningRequirementConditionEvaluation) => {
    const label = condition.conditions && typeof condition.conditions === 'object' && !Array.isArray(condition.conditions)
      ? (condition.conditions as Record<string, unknown>).label : undefined;
    return typeof label === 'string' && label.trim() ? label : condition.requirementId;
  };
  const patch = (id: string, change: Partial<LearningGoal>) => updateSetting('learningGoals', goals().map(goal => goal.id === id ? { ...goal, ...change } : goal));
  const select = (id: string) => {
    const outcome = resolveLearningOutcome(currentLangData(), id);
    if (!outcome?.complete || active().some(goal => goal.outcomeRef?.id === id)) return;
    updateSetting('learningGoals', [...goals(), { id: crypto.randomUUID(), language: settings.language,
      outcome: outcome.declaration.label, outcomeRef: { id, packageVersion: currentLangData()?.languageData?.version, semanticBasis: learningGoalSemanticBasis(currentLangData(), { id }) },
      status: 'active', priority: 1, createdAt: Date.now(), scope: { provenance: outcome.declaration.provenance,
        reference: outcome.declaration.reference, words: outcome.words } }]);
  };
  return <section class="learning-goals" aria-label={t('mlearn.Goals.Purpose')}>
    <div class="learning-goals__purpose"><span>{active().length ? t('mlearn.Goals.Purpose') : t('mlearn.Goals.Explore')}</span>
      <Show when={!props.summaryOnly && options().length && (!props.compact || !active().length)}><label>{t('mlearn.Goals.Choose')}
        <Select name="learning-outcome" value="" onChange={event => { select(event.currentTarget.value); event.currentTarget.value = ''; }}>
          <option value="">{t('mlearn.Goals.Choose')}</option>
          <For each={options()}>{option => <option value={option.id}>{option.declaration.label}</option>}</For>
        </Select></label></Show>
    </div>
    <For each={active()}>{goal => <div class="learning-goals__constraints">
      <span class="learning-goals__outcome">{outcomeUnavailable(goal) ? goal.outcome
        : currentLangData()?.learning?.outcomes?.[goal.outcomeRef!.id]?.label ?? goal.outcome}</span>
      <Show when={outcomeUnavailable(goal)}><span role="status">{t('mlearn.Goals.Unavailable')}</span>
        <Show when={!props.summaryOnly && !props.compact && learningGoalSemanticBasis(currentLangData(), goal.outcomeRef!)}>
          <span>{t('mlearn.Goals.RevalidateDescription')}</span><For each={changedParts(goal)}>{part => <span>{t(`mlearn.Goals.CompatibilityChanges.${part}`)}</span>}</For><Button size="sm" onClick={() => revalidate(goal)}>{t('mlearn.Goals.Revalidate')}</Button>
        </Show>
      </Show>
      <Show when={!props.summaryOnly && !props.compact}>
        <Show when={resolveLearningOutcome(currentLangData(), goal.outcomeRef!.id)?.groups.length! > 1}>
        <label>{t('mlearn.Goals.Scope')}<Select name="learning-subset" value={goal.outcomeRef?.groupIds?.[0] ?? ''} onChange={event => { const ref = { ...goal.outcomeRef!, groupIds: event.currentTarget.value ? [event.currentTarget.value] : undefined }; patch(goal.id, { outcomeRef: { ...ref, packageVersion: currentLangData()?.languageData?.version, semanticBasis: learningGoalSemanticBasis(currentLangData(), ref) } }); }}>
          <option value="">{t('mlearn.Goals.AllMaterial')}</option>
          <For each={resolveLearningOutcome(currentLangData(), goal.outcomeRef!.id)?.groups}>{group => <option value={group.id}>{group.label ?? group.id}</option>}</For>
        </Select></label>
        </Show>
      <label>{t('mlearn.Goals.Deadline')}<Input type="date" value={goal.deadline ?? ''} onChange={event => patch(goal.id, { deadline: event.currentTarget.value || undefined })} /></label>
      <Button variant="ghost" size="sm" onClick={() => updateSetting('learningGoals', goals().filter(item => item.id !== goal.id))}>{t('mlearn.Goals.Remove')}</Button>
      </Show>
      <Show when={props.compact || props.summaryOnly}>
        <For each={goal.outcomeRef?.groupIds}>{id => <span>{currentLangData()?.learning?.outcomes?.[goal.outcomeRef!.id]?.groups.find(group => group.id === id)?.label ?? id}</span>}</For>
        <Show when={goal.scope?.reference}><span class="learning-goals__scope-reference">
          {t(`mlearn.Goals.Source.${goal.scope!.provenance}`)} · {goal.scope!.reference}
        </span></Show>
        <Show when={goal.deadline}><span class="learning-goals__deadline">{t('mlearn.Goals.DeadlineDate', { date: goal.deadline! })}</span>
          <Show when={goalDeadlineDayDifference(goal.deadline) !== undefined}><span>{t(goalDeadlineDayDifference(goal.deadline)! > 0 ? 'mlearn.Goals.DaysRemaining' : goalDeadlineDayDifference(goal.deadline) === 0 ? 'mlearn.Goals.DueToday' : 'mlearn.Goals.DaysOverdue', { days: Math.abs(goalDeadlineDayDifference(goal.deadline)!) })}</span></Show>
        </Show>
      </Show>
      <Show when={props.compact && !props.summaryOnly && props.onEdit}><Button variant="ghost" size="sm" onClick={props.onEdit}>{t('mlearn.LearningPlan.Edit')}</Button></Show>
      <Show when={goalDeadlineDayDifference(goal.deadline) !== undefined && goalDeadlineDayDifference(goal.deadline)! < 0}><span role="status">{t('mlearn.Goals.Passed')}</span></Show>
      <Show when={goal.deadline && props.deadlineWarnings?.[goal.id]}><span role="status">{t('mlearn.Goals.ScopeWorkloadRisk', { date: goal.deadline! })}</span></Show>
      <Show when={props.summaryOnly && evaluationFor(goal)}>{evaluation => <ul class="learning-goals__requirements" aria-label={t('mlearn.Goals.RequirementEvidence')}>
        <For each={evaluation().requirements}>{condition => <li class={`learning-goals__requirement learning-goals__requirement--${condition.status}`}>
          <span>{conditionLabel(condition)}</span>
          <span>{t(`mlearn.Goals.RequirementStatus.${condition.status}`)}</span>
        </li>}</For>
        <Show when={!evaluation().requirements.length && evaluation().status !== 'met'}>
          <li class={`learning-goals__requirement learning-goals__requirement--${evaluation().status}`}>
            <span>{t('mlearn.Goals.RequirementEvidence')}</span>
            <span>{t(`mlearn.Goals.RequirementStatus.${evaluation().status}`)}</span>
          </li>
        </Show>
      </ul>}</Show>
    </div>}</For>
    <Show when={props.summaryOnly && props.onEdit}><Button class="learning-goals__edit" variant="ghost" size="sm" onClick={props.onEdit}>{t('mlearn.LearningPlan.Edit')}</Button></Show>
  </section>;
};
