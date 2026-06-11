/**
 * Behaviour Settings Tab
 */

import { Component, Show, For, createMemo } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, TargetIcon, Select, Input, SortableList } from '../../../components/common';
import type { SortableListItem } from '../../../components/common';
import { PASSIVE_HOVER_FAIL_ACTIONS, SRS_EASE, type KnowledgeSource, type KnowledgeResolutionMode } from '../../../../shared/constants';
import { getPassiveHoverDelayMs, getPassiveHoverEaseDecrease, getPassiveHoverFailAction, getPassiveHoverFailCount } from '@shared/utils/passiveWordTracking';
import '../SettingsForm.css';

export const BehaviourTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { getFreqLevelNames, getLanguageFeatures } = useLanguage();

  const passiveHoverDelayMs = () => getPassiveHoverDelayMs(settings);
  const passiveHoverFailCount = () => getPassiveHoverFailCount(settings);
  const passiveHoverFailAction = () => getPassiveHoverFailAction(settings);
  const passiveHoverEaseDecrease = () => getPassiveHoverEaseDecrease(settings);
  const passiveHoverActionOptions = createMemo(() => PASSIVE_HOVER_FAIL_ACTIONS.map((action) => {
    const key = action === 'decrease-ease' ? 'DecreaseEase'
      : action === 'decrease-ease-and-flashcard' ? 'DecreaseEaseAndFlashcard'
      : 'None';
    return {
      value: action,
      label: t(`mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Action.Options.${key}`),
    };
  }));

  const sourceLabel = (src: KnowledgeSource) =>
    t(`mlearn.Settings.KnowledgePriority.Source.${src[0].toUpperCase() + src.slice(1)}`);

  const resolutionModeOptions = createMemo(() => [
    { value: 'order', label: t('mlearn.Settings.KnowledgePriority.Mode.Order') },
    { value: 'highest', label: t('mlearn.Settings.KnowledgePriority.Mode.Highest') },
    { value: 'lowest', label: t('mlearn.Settings.KnowledgePriority.Mode.Lowest') },
  ]);

  const visibleSourceItems = createMemo<SortableListItem[]>(() => {
    const order = settings.knowledgeSourceOrder;
    return order
      .filter((src: KnowledgeSource) => src !== 'anki' || settings.use_anki)
      .map((src: KnowledgeSource) => ({ id: src, label: sourceLabel(src) }));
  });

  const handleSourceOrderChange = (newIds: string[]) => {
    const hidden = settings.knowledgeSourceOrder.filter(
      (src: KnowledgeSource) => !newIds.includes(src)
    );
    const merged: KnowledgeSource[] = [...newIds as KnowledgeSource[]];
    for (const h of hidden) {
      const oldIdx = settings.knowledgeSourceOrder.indexOf(h);
      const insertAt = Math.min(oldIdx, merged.length);
      merged.splice(insertAt, 0, h);
    }
    updateSettings({ knowledgeSourceOrder: merged });
  };

  const freqLevels = createMemo(() => {
    const names = getFreqLevelNames();
    return Object.entries(names).sort((a, b) => Number(b[0]) - Number(a[0]));
  });

  const hasFreqLevels = createMemo(() => getLanguageFeatures().supportsFrequencyLevels);

  const passiveExposures = (ease: number) => {
    const bump = 0.01;
    return Math.max(0, Math.round((ease - SRS_EASE.MIN) / bump));
  };

  const easeThresholds = [
    { key: 'easeThresholdUnknown' as const, labelKey: 'EaseUnknown', default: SRS_EASE.MIN },
    { key: 'easeThresholdLearning' as const, labelKey: 'EaseLearning', default: SRS_EASE.DEFAULT_LEARNING },
    { key: 'easeThresholdKnown' as const, labelKey: 'EaseKnown', default: SRS_EASE.DEFAULT_KNOWN },
    { key: 'easeThresholdMastered' as const, labelKey: 'EaseMastered', default: SRS_EASE.DEFAULT_KNOWN + 0.5 },
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

      <SettingGroup title={t('mlearn.Settings.Groups.WordKnowledge')}>
        {/* Built-in SRS thresholds (always visible) */}
        <SettingRow
          label={t('mlearn.Settings.WordStatus.SrsLearningThreshold.Label')}
          description={t('mlearn.Settings.WordStatus.SrsLearningThreshold.Description')}
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
            >
              <div class="ease-threshold-row">
                <span class="ease-exposures">
                  {t('mlearn.Settings.WordStatus.EquivalentExposures', {count: String(passiveExposures(settings[item.key] ?? item.default))})}
                </span>
                <Input
                    type="number"
                    value={Math.round((settings[item.key] ?? item.default) * 100)}
                    min={130}
                    max={500}
                    step={1}
                    style={{width: '80px'}}
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
        <Show when={settings.use_anki}>
          <SettingRow
              label={t('mlearn.Settings.WordStatus.AnkiLearningThreshold.Label')}
            description={t('mlearn.Settings.WordStatus.AnkiLearningThreshold.Description')}
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

        <SettingRow
          label={t('mlearn.Settings.WordStatus.ColourKnown.Label')}
          description={t('mlearn.Settings.WordStatus.ColourKnown.Description')}
        >
          <ToggleSwitch
            checked={settings.do_colour_known}
            onChange={(checked) => updateSettings({ do_colour_known: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.WordStatus.KnownColour.Label')}
          description={t('mlearn.Settings.WordStatus.KnownColour.Description')}
        >
          <div class="color-input-wrapper">
            <input
              type="color"
              class="setting-color"
              value={settings.colour_known}
              onChange={(e) => updateSettings({ colour_known: e.currentTarget.value })}
            />
            <span class="color-value">{settings.colour_known}</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.WordStatus.ColourCodes.Label')}
          description={t('mlearn.Settings.WordStatus.ColourCodes.Description')}
        >
          <ToggleSwitch
            checked={settings.do_colour_codes}
            onChange={(checked) => updateSettings({ do_colour_codes: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Label')}
          description={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Description', {
            delay: passiveHoverDelayMs(),
            count: passiveHoverFailCount(),
          })}
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
            label={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.FailCount.Label')}
            description={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.FailCount.Description')}
          >
            <Input
              type="number"
              value={passiveHoverFailCount()}
              min={1}
              step={1}
              onInput={(e) => {
                const value = Number.parseInt(e.currentTarget.value, 10);
                if (!Number.isNaN(value)) {
                  updateSettings({ passiveHoverFailCount: Math.max(1, value) });
                }
              }}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Action.Label')}
            description={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Action.Description')}
          >
            <Select
              value={passiveHoverFailAction()}
              options={passiveHoverActionOptions()}
              onChange={(e) => updateSettings({ passiveHoverFailAction: e.currentTarget.value as typeof PASSIVE_HOVER_FAIL_ACTIONS[number] })}
            />
          </SettingRow>

          <Show when={passiveHoverFailAction() === 'decrease-ease' || passiveHoverFailAction() === 'decrease-ease-and-flashcard'}>
            <SettingRow
              label={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.EaseDecrease.Label')}
              description={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.EaseDecrease.Description')}
            >
              <Input
                type="number"
                value={passiveHoverEaseDecrease()}
                min={0}
                step={0.01}
                onInput={(e) => {
                  const value = Number.parseFloat(e.currentTarget.value);
                  if (!Number.isNaN(value)) {
                    updateSettings({ passiveHoverEaseDecrease: Math.max(0, value) });
                  }
                }}
              />
            </SettingRow>
          </Show>

          <SettingRow
            label={t('mlearn.Settings.WordStatus.ManualStatusEaseBuffer.Label')}
            description={t('mlearn.Settings.WordStatus.ManualStatusEaseBuffer.Description')}
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
        </Show>
      </SettingGroup>

      <Show when={hasFreqLevels()}>
        <SettingGroup title={t('mlearn.Settings.Groups.LanguageProficiency')}>
          <SettingRow
            label={t('mlearn.Settings.Behaviour.LearningLanguageLevel.Label')}
            description={t('mlearn.Settings.Behaviour.LearningLanguageLevel.Description')}
          >
            <Select
              class="setting-select"
              value={settings.learningLanguageLevel != null ? String(settings.learningLanguageLevel) : ''}
              onChange={(e) => {
                const val = e.currentTarget.value;
                updateSettings({ learningLanguageLevel: val ? parseInt(val) : null });
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

      <SettingGroup title={t('mlearn.Settings.Groups.KnowledgePriority')}>
        <SettingRow
          label={t('mlearn.Settings.KnowledgePriority.ResolutionMode.Label')}
          description={t('mlearn.Settings.KnowledgePriority.ResolutionMode.Description')}
        >
          <Select
            value={settings.knowledgeResolutionMode}
            options={resolutionModeOptions()}
            onChange={(e) => updateSettings({ knowledgeResolutionMode: e.currentTarget.value as KnowledgeResolutionMode })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.KnowledgePriority.SourceOrder.Label')}
          description={t('mlearn.Settings.KnowledgePriority.SourceOrder.Description')}
        >
          <SortableList
            items={visibleSourceItems()}
            onChange={handleSourceOrderChange}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.DisplayOptions')}
      >
        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.OpenAside.Label')}
          description={t('mlearn.Settings.DisplayOptions.OpenAside.Description')}
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
