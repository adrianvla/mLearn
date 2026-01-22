/**
 * Reader Settings Tab
 */

import { Component } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent } from '../../../components/common';

export const ReaderTab: Component = () => {
  const { settings, updateSettings } = useSettings();

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
