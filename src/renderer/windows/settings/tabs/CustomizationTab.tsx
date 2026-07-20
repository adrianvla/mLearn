/**
 * Customization Settings Tab
 */

import { Component, For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import {
  SettingRow,
  SettingGroup,
  TabContent,
  Select,
  Btn,
  RangeInput,
  ToggleSwitch,
} from '../../../components/common';
import Icon from '../../../components/common/Icons/Icon';
import type { SubtitleTheme } from '@shared/constants';
import '../SettingsForm.css';
import './CustomizationTab.css';
import { CUSTOMIZABLE_CSS_VARS, CustomColorOverrides } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';
import type {
  ColoredProsodyMixTarget,
  ColoredProsodyStatusLimit,
  ColorCodes,
  LanguageData,
} from '@shared/types';
import { getReadingAnnotationDisplay } from '@shared/languageFeatures';
import {
  readingAnnotationMoreContrastEnabled,
  readingAnnotationSizePercent,
} from '@shared/readingAnnotationSettings';
import { getColoredProsodyConfig, getColoredProsodyPalette } from '../../../utils/coloredProsody';

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

interface PartOfSpeechColorEntry {
  pos: string;
  userColor: string;
  defaultColor: string;
  aliases: string[];
  isTranslatable: boolean;
}

export function buildPartOfSpeechColorEntries(
  langData: LanguageData | null | undefined,
  userCodes: ColorCodes = {},
): PartOfSpeechColorEntry[] {
  const partOfSpeech = langData?.textProcessing?.partOfSpeech;
  const defaultColors = partOfSpeech?.colors ?? {};
  const translatable = partOfSpeech?.translatable ?? [];
  const aliases = partOfSpeech?.aliases ?? {};

  const orderedPos = new Set([
    ...translatable,
    ...Object.keys(defaultColors),
    ...Object.keys(userCodes),
  ]);
  const translatableOrder = new Map(translatable.map((pos, index) => [pos, index]));

  return [...orderedPos]
    .sort((left, right) => {
      const leftOrder = translatableOrder.get(left);
      const rightOrder = translatableOrder.get(right);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
      }
      return left.localeCompare(right);
    })
    .map((pos) => ({
      pos,
      userColor: userCodes[pos] || '',
      defaultColor: defaultColors[pos] || '',
      aliases: Object.entries(aliases)
        .filter(([, canonical]) => canonical === pos)
        .map(([alias]) => alias)
        .sort((left, right) => left.localeCompare(right)),
      isTranslatable: translatable.includes(pos),
    }));
}

export const CustomizationTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData, getLanguageFeatures } = useLanguage();

  const readingDisplay = createMemo(() => getReadingAnnotationDisplay(currentLangData()));
  const supportsReadingAppearance = createMemo(() => (
    getLanguageFeatures().supportsReadings && readingDisplay() !== 'replace'
  ));
  const readingMoreContrast = () => readingAnnotationMoreContrastEnabled(settings);
  const readingSizePercent = () => readingAnnotationSizePercent(settings);
  const readingPreviewStyle = (): JSX.CSSProperties => ({
    '--reading-annotation-color': readingMoreContrast()
      ? 'var(--text-primary)'
      : 'var(--text-secondary)',
    '--reading-annotation-scale': `${readingSizePercent() / 100}`,
  });
  const coloredProsodyConfig = createMemo(() => getColoredProsodyConfig(currentLangData()));
  const coloredProsodyPalette = createMemo(() => {
    const config = coloredProsodyConfig();
    return config ? getColoredProsodyPalette(settings, config) : {};
  });

  const updateProsodyColor = (paletteKey: string, value: string | null) => {
    const config = coloredProsodyConfig();
    if (!config) return;
    const palettes = { ...(settings.coloredProsodyPalettes ?? DEFAULT_SETTINGS.coloredProsodyPalettes) };
    const palette = { ...(palettes[config.paletteId] ?? {}) };
    if (value) {
      palette[paletteKey] = value;
    } else {
      delete palette[paletteKey];
    }
    if (Object.keys(palette).length > 0) {
      palettes[config.paletteId] = palette;
    } else {
      delete palettes[config.paletteId];
    }
    updateSettings({ coloredProsodyPalettes: palettes });
  };

  const resetProsodyPalette = () => {
    const config = coloredProsodyConfig();
    if (!config) return;
    const palettes = { ...(settings.coloredProsodyPalettes ?? DEFAULT_SETTINGS.coloredProsodyPalettes) };
    delete palettes[config.paletteId];
    updateSettings({ coloredProsodyPalettes: palettes });
  };

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
    return buildPartOfSpeechColorEntries(currentLangData(), settings.colour_codes || {});
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
        icon: <Icon icon="palette" color="currentColor" class="" />,
      }}
      padding="lg"
    >

      <Show when={supportsReadingAppearance()}>
        <SettingGroup title={t('mlearn.Settings.Groups.ReadingAppearance')}>
          <SettingRow
            label={t('mlearn.Settings.ReadingAppearance.MoreContrast.Label')}
            description={t('mlearn.Settings.ReadingAppearance.MoreContrast.Description')}
            settingKey="readingAnnotationMoreContrast"
          >
            <ToggleSwitch
              checked={readingMoreContrast()}
              onChange={(checked) => updateSettings({ readingAnnotationMoreContrast: checked })}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.ReadingAppearance.Size.Label')}
            description={t('mlearn.Settings.ReadingAppearance.Size.Description')}
            settingKey="readingAnnotationSizePercent"
          >
            <div class="reading-appearance-size-control">
              <RangeInput
                min={60}
                max={160}
                step={5}
                value={readingSizePercent()}
                onChange={(value) => updateSettings({ readingAnnotationSizePercent: value })}
              />
              <output class="reading-appearance-size-value">{readingSizePercent()}%</output>
            </div>
          </SettingRow>

          <div class="reading-appearance-preview" style={readingPreviewStyle()}>
            <Show
              when={readingDisplay() === 'inline'}
              fallback={
                <ruby class="reading-appearance-preview__ruby">
                  {t('mlearn.Settings.ReadingAppearance.Preview.Surface')}
                  <rt>{t('mlearn.Settings.ReadingAppearance.Preview.Reading')}</rt>
                </ruby>
              }
            >
              <span class="reading-appearance-preview__inline">
                {t('mlearn.Settings.ReadingAppearance.Preview.Surface')}
                <span class="reading-appearance-preview__inline-reading">
                  {t('mlearn.Settings.ReadingAppearance.Preview.Reading')}
                </span>
              </span>
            </Show>
          </div>
        </SettingGroup>
      </Show>

      <SettingGroup title={t('mlearn.Settings.Groups.SubtitleAppearance')}>
        <SettingRow
          label={t('mlearn.Settings.Subtitle.Theme.Label')}
          description={t('mlearn.Settings.Subtitle.Theme.Description')}
          settingKey="subtitleTheme"
        >
          <Select
            class="setting-select"
            value={settings.subtitleTheme}
            onChange={(e) => updateSettings({ subtitleTheme: e.currentTarget.value as SubtitleTheme })}
          >
            <option value="shadow">{t('mlearn.Settings.Subtitle.Themes.Shadow')}</option>
            <option value="background">{t('mlearn.Settings.Subtitle.Themes.Background')}</option>
            <option value="marker">{t('mlearn.Settings.Subtitle.Themes.Marker')}</option>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Subtitle.FontSize.Label')}
          description={t('mlearn.Settings.Subtitle.FontSize.Description')}
          settingKey="subtitle_font_size"
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
          settingKey="subtitle_font_weight"
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
          settingKey="subsOffsetTime"
        >
          <input
            type="number"
            class="setting-input"
            value={settings.subsOffsetTime}
            step={0.1}
            onChange={(e) => {
              const parsed = parseFloat(e.currentTarget.value);
              updateSettings({ subsOffsetTime: Number.isNaN(parsed) ? 0 : parsed });
            }}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.ThemePreview')}>
        <div class="theme-preview__container">
          <p
            class="theme-preview__text"
            style={{
              "font-size": `${settings.subtitle_font_size}px`,
              "font-weight": settings.subtitle_font_weight,
            }}
            classList={{
              'theme-preview__text--shadow': settings.subtitleTheme === 'shadow',
              'theme-preview__text--background': settings.subtitleTheme === 'background',
              'theme-preview__text--marker': settings.subtitleTheme === 'marker',
            }}
          >
            <For each={posEntries()}>
              {(entry) => {
                const color = () => entry.userColor || entry.defaultColor;
                return (
                  <span
                    class="theme-preview__token"
                    style={{ color: settings.do_colour_codes && color() ? color() : undefined }}
                  >
                    {entry.pos}
                  </span>
                );
              }}
            </For>
            <Show when={posEntries().length === 0}>
              <span class="theme-preview__token">Sample Text</span>
            </Show>
          </p>
        </div>
      </SettingGroup>

      <Show when={posEntries().length > 0}>
        <SettingGroup title={t('mlearn.Settings.Groups.PosColors')}>
          <p class="pos-colors__description">
            {t('mlearn.Settings.WordStatus.PosColors.Description')}
          </p>

          <div class="pos-colors__grid">
            <For each={posEntries()}>
              {(entry) => {
                const effectiveColor = () => entry.userColor || entry.defaultColor;
                const cardStyle = (): JSX.CSSProperties => ({
                  '--pos-color': effectiveColor() || '#000000',
                });

                return (
                  <div
                    class="pos-colors__card"
                    classList={{
                      'pos-colors__card--lookup': entry.isTranslatable,
                      'pos-colors__card--custom': Boolean(entry.userColor),
                    }}
                    style={cardStyle()}
                  >
                    <div class="pos-colors__card-header">
                      <span class="pos-colors__swatch" />
                      <div class="pos-colors__label-stack">
                        <span class="pos-colors__label">{entry.pos}</span>
                        <Show when={entry.aliases.length > 0}>
                          <span class="pos-colors__aliases">{entry.aliases.join(' / ')}</span>
                        </Show>
                      </div>
                    </div>
                    <div class="pos-colors__controls">
                      <input
                        type="color"
                        class="pos-colors__color-input"
                        value={effectiveColor() || '#000000'}
                        onChange={(e) => updatePosColor(entry.pos, e.currentTarget.value)}
                      />
                      <input
                        type="text"
                        class="setting-input pos-colors__text-input"
                        placeholder={entry.defaultColor || '#000000'}
                        value={entry.userColor}
                        onChange={(e) => updatePosColor(entry.pos, e.currentTarget.value || null)}
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
                  </div>
                );
              }}
            </For>
          </div>

          <Show when={hasPosColorOverrides()}>
            <div class="pos-colors__reset-row">
              <Btn variant="ghost" size="sm" onClick={resetAllPosColors}>
                {t('mlearn.Settings.WordStatus.PosColors.ResetAll')}
              </Btn>
            </div>
          </Show>
        </SettingGroup>
      </Show>

      <Show when={coloredProsodyConfig()}>
        {(config) => (
          <SettingGroup title={t('mlearn.Settings.Groups.ColoredProsody')}>
            <SettingRow
              label={t('mlearn.Settings.ColoredProsody.Enabled.Label')}
              description={t('mlearn.Settings.ColoredProsody.Enabled.Description')}
            >
              <ToggleSwitch
                checked={settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled}
                onChange={(checked) => updateSettings({ coloredProsodyEnabled: checked })}
              />
            </SettingRow>

            <Show when={settings.coloredProsodyEnabled ?? DEFAULT_SETTINGS.coloredProsodyEnabled}>
              <SettingRow
                label={t('mlearn.Settings.ColoredProsody.StatusLimit.Label')}
                description={t('mlearn.Settings.ColoredProsody.StatusLimit.Description')}
              >
                <Select
                  class="setting-select"
                  value={settings.coloredProsodyStatusLimit ?? DEFAULT_SETTINGS.coloredProsodyStatusLimit}
                  onChange={(event) => updateSettings({
                    coloredProsodyStatusLimit: event.currentTarget.value as ColoredProsodyStatusLimit,
                  })}
                >
                  <option value="learning">{t('mlearn.Settings.ColoredProsody.StatusLimit.Learning')}</option>
                  <option value="known">{t('mlearn.Settings.ColoredProsody.StatusLimit.Known')}</option>
                </Select>
              </SettingRow>

              <SettingRow
                label={t('mlearn.Settings.ColoredProsody.EaseMix.Label')}
                description={t('mlearn.Settings.ColoredProsody.EaseMix.Description')}
              >
                <ToggleSwitch
                  checked={settings.coloredProsodyEaseMixEnabled ?? DEFAULT_SETTINGS.coloredProsodyEaseMixEnabled}
                  onChange={(checked) => updateSettings({ coloredProsodyEaseMixEnabled: checked })}
                />
              </SettingRow>

              <Show when={settings.coloredProsodyEaseMixEnabled ?? DEFAULT_SETTINGS.coloredProsodyEaseMixEnabled}>
                <SettingRow
                  label={t('mlearn.Settings.ColoredProsody.MixTarget.Label')}
                  description={t('mlearn.Settings.ColoredProsody.MixTarget.Description')}
                >
                  <Select
                    class="setting-select"
                    value={settings.coloredProsodyEaseMixTarget ?? DEFAULT_SETTINGS.coloredProsodyEaseMixTarget}
                    onChange={(event) => updateSettings({
                      coloredProsodyEaseMixTarget: event.currentTarget.value as ColoredProsodyMixTarget,
                    })}
                  >
                    <option value="white">{t('mlearn.Settings.ColoredProsody.MixTarget.White')}</option>
                    <option value="part-of-speech">{t('mlearn.Settings.ColoredProsody.MixTarget.PartOfSpeech')}</option>
                  </Select>
                </SettingRow>
              </Show>

              <SettingRow
                label={t('mlearn.Settings.ColoredProsody.Saturation.Label')}
                description={t('mlearn.Settings.ColoredProsody.Saturation.Description')}
              >
                <div class="prosody-colors__saturation-control">
                  <RangeInput
                    min={0}
                    max={100}
                    step={5}
                    value={settings.coloredProsodySaturation ?? DEFAULT_SETTINGS.coloredProsodySaturation}
                    onChange={(value) => updateSettings({ coloredProsodySaturation: value })}
                  />
                  <output>{settings.coloredProsodySaturation ?? DEFAULT_SETTINGS.coloredProsodySaturation}%</output>
                </div>
              </SettingRow>

              <p class="prosody-colors__description">
                {t('mlearn.Settings.ColoredProsody.Palette.Description')}
              </p>
              <div class="prosody-colors__preview" aria-label={t('mlearn.Settings.ColoredProsody.Preview')}>
                <For each={Object.keys(config().colors)}>
                  {(paletteKey) => (
                    <span style={{ color: coloredProsodyPalette()[paletteKey] }}>
                      {config().labels[paletteKey] ?? paletteKey}
                    </span>
                  )}
                </For>
              </div>
              <div class="pos-colors__grid">
                <For each={Object.keys(config().colors)}>
                  {(paletteKey) => {
                    const userColor = () => (
                      settings.coloredProsodyPalettes?.[config().paletteId]?.[paletteKey] ?? ''
                    );
                    const effectiveColor = () => coloredProsodyPalette()[paletteKey];
                    const cardStyle = (): JSX.CSSProperties => ({ '--pos-color': effectiveColor() });
                    return (
                      <div class="pos-colors__card" style={cardStyle()}>
                        <div class="pos-colors__card-header">
                          <span class="pos-colors__swatch" />
                          <span class="pos-colors__label">{config().labels[paletteKey] ?? paletteKey}</span>
                        </div>
                        <div class="pos-colors__controls">
                          <input
                            type="color"
                            class="pos-colors__color-input"
                            value={effectiveColor()}
                            onChange={(event) => updateProsodyColor(paletteKey, event.currentTarget.value)}
                          />
                          <input
                            type="text"
                            class="setting-input pos-colors__text-input"
                            placeholder={config().colors[paletteKey]}
                            value={userColor()}
                            onChange={(event) => updateProsodyColor(paletteKey, event.currentTarget.value || null)}
                          />
                          <Show when={userColor()}>
                            <Btn variant="ghost" size="sm" onClick={() => updateProsodyColor(paletteKey, null)}>
                              {t('mlearn.Settings.WordStatus.PosColors.Reset')}
                            </Btn>
                          </Show>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
              <Show when={settings.coloredProsodyPalettes?.[config().paletteId]}>
                <div class="pos-colors__reset-row">
                  <Btn variant="ghost" size="sm" onClick={resetProsodyPalette}>
                    {t('mlearn.Settings.ColoredProsody.Palette.ResetAll')}
                  </Btn>
                </div>
              </Show>
            </Show>
          </SettingGroup>
        )}
      </Show>

      <SettingGroup title={t('mlearn.Settings.Groups.CustomColors')}>
        <p class="custom-colors__description">
          {t('mlearn.Settings.CustomColors.Description')}
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
                <div class="custom-colors__row">
                  <input
                    type="color"
                    class="custom-colors__color-input"
                    value={currentValue() || '#000000'}
                    onChange={(e) => updateCustomColor(varName as keyof CustomColorOverrides, e.currentTarget.value)}
                  />
                  <input
                    type="text"
                    class="setting-input custom-colors__text-input"
                    placeholder="#000000"
                    value={currentValue()}
                    onChange={(e) => updateCustomColor(varName as keyof CustomColorOverrides, e.currentTarget.value || null)}
                  />
                  <Show when={currentValue()}>
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => updateCustomColor(varName as keyof CustomColorOverrides, null)}
                    >
                      {t('mlearn.Settings.CustomColors.Reset')}
                    </Btn>
                  </Show>
                </div>
              </SettingRow>
            );
          }}
        </For>

        <Show when={hasCustomColors()}>
          <div class="custom-colors__reset-row">
            <Btn variant="ghost" size="sm" onClick={resetAllCustomColors}>
              {t('mlearn.Settings.CustomColors.ResetAll')}
            </Btn>
          </div>
        </Show>
      </SettingGroup>
    </TabContent>
  );
};
