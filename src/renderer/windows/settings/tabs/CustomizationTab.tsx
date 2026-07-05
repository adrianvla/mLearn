/**
 * Customization Settings Tab
 */

import { Component, For, Show, createMemo } from 'solid-js';
import type { JSX } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import { SettingRow, SettingGroup, TabContent, Select, Btn } from '../../../components/common';
import Icon from '../../../components/common/Icons/Icon';
import type { SubtitleTheme } from '@shared/constants';
import '../SettingsForm.css';
import './CustomizationTab.css';
import { CUSTOMIZABLE_CSS_VARS, CustomColorOverrides } from '@shared/types';
import type { ColorCodes, LanguageData } from '@shared/types';

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

      <SettingGroup title={t('mlearn.Settings.Groups.SubtitleAppearance')}>
        <SettingRow
          label={t('mlearn.Settings.Subtitle.Theme.Label')}
          description={t('mlearn.Settings.Subtitle.Theme.Description')}
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
