/**
 * Reader Settings Tab
 */

import { Component, Show } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, KeybindInput, RangeInput, Input, BookIcon, Select, formatKeybindDisplay } from '../../../components/common';
import type { WordHoverTriggerMode } from '../../../../shared/constants';
import { DEFAULT_SETTINGS, type ReaderTextFontStyle } from '../../../../shared/types';
import {
  ocrReadingAnnotationFilteringEnabled,
  readerReadingAnnotationHiderEnabled,
} from '../../../../shared/readingAnnotationSettings';
import '../SettingsForm.css';

export const ReaderTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { getLanguageFeatures } = useLanguage();

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.Reader.Title'),
        description: t('mlearn.Settings.Reader.Description'),
        icon: <BookIcon size={20} />,
      }}
      padding="lg"
    >

      <SettingGroup title={t('mlearn.Settings.Reader.TextAppearance.Title')}>
        <SettingRow
          label={t('mlearn.Settings.Reader.TextAppearance.Font.Label')}
          description={t('mlearn.Settings.Reader.TextAppearance.Font.Description')}
        >
          <Select
            value={settings.readerTextFontStyle ?? DEFAULT_SETTINGS.readerTextFontStyle!}
            onChange={(e) => updateSettings({ readerTextFontStyle: e.currentTarget.value as ReaderTextFontStyle })}
            options={[
              { value: 'language', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Language') },
              { value: 'sans', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Sans') },
              { value: 'serif', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Serif') },
              { value: 'mono', label: t('mlearn.Settings.Reader.TextAppearance.Font.Options.Mono') },
            ]}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.TextAppearance.Size.Label')}
          description={t('mlearn.Settings.Reader.TextAppearance.Size.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <RangeInput
              min={0.85}
              max={1.35}
              step={0.05}
              value={settings.readerTextSize ?? DEFAULT_SETTINGS.readerTextSize!}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerTextSize: value })}
            />
            <Input
              type="number"
              value={settings.readerTextSize ?? DEFAULT_SETTINGS.readerTextSize!}
              min={0.85}
              max={1.35}
              step={0.05}
              ghost={true}
              style={{ width: '70px', 'text-align': 'center' }}
              onChange={(e) => {
                const val = Number.parseFloat(e.currentTarget.value);
                if (!Number.isNaN(val) && val >= 0.85 && val <= 1.35) {
                  updateSettings({ readerTextSize: val });
                }
              }}
            />
            <span class="setting-hint">rem</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.TextAppearance.LineHeight.Label')}
          description={t('mlearn.Settings.Reader.TextAppearance.LineHeight.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <RangeInput
              min={1.35}
              max={2.2}
              step={0.05}
              value={settings.readerTextLineHeight ?? DEFAULT_SETTINGS.readerTextLineHeight!}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerTextLineHeight: value })}
            />
            <Input
              type="number"
              value={settings.readerTextLineHeight ?? DEFAULT_SETTINGS.readerTextLineHeight!}
              min={1.35}
              max={2.2}
              step={0.05}
              ghost={true}
              style={{ width: '70px', 'text-align': 'center' }}
              onChange={(e) => {
                const val = Number.parseFloat(e.currentTarget.value);
                if (!Number.isNaN(val) && val >= 1.35 && val <= 2.2) {
                  updateSettings({ readerTextLineHeight: val });
                }
              }}
            />
          </div>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.TextAppearance.Width.Label')}
          description={t('mlearn.Settings.Reader.TextAppearance.Width.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <RangeInput
              min={36}
              max={78}
              step={2}
              value={settings.readerTextWidth ?? DEFAULT_SETTINGS.readerTextWidth!}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerTextWidth: value })}
            />
            <Input
              type="number"
              value={settings.readerTextWidth ?? DEFAULT_SETTINGS.readerTextWidth!}
              min={36}
              max={78}
              step={2}
              ghost={true}
              style={{ width: '70px', 'text-align': 'center' }}
              onChange={(e) => {
                const val = Number.parseInt(e.currentTarget.value, 10);
                if (!Number.isNaN(val) && val >= 36 && val <= 78) {
                  updateSettings({ readerTextWidth: val });
                }
              }}
            />
            <span class="setting-hint">ch</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.TextAppearance.Margin.Label')}
          description={t('mlearn.Settings.Reader.TextAppearance.Margin.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <RangeInput
              min={0.7}
              max={1.5}
              step={0.05}
              value={settings.readerTextMargin ?? DEFAULT_SETTINGS.readerTextMargin!}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerTextMargin: value })}
            />
            <Input
              type="number"
              value={settings.readerTextMargin ?? DEFAULT_SETTINGS.readerTextMargin!}
              min={0.7}
              max={1.5}
              step={0.05}
              ghost={true}
              style={{ width: '70px', 'text-align': 'center' }}
              onChange={(e) => {
                const val = Number.parseFloat(e.currentTarget.value);
                if (!Number.isNaN(val) && val >= 0.7 && val <= 1.5) {
                  updateSettings({ readerTextMargin: val });
                }
              }}
            />
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Reader.OcrSettings.Title')}>
        <SettingRow
          label={t('mlearn.Settings.Reader.OcrSettings.Enable.Label')}
          description={t('mlearn.Settings.Reader.OcrSettings.Enable.Description')}
        >
          <ToggleSwitch
            checked={settings.ocrEnabled}
            onChange={(checked) => updateSettings({ ocrEnabled: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.OcrSettings.CropPadding.Label')}
          description={t('mlearn.Settings.Reader.OcrSettings.CropPadding.Description')}
        >
          <input
            type="number"
            class="setting-input"
            value={settings.ocr_crop_padding}
            min={0}
            max={500}
            step={10}
            onChange={(e) => updateSettings({ ocr_crop_padding: Number.parseInt(e.currentTarget.value, 10) })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.OcrSettings.CropMode.Label')}
          description={t('mlearn.Settings.Reader.OcrSettings.CropMode.Description')}
        >
          <ToggleSwitch
            checked={settings.readerCropMode ?? DEFAULT_SETTINGS.readerCropMode!}
            onChange={(checked) => updateSettings({ readerCropMode: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.OcrSettings.DocumentOcr.Label')}
          description={t('mlearn.Settings.Reader.OcrSettings.DocumentOcr.Description')}
        >
          <ToggleSwitch
            checked={settings.readerDocumentOcr ?? DEFAULT_SETTINGS.readerDocumentOcr!}
            onChange={(checked) => updateSettings({ readerDocumentOcr: checked })}
          />
        </SettingRow>

        <Show when={getLanguageFeatures().supportsReadings}>
          <SettingRow
            label={t('mlearn.Settings.Reader.OcrSettings.ReadingAnnotationDetection.Label')}
            description={t('mlearn.Settings.Reader.OcrSettings.ReadingAnnotationDetection.Description')}
          >
            <ToggleSwitch
              checked={ocrReadingAnnotationFilteringEnabled(settings)}
              onChange={(checked) => updateSettings({
                ocrReadingAnnotationFiltering: checked,
              })}
            />
          </SettingRow>
        </Show>
      </SettingGroup>
      
      <SettingGroup title={t('mlearn.Settings.Reader.WordHoverBehavior.Title')}>
        <SettingRow
          label={t('mlearn.Settings.Reader.WordHoverBehavior.TriggerMode.Label')}
          description={t('mlearn.Settings.Reader.WordHoverBehavior.TriggerMode.Description')}
        >
          <Select
            value={settings.readerWordHoverTrigger ?? DEFAULT_SETTINGS.readerWordHoverTrigger!}
            onChange={(e) => updateSettings({ readerWordHoverTrigger: e.currentTarget.value as WordHoverTriggerMode })}
            options={[
              { value: 'hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.Hover') },
              { value: 'long-hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.LongHover') },
              { value: 'key-hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.KeyHover', { key: formatKeybindDisplay(settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!, t) }) },
            ]}
          />
        </SettingRow>
        
        <Show when={settings.readerWordHoverTrigger === 'key-hover'}>
          <SettingRow
            label={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Label')}
            description={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Description')}
          >
            <KeybindInput
              value={settings.readerWordHoverKey ?? DEFAULT_SETTINGS.readerWordHoverKey!}
              onChange={(key) => updateSettings({ readerWordHoverKey: key })}
              allowModifierOnly={true}
            />
          </SettingRow>
        </Show>
      </SettingGroup>
      
      <Show when={getLanguageFeatures().supportsReadings}>
        <SettingGroup title={t('mlearn.Settings.Reader.ReadingAnnotations.Title')}>
          <SettingRow
            label={t('mlearn.Settings.Reader.ReadingAnnotations.Hide.Label')}
            description={t('mlearn.Settings.Reader.ReadingAnnotations.Hide.Description')}
          >
            <ToggleSwitch
              checked={readerReadingAnnotationHiderEnabled(settings)}
              onChange={(checked) => updateSettings({
                readerReadingAnnotationHider: checked,
              })}
            />
          </SettingRow>
        </SettingGroup>
      </Show>

      <SettingGroup title={t('mlearn.Settings.Reader.Magnifier.Title')}>
        <SettingRow
          label={t('mlearn.Settings.Reader.Magnifier.Hotkey.Label')}
          description={t('mlearn.Settings.Reader.Magnifier.Hotkey.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <KeybindInput
              value={settings.readerMagnifierHotkey ?? DEFAULT_SETTINGS.readerMagnifierHotkey!}
              onChange={(key) => updateSettings({ readerMagnifierHotkey: key.length === 1 ? key.toLowerCase() : key })}
            />
            {/*<span style={{ color: 'var(--text-secondary)', 'font-size': '0.85rem' }}>*/}
            {/*  {t('mlearn.Settings.Reader.Magnifier.Hotkey.Hint')}*/}
            {/*</span>*/}
          </div>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.Magnifier.Zoom.Label')}
          description={t('mlearn.Settings.Reader.Magnifier.Zoom.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <RangeInput
              min={1.5}
              max={5}
              step={0.5}
              value={settings.readerMagnifierZoom ?? DEFAULT_SETTINGS.readerMagnifierZoom!}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerMagnifierZoom: value })}
            />
            <Input
              type="number"
              value={settings.readerMagnifierZoom ?? DEFAULT_SETTINGS.readerMagnifierZoom!}
              min={1.5}
              max={5}
              step={0.5}
              ghost={true}
              style={{ width: '70px', 'text-align': 'center' }}
              onChange={(e) => {
                const val = parseFloat(e.currentTarget.value);
                if (!isNaN(val) && val >= 1.5 && val <= 5) {
                  updateSettings({ readerMagnifierZoom: val });
                }
              }}
            />
            <span class="setting-hint">x</span>
          </div>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.Magnifier.Size.Label')}
          description={t('mlearn.Settings.Reader.Magnifier.Size.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <RangeInput
              min={100}
              max={400}
              step={25}
              value={settings.readerMagnifierSize ?? DEFAULT_SETTINGS.readerMagnifierSize!}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerMagnifierSize: value })}
            />
            <Input
              type="number"
              value={settings.readerMagnifierSize ?? DEFAULT_SETTINGS.readerMagnifierSize!}
              min={100}
              max={400}
              step={25}
              ghost={true}
              style={{ width: '70px', 'text-align': 'center' }}
              onChange={(e) => {
                const val = parseInt(e.currentTarget.value);
                if (!isNaN(val) && val >= 100 && val <= 400) {
                  updateSettings({ readerMagnifierSize: val });
                }
              }}
            />
            <span class="setting-hint">px</span>
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Reader.LlmIntegration.Title')}>
        <SettingRow
          label={t('mlearn.Settings.Reader.LlmIntegration.Enable.Label')}
          description={t('mlearn.Settings.Reader.LlmIntegration.Enable.Description')}
        >
          <ToggleSwitch
            checked={settings.llmEnabled}
            onChange={(checked) => updateSettings({ llmEnabled: checked })}
          />
        </SettingRow>

      </SettingGroup>
    </TabContent>
  );
};
