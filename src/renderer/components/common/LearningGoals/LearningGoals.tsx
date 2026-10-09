import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { activeLearningGoals, learningGoalsForSettings, goalDeadlineDayDifference, duplicateLearningGoalForDeadline, type LearningGoal } from '../../../../shared/learningGoals';
import { learningGoalCompatibility, learningGoalSemanticBasis, revalidateLearningGoal } from '../../../../shared/learningGoalCompatibility';
import { learningOutcomeOptions, resolveLearningOutcome } from '../../../../shared/learningOutcomes';
import { Button } from '../Button';
import { Input } from '../Input';
import { Select } from '../Select';
import type { LearningGoalRequirementEvaluation, LearningRequirementConditionEvaluation } from '../../../../shared/learningRequirementEvaluation';
import './LearningGoals.css';
import type { LanguageData } from '../../../../shared/types';
import { CAPABILITY_LABEL_KEYS } from '../../../../shared/graph/access';
import { canAddPersonalRecallCondition, discoverRecallConditionOptions, editableRecallCondition, installedGoalRecallCandidates, withPersonalRecallCondition, withoutPersonalRecallCondition } from '../../../learning/goalRecallConditions';

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
  const conditionLabel = (goal: LearningGoal, condition: LearningRequirementConditionEvaluation) => {
    if (editableRecallCondition(condition.conditions)) {
      const recall = condition.conditions;
      const material = resolveLearningOutcome(currentLangData(), goal.outcomeRef!.id)?.groups ?? [];
      const labels = recall.groupIds.map(id => material.find(group => group.id === id)?.label ?? id);
      const capability = currentLangData()?.learning?.capabilities?.[recall.capability]?.label
        ?? (CAPABILITY_LABEL_KEYS[recall.capability] ? t(CAPABILITY_LABEL_KEYS[recall.capability]) : recall.capability);
      return t('mlearn.Goals.RecallConditionSummary', { material: labels.join(', '), capability, minimum: recall.minimum });
    }
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
    <For each={active()}>{goal => <div class="learning-goals__constraints" data-goal-id={goal.id}>
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
      <Button variant="ghost" size="sm" onClick={() => updateSetting('learningGoals', [...goals(), duplicateLearningGoalForDeadline(goal, crypto.randomUUID(), Date.now())])}>{t('mlearn.Goals.AnotherDeadline')}</Button>
      <Show when={!outcomeUnavailable(goal)}><PersonalRecallConditions goal={goal} data={currentLangData()} onChange={next => patch(goal.id, next)} /></Show>
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
          <span>{conditionLabel(goal, condition)}</span>
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

const PersonalRecallConditions: Component<{ goal: LearningGoal; data: LanguageData | null; onChange: (goal: LearningGoal) => void }> = props => {
  const { t } = useLocalization();
  const [choice, setChoice] = createSignal('');
  const [minimum, setMinimum] = createSignal('');
  const groups = createMemo(() => resolveLearningOutcome(props.data, props.goal.outcomeRef!.id, props.goal.outcomeRef?.groupIds)?.groups ?? []);
  const options = createMemo(() => discoverRecallConditionOptions(props.goal.language, groups(), installedGoalRecallCandidates(props.goal.language, props.data)));
  const optionValue = (option: { groupId: string; capability: string }) => JSON.stringify([option.groupId, option.capability]);
  const selected = () => availableOptions().find(option => optionValue(option) === choice());
  const validMinimum = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
  const capabilityLabel = (capability: string) => props.data?.learning?.capabilities?.[capability]?.label
    ?? (CAPABILITY_LABEL_KEYS[capability] ? t(CAPABILITY_LABEL_KEYS[capability]) : capability);
  const conditions = createMemo(() => {
    const requirements = props.goal.scope?.requirements;
    const raw = requirements?.conditions;
    return Array.isArray(raw) ? raw.filter(editableRecallCondition) : editableRecallCondition(requirements) ? [requirements] : [];
  });
  const availableOptions = createMemo(() => options().filter(option => !conditions().some(condition => condition.groupIds.length === 1 && condition.groupIds[0] === option.groupId && condition.capability === option.capability)));
  const writable = () => canAddPersonalRecallCondition(props.goal);
  const supported = (condition: { id: string; groupIds: string[]; capability: string }) => conditions().filter(value => value.id === condition.id).length === 1 && condition.groupIds.every(groupId => options().some(option => option.groupId === groupId && option.capability === condition.capability));
  const save = (condition: Parameters<typeof withPersonalRecallCondition>[1]) => {
    const next = withPersonalRecallCondition(props.goal, condition);
    if (next) props.onChange(next);
  };
  return <fieldset class="learning-goals__personal">
    <legend>{t('mlearn.Goals.PersonalRecall')}</legend>
    <p>{t('mlearn.Goals.PersonalRecallDescription')}</p>
    <For each={conditions()}>{condition => <div class="learning-goals__personal-condition">
      <span>{condition.groupIds.map(id => groups().find(group => group.id === id)?.label ?? id).join(', ')} · {capabilityLabel(condition.capability)}</span>
      <label>{t('mlearn.Goals.RecallMinimum')}<Input name="learning-recall-condition-minimum" type="number" min="0" max="1" step="0.01" value={condition.minimum} disabled={!supported(condition)}
        onChange={event => { if (supported(condition) && validMinimum(event.currentTarget.value)) save({ ...condition, minimum: Number(event.currentTarget.value) }); else event.currentTarget.value = String(condition.minimum); }} /></label>
      <Show when={!supported(condition)}><span role="status">{t('mlearn.Goals.RecallUnavailable')}</span></Show>
      <Button variant="ghost" size="sm" onClick={() => { const next = withoutPersonalRecallCondition(props.goal, condition.id); if (next) props.onChange(next); }}>{t('mlearn.Goals.RemoveRecallCondition')}</Button>
    </div>}</For>
    <Show when={availableOptions().length && writable()} fallback={<span>{t('mlearn.Goals.RecallUnavailable')}</span>}>
      <div class="learning-goals__personal-add">
        <label>{t('mlearn.Goals.RecallMaterial')}<Select name="learning-recall-task" value={choice()} onChange={event => setChoice(event.currentTarget.value)}>
          <option value="">{t('mlearn.Goals.RecallChoose')}</option>
          <For each={availableOptions()}>{option => <option value={optionValue(option)}>{option.groupLabel} · {capabilityLabel(option.capability)}</option>}</For>
        </Select></label>
        <label>{t('mlearn.Goals.RecallMinimum')}<Input name="learning-recall-minimum" type="number" min="0" max="1" step="0.01" value={minimum()} onInput={event => setMinimum(event.currentTarget.value)} /></label>
        <Button size="sm" disabled={!selected() || !validMinimum(minimum())} onClick={() => {
          const option = selected();
          if (option && validMinimum(minimum())) {
            save({ id: `learner:recall:${crypto.randomUUID()}`, kind: 'canonical-capability-threshold', groupIds: [option.groupId], capability: option.capability, minimum: Number(minimum()) });
            setChoice(''); setMinimum('');
          }
        }}>{t('mlearn.Goals.AddRecallCondition')}</Button>
      </div>
    </Show>
  </fieldset>;
};
