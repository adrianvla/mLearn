/**
 * Reader Settings Tab
 */

import { Component, Show } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, KeybindInput, RangeInput, Input, BookIcon, Select, formatKeybindDisplay } from '../../../components/common';
import type { WordHoverTriggerMode } from '../../../../shared/constants';
import '../SettingsForm.css';

export const ReaderTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData } = useLanguage();

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.Reader.Title'),
        description: t('mlearn.Settings.Reader.Description'),
        icon: <BookIcon size={20} />,
      }}
      padding="lg"
    >

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

        <Show when={currentLangData()?.hasOcrRamSaver}>
          <SettingRow
            label={t('mlearn.Settings.Reader.OcrSettings.RamSaver.Label')}
            description={t('mlearn.Settings.Reader.OcrSettings.RamSaver.Description')}
          >
            <ToggleSwitch
              checked={settings.ocrRamSaver ?? false}
              onChange={(checked) => updateSettings({ ocrRamSaver: checked })}
            />
          </SettingRow>
        </Show>

        <SettingRow
          label={t('mlearn.Settings.Reader.OcrSettings.TurboMode.Label')}
          description={t('mlearn.Settings.Reader.OcrSettings.TurboMode.Description')}
        >
          <ToggleSwitch
            checked={settings.ocrTurboMode ?? true}
            onChange={(checked) => updateSettings({ ocrTurboMode: checked })}
          />
        </SettingRow>

        <Show when={currentLangData()?.hasFurigana}>
          <SettingRow
            label={t('mlearn.Settings.Reader.OcrSettings.FuriganaDetection.Label')}
            description={t('mlearn.Settings.Reader.OcrSettings.FuriganaDetection.Description')}
          >
            <ToggleSwitch
              checked={settings.ocrFuriganaDetection ?? true}
              onChange={(checked) => updateSettings({ ocrFuriganaDetection: checked })}
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
            value={settings.readerWordHoverTrigger ?? 'hover'}
            onChange={(e) => updateSettings({ readerWordHoverTrigger: e.currentTarget.value as WordHoverTriggerMode })}
            options={[
              { value: 'hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.Hover') },
              { value: 'long-hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.LongHover') },
              { value: 'key-hover', label: t('mlearn.Settings.Reader.WordHoverBehavior.Modes.KeyHover', { key: formatKeybindDisplay(settings.readerWordHoverKey ?? 'shift', t) }) },
            ]}
          />
        </SettingRow>
        
        <Show when={settings.readerWordHoverTrigger === 'key-hover'}>
          <SettingRow
            label={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Label')}
            description={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Description')}
          >
            <KeybindInput
              value={settings.readerWordHoverKey ?? 'Shift'}
              onChange={(key) => updateSettings({ readerWordHoverKey: key })}
              allowModifierOnly={true}
            />
          </SettingRow>
        </Show>
      </SettingGroup>
      
      <SettingGroup title={t('mlearn.Settings.Reader.Furigana.Title')}>
        <SettingRow
          label={t('mlearn.Settings.Reader.Furigana.Hide.Label')}
          description={t('mlearn.Settings.Reader.Furigana.Hide.Description')}
        >
          <ToggleSwitch
            checked={settings.readerFuriganaHider ?? false}
            onChange={(checked) => updateSettings({ readerFuriganaHider: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Reader.Magnifier.Title')}>
        <SettingRow
          label={t('mlearn.Settings.Reader.Magnifier.Hotkey.Label')}
          description={t('mlearn.Settings.Reader.Magnifier.Hotkey.Description')}
        >
          <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
            <KeybindInput
              value={settings.readerMagnifierHotkey ?? 'z'}
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
              value={settings.readerMagnifierZoom ?? 2}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerMagnifierZoom: value })}
            />
            <Input
              type="number"
              value={settings.readerMagnifierZoom ?? 2}
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
              value={settings.readerMagnifierSize ?? 200}
              style={{ width: '120px' }}
              onChange={(value) => updateSettings({ readerMagnifierSize: value })}
            />
            <Input
              type="number"
              value={settings.readerMagnifierSize ?? 200}
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

        <SettingRow
          label={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Label')}
          description={t('mlearn.Settings.Reader.LlmIntegration.PassiveWordTracking.Description')}
        >
          <ToggleSwitch
            checked={settings.passiveEaseEnabled}
            onChange={(checked) => updateSettings({ passiveEaseEnabled: checked })}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Reader.LlmIntegration.Speech.Label')}
          description={t('mlearn.Settings.Reader.LlmIntegration.Speech.Description')}
        >
          <ToggleSwitch
            checked={settings.speechEnabled}
            onChange={(checked) => updateSettings({ speechEnabled: checked })}
          />
        </SettingRow>

        <Show when={settings.speechEnabled}>
          <SettingRow
            label={t('mlearn.Settings.Reader.LlmIntegration.AutoSpeak.Label')}
            description={t('mlearn.Settings.Reader.LlmIntegration.AutoSpeak.Description')}
          >
            <ToggleSwitch
              checked={settings.autoSpeak}
              onChange={(checked) => updateSettings({ autoSpeak: checked })}
            />
          </SettingRow>
        </Show>
      </SettingGroup>
    </TabContent>
  );
};
