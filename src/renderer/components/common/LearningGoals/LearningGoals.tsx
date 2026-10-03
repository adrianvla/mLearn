import { createMemo, createSignal, For, Show, type Component } from 'solid-js';
import { useLocalization, useSettings } from '../../../context';
import { activeLearningGoals, learningGoalsForSettings, type LearningGoal } from '../../../../shared/learningGoals';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { Button } from '../Button';
import './LearningGoals.css';

/** Small outcome editor shared by Home and the detailed learning plan. */
export const LearningGoals: Component<{ coverage?: Record<string, { known: number; learning: number; unmeasured: number }> }> = props => {
  const { settings, updateSetting } = useSettings();
  const { t } = useLocalization();
  const goals = createMemo(() => learningGoalsForSettings(settings));
  const active = createMemo(() => activeLearningGoals(goals(), settings.language));
  let editor: HTMLDetailsElement | undefined;
  const [outcome, setOutcome] = createSignal('');
  const patch = (id: string, change: Partial<LearningGoal>) => updateSetting('learningGoals',
    goals().map(goal => goal.id === id ? { ...goal, ...change } : goal));
  const create = (event: SubmitEvent) => {
    event.preventDefault();
    if (!outcome().trim() || !settings.language) return;
    updateSetting('learningGoals', [...goals(), { id: crypto.randomUUID(), language: settings.language,
      outcome: outcome().trim(), status: 'active', priority: 2, createdAt: Date.now() }]);
    setOutcome('');
    if (editor) editor.open = false;
  };
  return <section class="learning-goals" aria-label={t('mlearn.Goals.Purpose')}>
    <div class="learning-goals__purpose">
      <span>{active()[0]?.outcome || t('mlearn.Goals.Explore')}</span>
      <label>{t('mlearn.Goals.Time')} <select name="minutes" value={settings.learningMinutes ?? DEFAULT_SETTINGS.learningMinutes}
        onChange={event => updateSetting('learningMinutes', Number(event.currentTarget.value))}>
        <For each={[5, 10, 15, 30]}>{minutes => <option value={minutes}>{t('mlearn.Goals.Minutes', { count: minutes })}</option>}</For>
      </select></label>
    </div>
    <details ref={editor} class="learning-goals__editor">
      <summary>{t(active().length ? 'mlearn.Goals.Edit' : 'mlearn.Goals.Add')}</summary>
      <For each={goals().filter(goal => goal.language === settings.language)}>{goal => <fieldset>
        <label>{t('mlearn.Goals.Outcome')}<input value={goal.outcome} onChange={event => {
          const value = event.currentTarget.value.trim(); if (value) patch(goal.id, { outcome: value });
        }} /></label>
        <div class="learning-goals__constraints">
          <label>{t('mlearn.Goals.Deadline')}<input type="date" value={goal.deadline ?? ''} onChange={event => patch(goal.id, { deadline: event.currentTarget.value || undefined })} /></label>
          <label>{t('mlearn.Goals.Priority')}<select value={goal.priority} onChange={event => patch(goal.id, { priority: Number(event.currentTarget.value) })}>
            <option value="3">{t('mlearn.Goals.First')}</option><option value="2">{t('mlearn.Goals.Normal')}</option><option value="1">{t('mlearn.Goals.Later')}</option>
          </select></label>
          <label>{t('mlearn.Goals.Status')}<select name="status" value={goal.status} onChange={event => patch(goal.id, { status: event.currentTarget.value as LearningGoal['status'] })}>
            <option value="active">{t('mlearn.Goals.Active')}</option><option value="paused">{t('mlearn.Goals.Paused')}</option><option value="completed">{t('mlearn.Goals.Completed')}</option>
          </select></label>
        </div>
        <Show when={goal.deadline && Date.parse(goal.deadline) < Date.now()}><p role="status">{t('mlearn.Goals.Passed')}</p></Show>
        <details><summary>{t('mlearn.Goals.Scope')}</summary>
          <Show when={goal.scope}><p>{t(`mlearn.Goals.Source.${goal.scope!.provenance}`)}<Show when={goal.scope?.reference}> · {goal.scope?.reference}</Show></p></Show>
          <Show when={props.coverage?.[goal.id]}>{coverage => <p>{t('mlearn.Goals.Coverage', coverage())}</p>}</Show>
          <Show when={goal.scope?.requirements}><p>{t('mlearn.Goals.OtherRequirements')}</p></Show>
          <label>{t('mlearn.Goals.Words')}<textarea value={goal.scope?.words?.join('\n') ?? ''} onChange={event => patch(goal.id, {
            scope: { ...goal.scope, provenance: 'user', words: [...new Set(event.currentTarget.value.split('\n').map(word => word.trim()).filter(Boolean))] },
          })} /></label>
        </details>
      </fieldset>}</For>
      <form onSubmit={create}>
        <label>{t('mlearn.Goals.Outcome')}<input name="outcome" value={outcome()} onInput={event => setOutcome(event.currentTarget.value)} required /></label>
        <Button type="submit" disabled={!outcome().trim() || !settings.language}>{t('mlearn.Goals.Add')}</Button>
      </form>
    </details>
  </section>;
};
