/**
 * Customization Settings Tab
 */

import { Component, For, Show, createMemo } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import { SettingRow, SettingGroup, TabContent, Select, Btn } from '../../../components/common';
import { CUSTOMIZABLE_CSS_VARS, CustomColorOverrides } from '@shared/types';

/** Labels for CSS variables (user-friendly names) */
const CSS_VAR_LABELS: Record<string, { label: string; description: string }> = {
  'bg-opaque': { label: 'Background (Opaque)', description: 'Main solid background color' },
  'text-primary': { label: 'Text Primary', description: 'Primary text color' },
  'text-secondary': { label: 'Text Secondary', description: 'Secondary text color (muted)' },
  'text-tertiary': { label: 'Text Tertiary', description: 'Tertiary text color (more muted)' },
  'bg': { label: 'Background', description: 'Semi-transparent background color' },
  'bg-intense': { label: 'Background (Intense)', description: 'More opaque background color' },
  'border-color': { label: 'Border Color', description: 'Standard border color' },
  'border-color-intense': { label: 'Border Color (Intense)', description: 'More visible border color' },
};

export const CustomizationTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData } = useLanguage();

  /** Update a single custom color */
  const updateCustomColor = (varName: keyof CustomColorOverrides, value: string | null) => {
    const currentColors = settings.customColors || {};
    const newColors = { ...currentColors };
    
    if (value === null || value === '') {
      delete newColors[varName];
    } else {
      newColors[varName] = value;
    }
    
    updateSettings({ customColors: newColors });
  };

  /** Reset all custom colors */
  const resetAllCustomColors = () => {
    updateSettings({ customColors: {} });
  };

  /** Check if any custom colors are set */
  const hasCustomColors = () => {
    const colors = settings.customColors || {};
    return Object.keys(colors).length > 0;
  };

  /** Get all POS tags available from the current language data */
  const posEntries = createMemo(() => {
    const langData = currentLangData();
    const langCodes = langData?.colour_codes || {};
    const userCodes = settings.colour_codes || {};
    // Merge lang defaults with user overrides to show all known POS tags
    const allPos = new Set([...Object.keys(langCodes), ...Object.keys(userCodes)]);
    return [...allPos].map((pos) => ({
      pos,
      userColor: userCodes[pos] || '',
      defaultColor: langCodes[pos] || '',
    }));
  });

  /** Update a single POS color override */
  const updatePosColor = (pos: string, value: string | null) => {
    const currentCodes = { ...settings.colour_codes };
    if (value === null || value === '') {
      delete currentCodes[pos];
    } else {
      currentCodes[pos] = value;
    }
    updateSettings({ colour_codes: currentCodes });
  };

  /** Reset all POS color overrides */
  const resetAllPosColors = () => {
    updateSettings({ colour_codes: {} });
  };

  /** Check if any POS color overrides are set */
  const hasPosColorOverrides = () => {
    return Object.keys(settings.colour_codes || {}).length > 0;
  };

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

      <Show when={posEntries().length > 0}>
        <SettingGroup title={t('mlearn.Settings.Groups.PosColors')}>
          <p style={{
            "font-size": "var(--font-size-sm)",
            color: "var(--text-secondary)",
            "margin-bottom": "var(--spacing-4)",
            "line-height": "var(--line-height-normal)"
          }}>
            {t('mlearn.Settings.WordStatus.PosColors.Description')}
          </p>

          <For each={posEntries()}>
            {(entry) => {
              const effectiveColor = () => entry.userColor || entry.defaultColor;

              return (
                <SettingRow label={entry.pos}>
                  <div style={{ display: 'flex', gap: 'var(--spacing-2)', "align-items": 'center' }}>
                    <input
                      type="color"
                      value={effectiveColor() || '#000000'}
                      onChange={(e) => updatePosColor(entry.pos, e.currentTarget.value)}
                      style={{
                        width: '40px',
                        height: '32px',
                        padding: '2px',
                        border: '1px solid var(--border-color)',
                        "border-radius": 'var(--radius-sm)',
                        cursor: 'pointer',
                        background: 'var(--bg)',
                      }}
                    />
                    <input
                      type="text"
                      class="setting-input"
                      placeholder={entry.defaultColor || '#000000'}
                      value={entry.userColor}
                      onChange={(e) => updatePosColor(entry.pos, e.currentTarget.value || null)}
                      style={{ width: '100px' }}
                    />
                    <Show when={entry.userColor}>
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => updatePosColor(entry.pos, null)}
                      >
                        {t('mlearn.Settings.WordStatus.PosColors.Reset')}
                      </Btn>
                    </Show>
                  </div>
                </SettingRow>
              );
            }}
          </For>

          <Show when={hasPosColorOverrides()}>
            <div style={{ "margin-top": "var(--spacing-4)", "text-align": "right" }}>
              <Btn variant="ghost" size="sm" onClick={resetAllPosColors}>
                {t('mlearn.Settings.WordStatus.PosColors.ResetAll')}
              </Btn>
            </div>
          </Show>
        </SettingGroup>
      </Show>

      <SettingGroup title="Custom Color Overrides">
        <p style={{ 
          "font-size": "0.85em", 
          color: "var(--text-secondary)", 
          "margin-bottom": "16px",
          "line-height": "1.5"
        }}>
          Override specific colors that apply globally regardless of theme. 
          Leave empty to use the theme's default color.
        </p>

        <For each={[...CUSTOMIZABLE_CSS_VARS]}>
          {(varName) => {
            const info = CSS_VAR_LABELS[varName] || { label: varName, description: '' };
            const currentValue = () => (settings.customColors || {})[varName as keyof CustomColorOverrides] || '';
            
            return (
              <SettingRow
                label={info.label}
                description={info.description}
              >
                <div style={{ display: 'flex', gap: '8px', "align-items": 'center' }}>
                  <input
                    type="color"
                    value={currentValue() || '#000000'}
                    onChange={(e) => updateCustomColor(varName as keyof CustomColorOverrides, e.currentTarget.value)}
                    style={{
                      width: '40px',
                      height: '32px',
                      padding: '2px',
                      border: '1px solid var(--border-color)',
                      "border-radius": '4px',
                      cursor: 'pointer',
                      background: 'var(--bg-opaque)',
                    }}
                  />
                  <input
                    type="text"
                    class="setting-input"
                    placeholder="#000000"
                    value={currentValue()}
                    onChange={(e) => updateCustomColor(varName as keyof CustomColorOverrides, e.currentTarget.value || null)}
                    style={{ width: '100px' }}
                  />
                  <Show when={currentValue()}>
                    <button
                      class="btn-secondary"
                      onClick={() => updateCustomColor(varName as keyof CustomColorOverrides, null)}
                      style={{ padding: '4px 8px', "font-size": '0.8em' }}
                    >
                      Reset
                    </button>
                  </Show>
                </div>
              </SettingRow>
            );
          }}
        </For>

        <Show when={hasCustomColors()}>
          <div style={{ "margin-top": "16px", "text-align": "right" }}>
            <button
              class="btn-secondary"
              onClick={resetAllCustomColors}
            >
              Reset All Colors
            </button>
          </div>
        </Show>
      </SettingGroup>
    </TabContent>
  );
};
