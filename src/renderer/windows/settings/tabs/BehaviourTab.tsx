/**
 * Behaviour Settings Tab
 */

import { Component } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, RangeInput } from '../../../components/common';

export const BehaviourTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.Groups.WordStatus'),
        description: t('mlearn.Settings.UI.Description'),
        icon: '🎯',
      }}
      padding="lg"
    >

      <SettingGroup title={t('mlearn.Settings.Groups.WordStatus')}>
        <SettingRow
          label={t('mlearn.Settings.WordStatus.KnownThreshold.Label')}
          description={t('mlearn.Settings.WordStatus.KnownThreshold.Description')}
        >
          <input
            type="number"
            class="setting-input"
            value={settings.known_ease_threshold}
            min={1000}
            max={5000}
            step={100}
            onChange={(e) => updateSettings({ known_ease_threshold: parseInt(e.currentTarget.value) })}
          />
        </SettingRow>

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

      <SettingGroup title={t('mlearn.Settings.Groups.BlurEffect')}>
        <SettingRow
          label={t('mlearn.Settings.BlurEffect.BlurWords.Label')}
          description={t('mlearn.Settings.BlurEffect.BlurWords.Description')}
        >
          <ToggleSwitch
            checked={settings.blur_words}
            onChange={(checked) => updateSettings({ blur_words: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.BlurEffect.BlurKnownSubtitles.Label')}
          description={t('mlearn.Settings.BlurEffect.BlurKnownSubtitles.Description')}
        >
          <ToggleSwitch
            checked={settings.blur_known_subtitles}
            onChange={(checked) => updateSettings({ blur_known_subtitles: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.BlurEffect.BlurAmount.Label')}
          description={t('mlearn.Settings.BlurEffect.BlurAmount.Description')}
        >
          <RangeInput
            min={1}
            max={20}
            value={settings.blur_amount}
            onChange={(value) => updateSettings({ blur_amount: value })}
            class="setting-range"
          />
          <span style={{ "margin-left": "8px" }}>{settings.blur_amount}px</span>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.DisplayOptions')}>
        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.ShowFurigana.Label')}
          description={t('mlearn.Settings.DisplayOptions.ShowFurigana.Description')}
        >
          <ToggleSwitch
            checked={settings.furigana}
            onChange={(checked) => updateSettings({ furigana: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.ShowPitchAccent.Label')}
          description={t('mlearn.Settings.DisplayOptions.ShowPitchAccent.Description')}
        >
          <ToggleSwitch
            checked={settings.showPitchAccent}
            onChange={(checked) => updateSettings({ showPitchAccent: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.ShowPos.Label')}
          description={t('mlearn.Settings.DisplayOptions.ShowPos.Description')}
        >
          <ToggleSwitch
            checked={settings.show_pos}
            onChange={(checked) => updateSettings({ show_pos: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.ImmediateFetch.Label')}
          description={t('mlearn.Settings.DisplayOptions.ImmediateFetch.Description')}
        >
          <ToggleSwitch
            checked={settings.openAside}
            onChange={(checked) => updateSettings({ openAside: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.Performance')}>
        <SettingRow
          label={t('mlearn.Settings.DisplayOptions.ImmediateFetch.Label')}
          description={t('mlearn.Settings.DisplayOptions.ImmediateFetch.Description')}
        >
          <ToggleSwitch
            checked={settings.immediateFetch}
            onChange={(checked) => updateSettings({ immediateFetch: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Performance.HoverKnownGetFromDictionary.Label')}
          description={t('mlearn.Settings.Performance.HoverKnownGetFromDictionary.Description')}
        >
          <ToggleSwitch
            checked={settings.hover_known_get_from_dictionary}
            onChange={(checked) => updateSettings({ hover_known_get_from_dictionary: checked })}
          />
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};
