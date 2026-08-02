import { Component, Accessor, For, Show, createMemo, createResource } from 'solid-js';
import { IconBtn, Select, Popover, ToggleSwitch, RangeInput } from '../../../../components/common';
import { useSettings, useLocalization, useLanguage } from '../../../../context';
import { DEFAULT_SETTINGS, ReaderTextFontStyle } from '@shared/types';
import { getReadingAnnotationDisplay } from '@shared/languageFeatures';
import { readingAnnotationMoreContrastEnabled, readingAnnotationSizePercent } from '@shared/readingAnnotationSettings';
import { READER_TEXT_THEME_IDS, stepReaderTextSize } from '../readerTextThemes';
import { listInstalledSystemFonts } from '../../../../services/systemFonts';
import './ReaderThemePopover.css';

interface ReaderThemePopoverProps {
  open: Accessor<boolean>;
  anchor: () => HTMLElement | undefined;
  onClose: () => void;
}

const themeNameKey = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

export const ReaderThemePopover: Component<ReaderThemePopoverProps> = (props) => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData, getLanguageFeatures } = useLanguage();

  const textSize = () => settings.readerTextSize ?? DEFAULT_SETTINGS.readerTextSize!;
  const fontStyle = () => settings.readerTextFontStyle ?? DEFAULT_SETTINGS.readerTextFontStyle!;
  const themeId = () => settings.readerTextTheme ?? DEFAULT_SETTINGS.readerTextTheme!;
  const readingSizePercent = () => readingAnnotationSizePercent(settings);

  const supportsReadingAppearance = createMemo(() => (
    getLanguageFeatures().supportsReadings && getReadingAnnotationDisplay(currentLangData()) !== 'replace'
  ));

  const [fontFamilies] = createResource(() => listInstalledSystemFonts());

  const decreaseSize = () => updateSettings({ readerTextSize: stepReaderTextSize(textSize(), -0.05) });
  const increaseSize = () => updateSettings({ readerTextSize: stepReaderTextSize(textSize(), 0.05) });

  const fontStyleOptions = () => [
    { value: 'language', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Language') },
    { value: 'sans', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Sans') },
    { value: 'serif', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Serif') },
    { value: 'mono', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Mono') },
    { value: 'custom', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Custom') },
  ];

  return (
    <Popover
      open={props.open}
      anchor={props.anchor}
      onClose={props.onClose}
      label={t('mlearn.Reader.Themes.Button')}
      class="reader-theme-popover"
    >
      <div class="reader-theme-row">
        <span class="reader-theme-label">{t('mlearn.Reader.Themes.FontSize')}</span>
        <div class="reader-theme-size-control">
          <IconBtn class="reader-theme-size-btn" onClick={decreaseSize}>A−</IconBtn>
          <span class="reader-theme-size-value">{Math.round(textSize() * 100)}%</span>
          <IconBtn class="reader-theme-size-btn" onClick={increaseSize}>A+</IconBtn>
        </div>
      </div>

      <div class="reader-theme-row">
        <span class="reader-theme-label">{t('mlearn.Reader.Themes.FontStyle')}</span>
        <Select
          options={fontStyleOptions()}
          value={fontStyle()}
          onChange={(e) => updateSettings({ readerTextFontStyle: e.currentTarget.value as ReaderTextFontStyle })}
        />
      </div>

      <Show when={fontStyle() === 'custom'}>
        <div class="reader-theme-row">
          <span class="reader-theme-label">{t('mlearn.Reader.Themes.CustomFont')}</span>
          <Select
            options={[
              { value: '', label: t('mlearn.Reader.Themes.CustomFontDefault') },
              ...(fontFamilies() ?? []).map((font) => ({ value: font.family, label: font.family })),
            ]}
            value={settings.readerTextFontFamily ?? ''}
            onChange={(e) => updateSettings({ readerTextFontFamily: e.currentTarget.value })}
            disabled={fontFamilies.loading}
          />
        </div>
      </Show>

      <div class="reader-theme-row">
        <span class="reader-theme-label">{t('mlearn.Reader.Themes.FontWeight')}</span>
        <Select
          options={[
            { value: '400', label: t('mlearn.Reader.Themes.FontWeightOptions.Regular') },
            { value: '500', label: t('mlearn.Reader.Themes.FontWeightOptions.Medium') },
            { value: '600', label: t('mlearn.Reader.Themes.FontWeightOptions.SemiBold') },
            { value: '700', label: t('mlearn.Reader.Themes.FontWeightOptions.Bold') },
          ]}
          value={String(settings.readerTextFontWeight ?? DEFAULT_SETTINGS.readerTextFontWeight)}
          onChange={(e) => updateSettings({ readerTextFontWeight: Number(e.currentTarget.value) })}
        />
      </div>

      <Show when={supportsReadingAppearance()}>
        <div class="reader-theme-divider" />
        <div class="reader-theme-row">
          <span class="reader-theme-label">{t('mlearn.Settings.ReadingAppearance.MoreContrast.Label')}</span>
          <ToggleSwitch
            checked={readingAnnotationMoreContrastEnabled(settings)}
            onChange={(checked) => updateSettings({ readingAnnotationMoreContrast: checked })}
          />
        </div>
        <div class="reader-theme-row">
          <span class="reader-theme-label">{t('mlearn.Settings.ReadingAppearance.Size.Label')}</span>
          <div class="reader-theme-reading-size">
            <RangeInput
              min={60}
              max={160}
              step={5}
              value={readingSizePercent()}
              onChange={(value) => updateSettings({ readingAnnotationSizePercent: value })}
            />
            <output class="reader-theme-reading-size-value">{readingSizePercent()}%</output>
          </div>
        </div>
      </Show>

      <div class="reader-theme-grid">
        <For each={READER_TEXT_THEME_IDS}>
          {(id) => (
            <button
              type="button"
              class={`theme-tile theme-tile-${id}${themeId() === id ? ' active' : ''}`}
              onClick={() => updateSettings({ readerTextTheme: id })}
            >
              <span class="theme-tile-preview">ああ</span>
              <span class="theme-tile-name">{t(`mlearn.Reader.Themes.${themeNameKey(id)}`)}</span>
            </button>
          )}
        </For>
      </div>
    </Popover>
  );
};

export default ReaderThemePopover;
