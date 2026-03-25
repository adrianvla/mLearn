/**
 * Behaviour Settings Tab
 */

import { Component, Show, createMemo } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, TargetIcon, Select, SortableList, Input } from '../../../components/common';
import type { SortableListItem } from '../../../components/common';
import type { KnowledgeSource, KnowledgeResolutionMode } from '../../../../shared/constants';
import '../SettingsForm.css';

export const BehaviourTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();

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
    // Preserve hidden sources (e.g. Anki when disabled) at their relative position
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
        {/* Built-in SRS thresholds + ease (always visible) */}
        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.EaseMapping.LearningEase.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.EaseMapping.LearningEase.Description')}
        >
          <Input
            type="number"
            value={settings.srsLearningEase}
            min={1.0}
            max={5.0}
            step={0.05}
            onInput={(e) => {
              const val = parseFloat(e.currentTarget.value);
              if (!isNaN(val) && val >= 1.0 && val <= 5.0) {
                updateSettings({ srsLearningEase: val });
              }
            }}
          />
        </SettingRow>

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

        <SettingRow
          label={t('mlearn.Settings.SRS.BuiltInFlashcards.EaseMapping.KnownEase.Label')}
          description={t('mlearn.Settings.SRS.BuiltInFlashcards.EaseMapping.KnownEase.Description')}
        >
          <Input
            type="number"
            value={settings.srsKnownEase}
            min={1.0}
            max={5.0}
            step={0.05}
            onInput={(e) => {
              const val = parseFloat(e.currentTarget.value);
              if (!isNaN(val) && val >= 1.0 && val <= 5.0) {
                updateSettings({ srsKnownEase: val });
              }
            }}
          />
        </SettingRow>

        {/* Anki thresholds + ease (only when Anki is enabled) */}
        <Show when={settings.use_anki}>
          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.EaseMapping.LearningEase.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.EaseMapping.LearningEase.Description')}
          >
            <Input
              type="number"
              value={settings.ankiLearningEase}
              min={1000}
              max={3000}
              step={10}
              onInput={(e) => {
                const val = parseInt(e.currentTarget.value, 10);
                if (!isNaN(val) && val >= 1000 && val <= 3000) {
                  updateSettings({ ankiLearningEase: val });
                }
              }}
            />
          </SettingRow>

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

          <SettingRow
            label={t('mlearn.Settings.SRS.AnkiIntegration.EaseMapping.KnownEase.Label')}
            description={t('mlearn.Settings.SRS.AnkiIntegration.EaseMapping.KnownEase.Description')}
          >
            <Input
              type="number"
              value={settings.ankiKnownEase}
              min={1000}
              max={3000}
              step={10}
              onInput={(e) => {
                const val = parseInt(e.currentTarget.value, 10);
                if (!isNaN(val) && val >= 1000 && val <= 3000) {
                  updateSettings({ ankiKnownEase: val });
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
      </SettingGroup>

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

      <SettingGroup title={t('mlearn.Settings.Groups.DisplayOptions')}>
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
