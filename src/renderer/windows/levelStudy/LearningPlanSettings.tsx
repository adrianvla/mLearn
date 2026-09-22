import { Component, Show, For, createMemo } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../context';
import { SettingRow, SettingGroup, Select, Input } from '../../components/common';
import { DEFAULT_SETTINGS } from '../../../shared/types';
import { getFrequencyLevelLabel, getLearningLanguageLevelForLanguage, isDisplayableFrequencyLevel, sortFrequencyLevelsForDisplay } from '../../../shared/languageFeatures';
import '../settings/SettingsForm.css';

/** The Learning Plan edits the existing settings owner; it creates no parallel profile. */
export const LearningPlanSettings: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData, getFreqLevelNames, getLanguageFeatures, getWordFrequency } = useLanguage();
  const freqLevels = createMemo(() => {
    const names = getFreqLevelNames();
    const languageData = currentLangData();
    const levels = new Set<number>();
    for (const level of Object.keys(names).map(Number)) {
      if (isDisplayableFrequencyLevel(level, names, languageData)) levels.add(level);
    }
    for (const entry of Object.values(getWordFrequency())) {
      if (isDisplayableFrequencyLevel(entry.raw_level, names, languageData)) levels.add(entry.raw_level);
    }

    return sortFrequencyLevelsForDisplay(Array.from(levels), languageData)
      .map((level) => [String(level), getFrequencyLevelLabel(level, names, currentLangData())] as [string, string]);
  });

  const hasFreqLevels = createMemo(() => (
    getLanguageFeatures().supportsFrequencyLevels
    || Object.keys(currentLangData()?.frequencyProviders ?? {}).length > 0
  ));
  const selectedLearningLanguageLevel = createMemo(() => getLearningLanguageLevelForLanguage(settings, settings.language));
  const frequencyProviders = createMemo(() => currentLangData()?.frequencyProviders ?? {});
  const frequencyProviderEntries = createMemo(() => Object.entries(frequencyProviders()));
  const selectedFrequencyProviderId = createMemo(() => {
    const languageData = currentLangData();
    const providers = frequencyProviders();
    const candidates = [
      settings.frequencyProviderSelections[settings.language],
      languageData?.activeFrequencyProvider,
      languageData?.defaultFrequencyProvider,
      Object.keys(providers)[0],
    ];
    return candidates.find((candidate): candidate is string => (
      typeof candidate === 'string' && Object.prototype.hasOwnProperty.call(providers, candidate)
    )) ?? '';
  });
  const selectedFrequencyProvider = createMemo(() => frequencyProviders()[selectedFrequencyProviderId()]);
  const frequencyLevelSystemEntries = createMemo(() => Object.entries(selectedFrequencyProvider()?.levelSystems ?? {}));
  const selectedFrequencyLevelSystemId = createMemo(() => {
    const languageData = currentLangData();
    const provider = selectedFrequencyProvider();
    const levelSystems = provider?.levelSystems ?? {};
    const candidates = [
      settings.frequencyLevelSystemSelections[settings.language],
      languageData?.activeFrequencyLevelSystem,
      provider?.defaultLevelSystem,
      Object.keys(levelSystems)[0],
    ];
    return candidates.find((candidate): candidate is string => (
      typeof candidate === 'string' && Object.prototype.hasOwnProperty.call(levelSystems, candidate)
    )) ?? '';
  });


  return <div class="learning-plan-settings">
      <Show when={hasFreqLevels()}>
        <SettingGroup title={t('mlearn.Settings.Groups.LanguageProficiency')}>
          <Show when={frequencyProviderEntries().length > 1}>
            <SettingRow
              label={t('mlearn.Settings.Behaviour.FrequencyProvider.Label')}
              description={t('mlearn.Settings.Behaviour.FrequencyProvider.Description')}
            >
              <Select
                class="setting-select"
                value={selectedFrequencyProviderId()}
                onChange={(e) => {
                  const providerId = e.currentTarget.value;
                  const provider = frequencyProviders()[providerId];
                  const nextLevelSystems = { ...settings.frequencyLevelSystemSelections };
                  const defaultLevelSystem = provider?.defaultLevelSystem;
                  if (defaultLevelSystem) {
                    nextLevelSystems[settings.language] = defaultLevelSystem;
                  } else {
                    delete nextLevelSystems[settings.language];
                  }
                  updateSettings({
                    frequencyProviderSelections: {
                      ...settings.frequencyProviderSelections,
                      [settings.language]: providerId,
                    },
                    frequencyLevelSystemSelections: nextLevelSystems,
                    learningLanguageLevels: {
                      ...settings.learningLanguageLevels,
                      [settings.language]: null,
                    },
                  });
                }}
              >
                <For each={frequencyProviderEntries()}>
                  {([providerId, provider]) => (
                    <option value={providerId} selected={providerId === selectedFrequencyProviderId()}>{provider.name}</option>
                  )}
                </For>
              </Select>
            </SettingRow>
          </Show>
          <Show when={frequencyLevelSystemEntries().length > 1}>
            <SettingRow
              label={t('mlearn.Settings.Behaviour.FrequencyLevelSystem.Label')}
              description={t('mlearn.Settings.Behaviour.FrequencyLevelSystem.Description')}
            >
              <Select
                class="setting-select"
                value={selectedFrequencyLevelSystemId()}
                onChange={(e) => {
                  updateSettings({
                    frequencyLevelSystemSelections: {
                      ...settings.frequencyLevelSystemSelections,
                      [settings.language]: e.currentTarget.value,
                    },
                    learningLanguageLevels: {
                      ...settings.learningLanguageLevels,
                      [settings.language]: null,
                    },
                  });
                }}
              >
                <For each={frequencyLevelSystemEntries()}>
                  {([levelSystemId, levelSystem]) => (
                    <option value={levelSystemId} selected={levelSystemId === selectedFrequencyLevelSystemId()}>{levelSystem.name}</option>
                  )}
                </For>
              </Select>
            </SettingRow>
          </Show>
          <SettingRow
            label={t('mlearn.Settings.Behaviour.LearningLanguageLevel.Label')}
            description={t('mlearn.Settings.Behaviour.LearningLanguageLevel.Description')}
          >
            <Select
              class="setting-select"
              value={selectedLearningLanguageLevel() != null ? String(selectedLearningLanguageLevel()) : ''}
              onChange={(e) => {
                const val = e.currentTarget.value;
                const parsed = Number(val);
                const level = val && Number.isFinite(parsed) ? parsed : null;
                updateSettings({
                  learningLanguageLevels: {
                    ...(settings.learningLanguageLevels ?? {}),
                    [settings.language]: level,
                  },
                });
              }}
            >
              <option value="">{t('mlearn.Settings.Behaviour.LearningLanguageLevel.NoLimit')}</option>
              <For each={freqLevels()}>
                {([level, name]) => (
                  <option value={level}>{name}</option>
                )}
              </For>
            </Select>
          </SettingRow>
        </SettingGroup>
      </Show>

      <SettingGroup title={t('mlearn.Settings.Groups.LearningGoal')}>
        <SettingRow
          label={t('mlearn.Settings.Behaviour.SessionIntensity.Label')}
          description={t('mlearn.Settings.Behaviour.SessionIntensity.Description')}
        >
          <Select
            class="setting-select"
            value={settings.sessionIntensity}
            onChange={(e) => {
              const value = e.currentTarget.value;
              if (value === 'gentle' || value === 'steady' || value === 'intensive') {
                updateSettings({ sessionIntensity: value });
              }
            }}
          >
            <option value="gentle" selected={settings.sessionIntensity === 'gentle'}>{t('mlearn.Settings.Behaviour.SessionIntensity.Gentle')}</option>
            <option value="steady" selected={settings.sessionIntensity === 'steady'}>{t('mlearn.Settings.Behaviour.SessionIntensity.Steady')}</option>
            <option value="intensive" selected={settings.sessionIntensity === 'intensive'}>{t('mlearn.Settings.Behaviour.SessionIntensity.Intensive')}</option>
          </Select>
        </SettingRow>

        <Show when={settings.examGoal?.kind === 'exam' && settings.examGoal.language && settings.examGoal.language !== settings.language}>
          <p role="note">{t('mlearn.Settings.Behaviour.ExamGoal.OtherLanguage')}</p>
        </Show>
        <SettingRow
          label={t('mlearn.Settings.Behaviour.ExamGoal.Label')}
          description={t('mlearn.Settings.Behaviour.ExamGoal.Description')}
        >
          <Select
            class="setting-select"
            value={settings.examGoal?.kind ?? DEFAULT_SETTINGS.examGoal.kind}
            onChange={(e) => {
              const value = e.currentTarget.value;
              if (value !== 'exam' && value !== 'none') return;
              const current = settings.examGoal ?? DEFAULT_SETTINGS.examGoal;
              updateSettings({ examGoal: value === 'exam'
                // A goal is scoped to the learning language it is recorded
                // under (R07): a fresh goal inherits the active language; an
                // existing scoped goal keeps its stamp.
                ? { ...current, kind: 'exam', language: current.language ?? settings.language }
                : { kind: 'none' } });
            }}
          >
            <option value="none" selected={(settings.examGoal?.kind ?? DEFAULT_SETTINGS.examGoal.kind) === 'none'}>{t('mlearn.Settings.Behaviour.ExamGoal.None')}</option>
            <option value="exam" selected={settings.examGoal?.kind === 'exam'}>{t('mlearn.Settings.Behaviour.ExamGoal.Exam')}</option>
          </Select>
        </SettingRow>

        <Show when={settings.examGoal?.kind === 'exam'}>
          <SettingRow
            label={t('mlearn.Settings.Behaviour.ExamGoal.Target.Label')}
            description={t('mlearn.Settings.Behaviour.ExamGoal.Target.Description')}
          >
            <Input
              type="text"
              value={settings.examGoal?.target ?? ''}
              placeholder={t('mlearn.Settings.Behaviour.ExamGoal.Target.Placeholder')}
              onInput={(e) => {
                const target = e.currentTarget.value;
                const current = settings.examGoal ?? DEFAULT_SETTINGS.examGoal;
                // Clearing the field must drop the stored value, not spread the stale one back.
                const next: typeof DEFAULT_SETTINGS.examGoal = {
                  ...current,
                  kind: 'exam',
                  language: current.language ?? settings.language,
                };
                delete next.target;
                if (target) next.target = target;
                updateSettings({ examGoal: next });
              }}
            />
          </SettingRow>
          <SettingRow
            label={t('mlearn.Settings.Behaviour.ExamGoal.Deadline.Label')}
            description={t('mlearn.Settings.Behaviour.ExamGoal.Deadline.Description')}
          >
            <Input
              type="date"
              value={settings.examGoal?.deadline ?? ''}
              onInput={(e) => {
                const deadline = e.currentTarget.value;
                const current = settings.examGoal ?? DEFAULT_SETTINGS.examGoal;
                // Clearing the date must drop the stored deadline, not spread the stale one back.
                const next: typeof DEFAULT_SETTINGS.examGoal = {
                  ...current,
                  kind: 'exam',
                  language: current.language ?? settings.language,
                };
                delete next.deadline;
                if (deadline) next.deadline = deadline;
                updateSettings({ examGoal: next });
              }}
            />
          </SettingRow>
        </Show>
      </SettingGroup>

  </div>;
};
