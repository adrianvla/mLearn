import { createMemo, For, Show, type Component } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { activeLearningGoals, learningGoalsForSettings, type LearningGoal } from '../../../../shared/learningGoals';
import { learningOutcomeOptions, resolveLearningOutcome } from '../../../../shared/learningOutcomes';
import { Button } from '../Button';
import './LearningGoals.css';

/** Lightweight semantic selection shared by Home and Learning Plan; intent persists with its existing owner. */
export const LearningGoals: Component<{ compact?: boolean; onEdit?: () => void; coverage?: Record<string, { known: number; learning: number; unmeasured: number }>; deadlineWarnings?: Record<string, boolean> }> = (props) => {
  const { settings, updateSetting } = useSettings();
  const { currentLangData } = useLanguage();
  const { t } = useLocalization();
  const goals = createMemo(() => learningGoalsForSettings(settings));
  const active = createMemo(() => activeLearningGoals(goals(), settings.language));
  const options = createMemo(() => learningOutcomeOptions(currentLangData()).filter(option => !active().some(goal => goal.outcomeRef?.id === option.id)));
  const outcomeUnavailable = (goal: LearningGoal) => {
    const data = currentLangData();
    return !goal.outcomeRef || !data
      || (!!goal.outcomeRef.packageVersion && goal.outcomeRef.packageVersion !== data.languageData?.version)
      || !resolveLearningOutcome(data, goal.outcomeRef.id, goal.outcomeRef.groupIds)?.complete;
  };
  const patch = (id: string, change: Partial<LearningGoal>) => updateSetting('learningGoals', goals().map(goal => goal.id === id ? { ...goal, ...change } : goal));
  const select = (id: string) => {
    const outcome = resolveLearningOutcome(currentLangData(), id);
    if (!outcome?.complete || active().some(goal => goal.outcomeRef?.id === id)) return;
    updateSetting('learningGoals', [...goals(), { id: crypto.randomUUID(), language: settings.language,
      outcome: outcome.declaration.label, outcomeRef: { id, packageVersion: currentLangData()?.languageData?.version },
      status: 'active', priority: 1, createdAt: Date.now(), scope: { provenance: outcome.declaration.provenance,
        reference: outcome.declaration.reference, words: outcome.words } }]);
  };
  return <section class="learning-goals" aria-label={t('mlearn.Goals.Purpose')}>
    <div class="learning-goals__purpose"><span>{active().length ? t('mlearn.Goals.Purpose') : t('mlearn.Goals.Explore')}</span>
      <Show when={options().length && (!props.compact || !active().length)}><label>{t('mlearn.Goals.Choose')}
        <select name="learning-outcome" value="" onChange={event => { select(event.currentTarget.value); event.currentTarget.value = ''; }}>
          <option value="">{t('mlearn.Goals.Choose')}</option>
          <For each={options()}>{option => <option value={option.id}>{option.declaration.label}</option>}</For>
        </select></label></Show>
    </div>
    <For each={active()}>{goal => <div class="learning-goals__constraints">
      <span>{goal.outcomeRef ? currentLangData()?.learning?.outcomes?.[goal.outcomeRef.id]?.label ?? goal.outcome : goal.outcome}</span>
      <Show when={outcomeUnavailable(goal)}><span role="status">{t('mlearn.Goals.Unavailable')}</span></Show>
      <Show when={!props.compact}>
      <Show when={resolveLearningOutcome(currentLangData(), goal.outcomeRef!.id)?.groups.length! > 1}>
        <label>{t('mlearn.Goals.Scope')}<select name="learning-subset" value={goal.outcomeRef?.groupIds?.[0] ?? ''} onChange={event => patch(goal.id, { outcomeRef: { ...goal.outcomeRef!, groupIds: event.currentTarget.value ? [event.currentTarget.value] : undefined } })}>
          <option value="">{t('mlearn.Goals.AllMaterial')}</option>
          <For each={resolveLearningOutcome(currentLangData(), goal.outcomeRef!.id)?.groups}>{group => <option value={group.id}>{group.label ?? group.id}</option>}</For>
        </select></label>
      </Show>
      <label>{t('mlearn.Goals.Deadline')}<input type="date" value={goal.deadline ?? ''} onChange={event => patch(goal.id, { deadline: event.currentTarget.value || undefined })} /></label>
      <Button variant="ghost" size="sm" onClick={() => updateSetting('learningGoals', goals().filter(item => item.id !== goal.id))}>{t('mlearn.Goals.Remove')}</Button>
      </Show>
      <Show when={props.compact}>
        <For each={goal.outcomeRef?.groupIds}>{id => <span>{currentLangData()?.learning?.outcomes?.[goal.outcomeRef!.id]?.groups.find(group => group.id === id)?.label ?? id}</span>}</For>
        <Show when={goal.deadline}><span>{goal.deadline}</span></Show>
      </Show>
      <Show when={props.compact && props.onEdit}><Button variant="ghost" size="sm" onClick={props.onEdit}>{t('mlearn.LearningPlan.Edit')}</Button></Show>
      <Show when={goal.deadline && Date.parse(goal.deadline) < Date.now()}><span role="status">{t('mlearn.Goals.Passed')}</span></Show>
      <Show when={goal.deadline && props.deadlineWarnings?.[goal.id]}><span role="status">{t('mlearn.Goals.ScopeWorkloadRisk', { date: goal.deadline! })}</span></Show>
    </div>}</For>
  </section>;
};
