/**
 * Behaviour Settings Tab
 */

import { Component, Show, For } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, TargetIcon, Select, Input, Btn } from '../../../components/common';
import { DEFAULT_SETTINGS } from '../../../../shared/types';
import { getBridge } from '../../../../shared/bridges';
import { getPassiveHoverDelayMs } from '@shared/utils/passiveWordTracking';
import type { RatingKeyboardMode } from '@shared/constants';
import '../SettingsForm.css';

export const BehaviourTab: Component = () => {
  const { settings, updateSettings, isSettingManaged } = useSettings();
  const { t } = useLocalization();

  const passiveHoverDelayMs = () => getPassiveHoverDelayMs(settings);

  const easeThresholds = [
    { key: 'easeThresholdUnknown' as const, labelKey: 'EaseUnknown', default: DEFAULT_SETTINGS.easeThresholdUnknown },
    { key: 'easeThresholdLearning' as const, labelKey: 'EaseLearning', default: DEFAULT_SETTINGS.easeThresholdLearning },
    { key: 'easeThresholdKnown' as const, labelKey: 'EaseKnown', default: DEFAULT_SETTINGS.easeThresholdKnown },
    { key: 'easeThresholdMastered' as const, labelKey: 'EaseMastered', default: DEFAULT_SETTINGS.easeThresholdMastered },
  ];

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.Groups.Behaviour'),
        description: t('mlearn.Settings.UI.Description'),
        icon: <TargetIcon size={20} />,
      }}
      padding="lg"
    >

      <SettingGroup title={t('mlearn.LevelStudy.Title')}>
        <p>{t('mlearn.LearningPlan.SettingsHint')}</p>
        <Btn onClick={() => getBridge().window.openWindow({ type: 'level-study' })}>{t('mlearn.LearningPlan.Open')}</Btn>
      </SettingGroup>
      <SettingGroup title={t('mlearn.Settings.Groups.WordKnowledge')}>
        <details>
          <summary>{t('mlearn.Knowledge.Projection.Relations.Advanced')}</summary>
          <p>{t('mlearn.Settings.WordStatus.TechnicalCalibration')}</p>
        <SettingRow
          label={t('mlearn.Settings.WordStatus.SrsLearningThreshold.Label')}
          description={t('mlearn.Settings.WordStatus.SrsLearningThreshold.Description')}
          settingKey="srsLearningThreshold"
        >
          <Input
            type="number"
            value={settings.srsLearningThreshold}
            min={0}
            max={5000}
            step={100}
            onInput={(e) => {
              const val = parseInt(e.currentTarget.value, 10);
              if (!isNaN(val) && val >= 0 && val <= 5000) {
                updateSettings({ srsLearningThreshold: val });
              }
            }}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.WordStatus.KnownThreshold.Label')}
          description={t('mlearn.Settings.WordStatus.KnownThreshold.Description')}
          settingKey="known_ease_threshold"
        >
          <Input
            type="number"
            value={settings.known_ease_threshold}
            min={0}
            max={5000}
            step={100}
            onInput={(e) => {
              const val = parseInt(e.currentTarget.value, 10);
              if (!isNaN(val) && val >= 0 && val <= 5000) {
                updateSettings({ known_ease_threshold: val });
              }
            }}
          />
        </SettingRow>

        <For each={easeThresholds}>
          {(item) => (
            <SettingRow
              label={t(`mlearn.Settings.WordStatus.${item.labelKey}Threshold.Label`)}
              description={t(`mlearn.Settings.WordStatus.${item.labelKey}Threshold.Description`)}
              settingKey={item.key}
            >
              <div class="ease-threshold-row">
                <Input
                    type="number"
                    value={Math.round((settings[item.key] ?? item.default) * 100)}
                    min={130}
                    max={500}
                    step={1}
                    onInput={(e) => {
                      const val = parseInt(e.currentTarget.value, 10);
                      if (!isNaN(val) && val >= 130 && val <= 500) {
                        updateSettings({[item.key]: val / 100});
                      }
                    }}
                />
              </div>
            </SettingRow>
          )}
        </For>

        {/* Anki thresholds (only when Anki is enabled) */}
        <Show when={settings.use_anki || isSettingManaged('ankiLearningThreshold') || isSettingManaged('ankiKnownThreshold')}>
          <SettingRow
              label={t('mlearn.Settings.WordStatus.AnkiLearningThreshold.Label')}
            description={t('mlearn.Settings.WordStatus.AnkiLearningThreshold.Description')}
            settingKey="ankiLearningThreshold"
          >
            <Input
              type="number"
              value={settings.ankiLearningThreshold}
              min={1000}
              max={3000}
              step={10}
              onInput={(e) => {
                const val = parseInt(e.currentTarget.value, 10);
                if (!isNaN(val) && val >= 1000 && val <= 3000) {
                  updateSettings({ ankiLearningThreshold: val });
                }
              }}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.WordStatus.AnkiKnownThreshold.Label')}
            description={t('mlearn.Settings.WordStatus.AnkiKnownThreshold.Description')}
            settingKey="ankiKnownThreshold"
          >
            <Input
              type="number"
              value={settings.ankiKnownThreshold}
              min={1000}
              max={3000}
              step={10}
              onInput={(e) => {
                const val = parseInt(e.currentTarget.value, 10);
                if (!isNaN(val) && val >= 1000 && val <= 3000) {
                  updateSettings({ ankiKnownThreshold: val });
                }
              }}
            />
          </SettingRow>
        </Show>

        </details>

        <SettingRow
          label={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Label')}
          description={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Description', {
            delay: passiveHoverDelayMs(),
          })}
          settingKey="passiveEaseEnabled"
        >
          <ToggleSwitch
            checked={settings.passiveEaseEnabled}
            onChange={(checked) => updateSettings({ passiveEaseEnabled: checked })}
          />
        </SettingRow>

        <Show when={settings.passiveEaseEnabled}>
          <SettingRow
            label={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.HoverDelay.Label')}
            description={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.HoverDelay.Description')}
          >
            <Input
              type="number"
              value={passiveHoverDelayMs()}
              min={0}
              step={50}
              onInput={(e) => {
                const value = Number.parseInt(e.currentTarget.value, 10);
                if (!Number.isNaN(value)) {
                  updateSettings({ passiveHoverDelayMs: Math.max(0, value) });
                }
              }}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.Behaviour.RatingKeyboardMode.Label')}
            description={t(`mlearn.Settings.Behaviour.RatingKeyboardMode.${settings.ratingKeyboardMode === 'spatial' ? 'SpatialHint' : 'MnemonicHint'}`)}
          >
            <Select
              value={settings.ratingKeyboardMode}
              options={[
                { value: 'mnemonic', label: t('mlearn.Settings.Behaviour.RatingKeyboardMode.Mnemonic') },
                { value: 'spatial', label: t('mlearn.Settings.Behaviour.RatingKeyboardMode.Spatial') },
              ]}
              onChange={(e) => updateSettings({ ratingKeyboardMode: e.currentTarget.value as RatingKeyboardMode })}
            />
          </SettingRow>

        </Show>

        <Show when={settings.passiveEaseEnabled || isSettingManaged('manualStatusEaseBuffer')}>
          <details><summary>{t('mlearn.Knowledge.Projection.Relations.Advanced')}</summary>
          <SettingRow
            label={t('mlearn.Settings.WordStatus.ManualStatusEaseBuffer.Label')}
            description={t('mlearn.Settings.WordStatus.ManualStatusEaseBuffer.Description')}
            settingKey="manualStatusEaseBuffer"
          >
            <Input
              type="number"
              value={settings.manualStatusEaseBuffer}
              min={0}
              max={1}
              step={0.01}
              onInput={(e) => {
                const value = Number.parseFloat(e.currentTarget.value);
                if (!Number.isNaN(value)) {
                  updateSettings({ manualStatusEaseBuffer: Math.max(0, Math.min(1, value)) });
                }
              }}
            />
          </SettingRow>
          </details>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.SuggestedFlashcards')}>
        <SettingRow
          label={t('mlearn.Settings.Behaviour.AutoSuggestFlashcards.Label')}
          description={t('mlearn.Settings.Behaviour.AutoSuggestFlashcards.Description')}
          settingKey="autoSuggestFlashcards"
        >
          <ToggleSwitch
            checked={settings.autoSuggestFlashcards}
            onChange={(checked) => updateSettings({ autoSuggestFlashcards: checked })}
          />
        </SettingRow>
        <Show when={settings.autoSuggestFlashcards || isSettingManaged('autoSuggestUnknownWords')}>
          <SettingRow
            label={t('mlearn.Settings.Behaviour.AutoSuggestUnknownWords.Label')}
            description={t('mlearn.Settings.Behaviour.AutoSuggestUnknownWords.Description')}
            settingKey="autoSuggestUnknownWords"
          >
            <ToggleSwitch
              checked={settings.autoSuggestUnknownWords}
              onChange={(checked) => updateSettings({ autoSuggestUnknownWords: checked })}
            />
          </SettingRow>
        </Show>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.DisplayOptions')}
      >
        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.OpenAside.Label')}
          description={t('mlearn.Settings.DisplayOptions.OpenAside.Description')}
          settingKey="openAside"
        >
          <ToggleSwitch
            checked={settings.openAside}
            onChange={(checked) => updateSettings({ openAside: checked })}
          />
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};
