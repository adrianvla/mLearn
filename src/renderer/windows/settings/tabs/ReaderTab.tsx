/**
 * Reader Settings Tab
 */

import { Component, createSignal, Show } from 'solid-js';
import { useSettings, useLocalization, useLanguage } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, KeybindInput, RangeInput, Input } from '../../../components/common';
import type { WordHoverTriggerMode } from '../../../../shared/constants';

/** Key options for hover trigger keybind */
const KEY_OPTIONS = ['Shift', 'Control', 'Alt', 'Meta'] as const;

export const ReaderTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  const { t } = useLocalization();
  const { currentLangData } = useLanguage();
  
  // Recording state for key capture
  const [isRecording, setIsRecording] = createSignal(false);

  const handleTriggerModeChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value as WordHoverTriggerMode;
    updateSettings({ readerWordHoverTrigger: value });
  };
  
  const handleKeyChange = (e: Event) => {
    const value = (e.target as HTMLSelectElement).value;
    updateSettings({ readerWordHoverKey: value });
  };
  
  // Allow user to press a key to set the keybind
  const startRecording = () => {
    setIsRecording(true);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      // Only accept modifier keys for simplicity
      const key = e.key;
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) {
        updateSettings({ readerWordHoverKey: key });
      }
      
      setIsRecording(false);
      window.removeEventListener('keydown', handleKeyDown);
    };
    
    window.addEventListener('keydown', handleKeyDown);
    
    // Cancel recording after 5 seconds
    setTimeout(() => {
      if (isRecording()) {
        setIsRecording(false);
        window.removeEventListener('keydown', handleKeyDown);
      }
    }, 5000);
  };

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.Reader.Title'),
        description: t('mlearn.Settings.Reader.Description'),
        icon: '📖',
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
            onChange={(e) => updateSettings({ ocr_crop_padding: parseInt(e.currentTarget.value) })}
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
          <select
            class="setting-input"
            value={settings.readerWordHoverTrigger ?? 'hover'}
            onChange={handleTriggerModeChange}
          >
            <option value="hover">{t('mlearn.Settings.Reader.WordHoverBehavior.Modes.Hover')}</option>
            <option value="long-hover">{t('mlearn.Settings.Reader.WordHoverBehavior.Modes.LongHover')}</option>
            <option value="key-hover">{t('mlearn.Settings.Reader.WordHoverBehavior.Modes.KeyHover', { key: settings.readerWordHoverKey ?? 'Shift' })}</option>
          </select>
        </SettingRow>
        
        <Show when={settings.readerWordHoverTrigger === 'key-hover'}>
          <SettingRow
            label={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Label')}
            description={t('mlearn.Settings.Reader.WordHoverBehavior.HoverKey.Description')}
          >
            <div style={{ display: 'flex', gap: '0.5rem', 'align-items': 'center' }}>
              <select
                class="setting-input"
                value={settings.readerWordHoverKey ?? 'Shift'}
                onChange={handleKeyChange}
              >
                {KEY_OPTIONS.map((key) => (
                  <option value={key}>{key}</option>
                ))}
              </select>
              <button
                class="setting-button"
                onClick={startRecording}
                style={{
                  padding: '4px 8px',
                  'font-size': '0.85rem',
                  background: isRecording() ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                  border: '1px solid var(--border-color)',
                  'border-radius': '4px',
                  color: 'var(--text)',
                  cursor: 'pointer',
                }}
              >
                {isRecording() ? t('mlearn.Settings.Reader.WordHoverBehavior.PressAKey') : t('mlearn.Settings.Reader.WordHoverBehavior.RecordKey')}
              </button>
            </div>
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
            {/*TODO: make actual layout because hardcoding the width is meh*/}
            <span style={{ color: 'var(--text-secondary)', 'font-size': '0.9rem' , 'width': '16px'}}>x</span>
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
            <span style={{ color: 'var(--text-secondary)', 'font-size': '0.9rem' }}>px</span>
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

      <SettingGroup title={t('mlearn.Settings.Reader.Tips.Title')}>
        <div style={{ color: "rgba(255,255,255,0.7)", "font-size": "0.9rem", "line-height": "1.6" }}>
          <p style={{ "margin-bottom": "12px" }}>
            {t('mlearn.Settings.Reader.Tips.GettingStarted')}
          </p>
          <p style={{ "margin-bottom": "12px" }}>
            {t('mlearn.Settings.Reader.Tips.OcrMode')}
          </p>
          <p style={{ "margin-bottom": "12px" }}>
            {t('mlearn.Settings.Reader.Tips.Navigation')}
          </p>
          <p>
            {t('mlearn.Settings.Reader.Tips.DoublePage')}
          </p>
        </div>
      </SettingGroup>
    </TabContent>
  );
};
