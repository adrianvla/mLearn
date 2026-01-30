/**
 * Customization Settings Tab
 */

import { Component } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, TabContent, Select } from '../../../components/common';

export const CustomizationTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.Groups.SubtitleAppearance'),
        description: t('mlearn.Settings.UI.Description'),
        icon: '🎨',
      }}
      padding="lg"
    >

      <SettingGroup title={t('mlearn.Settings.Groups.SubtitleAppearance')}>
        <SettingRow
          label={t('mlearn.Settings.Subtitle.Theme.Label')}
          description={t('mlearn.Settings.Subtitle.Theme.Description')}
        >
          <Select
            class="setting-select"
            value={settings.subtitleTheme}
            onChange={(e) => updateSettings({ subtitleTheme: e.currentTarget.value as any })}
          >
            <option value="shadow">{t('mlearn.Settings.Subtitle.Themes.Shadow')}</option>
            <option value="background">{t('mlearn.Settings.Subtitle.Themes.Background')}</option>
            <option value="marker">{t('mlearn.Settings.Subtitle.Themes.Marker')}</option>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Subtitle.FontSize.Label')}
          description={t('mlearn.Settings.Subtitle.FontSize.Description')}
        >
          <input
            type="number"
            class="setting-input"
            value={settings.subtitle_font_size}
            min={12}
            max={80}
            onChange={(e) => updateSettings({ subtitle_font_size: parseInt(e.currentTarget.value) })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Subtitle.FontWeight.Label')}
          description={t('mlearn.Settings.Subtitle.FontWeight.Description')}
        >
          <Select
            class="setting-select"
            value={settings.subtitle_font_weight.toString()}
            onChange={(e) => updateSettings({ subtitle_font_weight: parseInt(e.currentTarget.value) })}
          >
            <option value="100">{t('mlearn.Settings.Subtitle.FontWeights.Thin')}</option>
            <option value="200">{t('mlearn.Settings.Subtitle.FontWeights.ExtraLight')}</option>
            <option value="300">{t('mlearn.Settings.Subtitle.FontWeights.Light')}</option>
            <option value="400">{t('mlearn.Settings.Subtitle.FontWeights.Normal')}</option>
            <option value="500">{t('mlearn.Settings.Subtitle.FontWeights.Medium')}</option>
            <option value="600">{t('mlearn.Settings.Subtitle.FontWeights.SemiBold')}</option>
            <option value="700">{t('mlearn.Settings.Subtitle.FontWeights.Bold')}</option>
            <option value="800">{t('mlearn.Settings.Subtitle.FontWeights.ExtraBold')}</option>
            <option value="900">{t('mlearn.Settings.Subtitle.FontWeights.Black')}</option>
          </Select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.SubtitleTiming')}>
        <SettingRow
          label={t('mlearn.Settings.Subtitle.Offset.Label')}
          description={t('mlearn.Settings.Subtitle.Offset.Description')}
        >
          <input
            type="number"
            class="setting-input"
            value={settings.subsOffsetTime}
            step={100}
            onChange={(e) => updateSettings({ subsOffsetTime: parseInt(e.currentTarget.value) })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.ThemePreview')}>
        <div style={{ padding: "20px", background: "#000", "border-radius": "8px" }}>
          <p
            style={{
              "font-size": `${settings.subtitle_font_size}px`,
              "font-weight": settings.subtitle_font_weight,
              "text-align": "center",
              color: "white",
              "text-shadow": settings.subtitleTheme === 'shadow' 
                ? '2px 2px 4px rgba(0,0,0,0.8)' 
                : 'none',
              background: settings.subtitleTheme === 'background' 
                ? 'rgba(0,0,0,0.7)' 
                : settings.subtitleTheme === 'marker'
                ? 'linear-gradient(transparent 60%, rgba(255,255,0,0.4) 60%)'
                : 'none',
              padding: "10px",
            }}
          >
            日本語を勉強しています
          </p>
        </div>
      </SettingGroup>
    </TabContent>
  );
};
