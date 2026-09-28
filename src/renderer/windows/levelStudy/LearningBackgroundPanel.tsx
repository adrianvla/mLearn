import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { useLocalization, useSettings } from '../../context';
import { Button, Panel } from '../../components/common';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import {
  parseHistoricalBackgroundRecords,
  type HistoricalBackgroundKind,
  type HistoricalBackgroundRecord,
  type HistoricalBackgroundScore,
} from '../../../shared/learningBackground';
import './LearningBackgroundPanel.css';

const kinds: readonly HistoricalBackgroundKind[] = ['exam', 'school', 'self-assessment'];

const nextBackgroundId = (): string => {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
};

function recordsForLanguage(value: unknown, language: string): HistoricalBackgroundRecord[] {
  return parseHistoricalBackgroundRecords(value).filter((record) => record.language === language);
}

function suppliedScoreText(record: HistoricalBackgroundRecord): string {
  const parts: string[] = [];
  if (record.score?.overall !== undefined) parts.push(record.score.overall);
  if (record.score?.skills !== undefined) {
    for (const [skill, value] of Object.entries(record.score.skills)) parts.push(`${skill} ${value}`);
  }
  return parts.join(' · ');
}

export const LearningBackgroundPanel: Component<{ language: string }> = (props) => {
  const { t } = useLocalization();
  const { settings, updateSetting } = useSettings();
  const [formOpen, setFormOpen] = createSignal(false);
  const [formKind, setFormKind] = createSignal<HistoricalBackgroundKind>('exam');
  const [formLabel, setFormLabel] = createSignal('');
  const [formLevel, setFormLevel] = createSignal('');
  const [formDate, setFormDate] = createSignal('');
  const [formNote, setFormNote] = createSignal('');
  const [formSkills, setFormSkills] = createSignal('');
  const [formScoreOverall, setFormScoreOverall] = createSignal('');
  const [formSkillScores, setFormSkillScores] = createSignal<Record<string, string>>({});

  const rawRecords = () => settings.learningBackground?.records ?? DEFAULT_SETTINGS.learningBackground.records;
  const records = createMemo(() => recordsForLanguage(rawRecords(), props.language));
  const parsedSkills = createMemo(() => formSkills().split(',').map((skill) => skill.trim()).filter(Boolean));
  const dateRequired = () => formKind() !== 'self-assessment';
  const canSave = () => formLabel().trim() !== '' && (!dateRequired() || formDate().trim() !== '');

  const save = () => {
    const label = formLabel().trim();
    if (!label || (dateRequired() && !formDate().trim())) return;
    const record: HistoricalBackgroundRecord = {
      id: nextBackgroundId(),
      language: props.language,
      kind: formKind(),
      label,
      recordedAt: Date.now(),
    };
    const level = formLevel().trim();
    const completedAt = formDate().trim();
    const note = formNote().trim();
    const skills = parsedSkills();
    if (level) record.level = level;
    if (completedAt) record.completedAt = completedAt;
    if (note) record.note = note;
    if (skills.length > 0) record.skillScope = skills;

    const scoreSkills: Record<string, string> = {};
    for (const skill of skills) {
      const score = (formSkillScores()[skill] ?? '').trim();
      if (score) scoreSkills[skill] = score;
    }
    const overall = formScoreOverall().trim();
    if (overall || Object.keys(scoreSkills).length > 0) {
      const score: HistoricalBackgroundScore = {};
      if (overall) score.overall = overall;
      if (Object.keys(scoreSkills).length > 0) score.skills = scoreSkills;
      record.score = score;
    }

    updateSetting('learningBackground', { records: [...rawRecords(), record] });
    setFormLabel('');
    setFormLevel('');
    setFormDate('');
    setFormNote('');
    setFormSkills('');
    setFormScoreOverall('');
    setFormSkillScores({});
    setFormOpen(false);
  };

  const remove = (id: string) => {
    updateSetting('learningBackground', { records: rawRecords().filter((record) => record.id !== id) });
  };

  return (
    <Panel class="learning-background-panel" variant="outlined" padding="md" data-testid="learning-background-panel">
      <details>
        <summary>{t('mlearn.LevelStudy.Placement.BackgroundTitle')}</summary>
        <p class="learning-background-panel__description">{t('mlearn.LevelStudy.Placement.Description')}</p>
        <Show when={records().length === 0}>
          <p class="learning-background-panel__empty">{t('mlearn.LevelStudy.Placement.BackgroundEmpty')}</p>
        </Show>
        <ul class="learning-background-panel__records">
          <For each={records()}>
            {(record) => (
              <li class="learning-background-panel__record">
                <span class="learning-background-panel__record-label">{record.label}</span>
                <span>{t(`mlearn.LevelStudy.Placement.Kind.${record.kind}`)}</span>
                <Show when={record.level !== undefined}><span>{record.level}</span></Show>
                <Show when={record.score !== undefined}>
                  <span>{t('mlearn.LevelStudy.Placement.SuppliedScore', { score: suppliedScoreText(record) })}</span>
                </Show>
                <Show when={record.completedAt !== undefined} fallback={
                  <Show when={record.kind !== 'self-assessment'}>
                    <span>{t('mlearn.LevelStudy.Placement.DateUnknown')}</span>
                  </Show>
                }>
                  <span>{record.completedAt}</span>
                </Show>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('mlearn.LevelStudy.Placement.RemoveRecord')}
                  onClick={() => remove(record.id)}
                >
                  {t('mlearn.LevelStudy.Placement.RemoveRecord')}
                </Button>
              </li>
            )}
          </For>
        </ul>
        <Show when={!formOpen()} fallback={
          <div class="learning-background-panel__form">
            <label>
              <span>{t('mlearn.LevelStudy.Placement.KindLabel')}</span>
              <select value={formKind()} aria-label={t('mlearn.LevelStudy.Placement.KindLabel')} onChange={(event) => setFormKind(event.currentTarget.value as HistoricalBackgroundKind)}>
                <For each={[...kinds]}>{(kind) => <option value={kind}>{t(`mlearn.LevelStudy.Placement.Kind.${kind}`)}</option>}</For>
              </select>
            </label>
            <label>
              <span>{t('mlearn.LevelStudy.Placement.ResultLabel')}</span>
              <input value={formLabel()} placeholder={t('mlearn.LevelStudy.Placement.LabelPlaceholder')} aria-label={t('mlearn.LevelStudy.Placement.ResultLabel')} onInput={(event) => setFormLabel(event.currentTarget.value)} />
            </label>
            <label>
              <span>{t('mlearn.LevelStudy.Placement.LevelLabel')}</span>
              <input value={formLevel()} placeholder={t('mlearn.LevelStudy.Placement.LevelPlaceholder')} aria-label={t('mlearn.LevelStudy.Placement.LevelLabel')} onInput={(event) => setFormLevel(event.currentTarget.value)} />
            </label>
            <label>
              <span>{t('mlearn.LevelStudy.Placement.DateLabel')}</span>
              <input type="date" value={formDate()} aria-label={t('mlearn.LevelStudy.Placement.DateLabel')} onInput={(event) => setFormDate(event.currentTarget.value)} />
            </label>
            <label>
              <span>{t('mlearn.LevelStudy.Placement.NoteLabel')}</span>
              <input value={formNote()} placeholder={t('mlearn.LevelStudy.Placement.NotePlaceholder')} aria-label={t('mlearn.LevelStudy.Placement.NoteLabel')} onInput={(event) => setFormNote(event.currentTarget.value)} />
            </label>
            <label>
              <span>{t('mlearn.LevelStudy.Placement.SkillsLabel')}</span>
              <input value={formSkills()} placeholder={t('mlearn.LevelStudy.Placement.SkillsPlaceholder')} aria-label={t('mlearn.LevelStudy.Placement.SkillsLabel')} onInput={(event) => setFormSkills(event.currentTarget.value)} />
            </label>
            <label>
              <span>{t('mlearn.LevelStudy.Placement.ScoreOverallLabel')}</span>
              <input value={formScoreOverall()} placeholder={t('mlearn.LevelStudy.Placement.ScoreOverallPlaceholder')} aria-label={t('mlearn.LevelStudy.Placement.ScoreOverallLabel')} onInput={(event) => setFormScoreOverall(event.currentTarget.value)} />
            </label>
            <For each={parsedSkills()}>
              {(skill) => (
                <label>
                  <span>{t('mlearn.LevelStudy.Placement.ScoreSkillLabel', { skill })}</span>
                  <input
                    value={formSkillScores()[skill] ?? ''}
                    placeholder={t('mlearn.LevelStudy.Placement.ScoreSkillPlaceholder')}
                    aria-label={t('mlearn.LevelStudy.Placement.ScoreSkillLabel', { skill })}
                    onInput={(event) => setFormSkillScores((scores) => ({ ...scores, [skill]: event.currentTarget.value }))}
                  />
                </label>
              )}
            </For>
            <Show when={dateRequired() && formDate().trim() === ''}>
              <span class="learning-background-panel__date-required">{t('mlearn.LevelStudy.Placement.DateRequired')}</span>
            </Show>
            <div class="learning-background-panel__actions">
              <Button variant="primary" disabled={!canSave()} onClick={save}>{t('mlearn.LevelStudy.Placement.SaveRecord')}</Button>
              <Button variant="secondary" onClick={() => setFormOpen(false)}>{t('mlearn.Global.Cancel')}</Button>
            </div>
          </div>
        }>
          <Button variant="secondary" onClick={() => setFormOpen(true)}>{t('mlearn.LevelStudy.Placement.AddRecord')}</Button>
        </Show>
      </details>
    </Panel>
  );
};

export default LearningBackgroundPanel;
