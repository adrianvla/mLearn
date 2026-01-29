/**
 * Reader Settings Tab
 */

import { Component, createSignal, Show } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent } from '../../../components/common';
import type { WordHoverTriggerMode } from '../../../../shared/constants';

/** Key options for hover trigger keybind */
const KEY_OPTIONS = ['Shift', 'Control', 'Alt', 'Meta'] as const;

export const ReaderTab: Component = () => {
  const { settings, updateSettings } = useSettings();
  
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
        title: 'Reader',
        description: 'Configure OCR and manga reader settings',
        icon: '📖',
      }}
      padding="lg"
    >

      <SettingGroup title="OCR Settings">
        <SettingRow
          label="Enable OCR"
          description="Enable optical character recognition for images"
        >
          <ToggleSwitch
            checked={settings.ocrEnabled}
            onChange={(checked) => updateSettings({ ocrEnabled: checked })}
          />
        </SettingRow>

        <SettingRow
          label="OCR Crop Padding"
          description="Extra pixels around text when cropping for flashcards"
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
      </SettingGroup>
      
      <SettingGroup title="Word Hover Behavior">
        <SettingRow
          label="Hover Trigger Mode"
          description="How word translation popup is triggered in the reader"
        >
          <select
            class="setting-input"
            value={settings.readerWordHoverTrigger ?? 'hover'}
            onChange={handleTriggerModeChange}
          >
            <option value="hover">Hover (immediate)</option>
            <option value="long-hover">Long Hover (500ms delay)</option>
            <option value="key-hover">{`${settings.readerWordHoverKey ?? 'Shift'} + Hover`}</option>
          </select>
        </SettingRow>
        
        <Show when={settings.readerWordHoverTrigger === 'key-hover'}>
          <SettingRow
            label="Hover Key"
            description="Key to hold while hovering to show word popup"
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
                {isRecording() ? 'Press a key...' : 'Record Key'}
              </button>
            </div>
          </SettingRow>
        </Show>
      </SettingGroup>
      
      <SettingGroup title="Furigana">
        <SettingRow
          label="Hide Furigana"
          description="Cover detected furigana with white boxes that reveal on hover (for reading practice)"
        >
          <ToggleSwitch
            checked={settings.readerFuriganaHider ?? false}
            onChange={(checked) => updateSettings({ readerFuriganaHider: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="LLM Integration">
        <SettingRow
          label="Enable LLM Explanations"
          description="Use AI to explain words and grammar"
        >
          <ToggleSwitch
            checked={settings.llmEnabled}
            onChange={(checked) => updateSettings({ llmEnabled: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Reader Tips">
        <div style={{ color: "rgba(255,255,255,0.7)", "font-size": "0.9rem", "line-height": "1.6" }}>
          <p style={{ "margin-bottom": "12px" }}>
            📖 <strong>Getting Started:</strong> Drag and drop a folder of images or a PDF file onto the reader window.
          </p>
          <p style={{ "margin-bottom": "12px" }}>
            🔍 <strong>OCR Mode:</strong> Click "Run OCR" to extract text from the current page. Hover over detected text to see translations.
          </p>
          <p style={{ "margin-bottom": "12px" }}>
            📚 <strong>Navigation:</strong> Use arrow keys or click thumbnails in the sidebar to navigate pages.
          </p>
          <p>
            💡 <strong>Tip:</strong> Double-page mode works great for manga spreads!
          </p>
        </div>
      </SettingGroup>
    </TabContent>
  );
};
