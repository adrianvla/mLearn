import { Component, Show, For, createMemo } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../context';
import { SettingRow, SettingGroup, Select, LearningGoals } from '../../components/common';
import { activeLearningGoals, learningGoalsForSettings } from '../../../shared/learningGoals';
import { learningTargetSettingsUpdate } from '../../../shared/learningScope';
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
      (settings.frequencyLevelSystemsByProvider ?? DEFAULT_SETTINGS.frequencyLevelSystemsByProvider)[settings.language]?.[selectedFrequencyProviderId()],
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
      <Show when={hasFreqLevels() && !activeLearningGoals(learningGoalsForSettings(settings), settings.language).length}>
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
                  if (!provider) return;
                  const nextLevelSystems = { ...settings.frequencyLevelSystemSelections };
                  const storedSystems = settings.frequencyLevelSystemsByProvider ?? DEFAULT_SETTINGS.frequencyLevelSystemsByProvider;
                  const currentProviderId = selectedFrequencyProviderId();
                  const providerTargets = settings.frequencyProviderTargets ?? DEFAULT_SETTINGS.frequencyProviderTargets;
                  const nextTargets = {
                    ...(providerTargets[settings.language] ?? {}),
                    [currentProviderId]: selectedLearningLanguageLevel(),
                  };
                  const defaultLevelSystem = storedSystems[settings.language]?.[providerId] ?? provider.defaultLevelSystem;
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
                    frequencyProviderTargets: {
                      ...providerTargets,
                      [settings.language]: nextTargets,
                    },
                    learningLanguageLevels: {
                      ...settings.learningLanguageLevels,
                      [settings.language]: nextTargets[providerId] ?? null,
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
                  const providerId = selectedFrequencyProviderId();
                  const byProvider = settings.frequencyLevelSystemsByProvider ?? DEFAULT_SETTINGS.frequencyLevelSystemsByProvider;
                  updateSettings({
                    frequencyLevelSystemSelections: {
                      ...settings.frequencyLevelSystemSelections,
                      [settings.language]: e.currentTarget.value,
                    },
                    frequencyLevelSystemsByProvider: {
                      ...byProvider,
                      [settings.language]: {
                        ...(byProvider[settings.language] ?? {}),
                        [providerId]: e.currentTarget.value,
                      },
                    },
                    learningLanguageLevels: {
                      ...settings.learningLanguageLevels,
                      [settings.language]: (settings.frequencyProviderTargets ?? DEFAULT_SETTINGS.frequencyProviderTargets)[settings.language]?.[providerId] ?? selectedLearningLanguageLevel(),
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
                updateSettings(learningTargetSettingsUpdate(settings, settings.language, level, currentLangData()));
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

      <SettingGroup title={t('mlearn.Goals.Purpose')}>
        <LearningGoals />

      </SettingGroup>

  </div>;
};
