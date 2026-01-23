/**
 * Customization Settings Tab
 */

import { Component } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow, SettingGroup, TabContent } from '../../../components/common';

export const CustomizationTab: Component = () => {
  const { settings, updateSettings } = useSettings();

  return (
    <TabContent
      header={{
        title: 'Customization',
        description: 'Personalize the look and feel',
        icon: '🎨',
      }}
      padding="lg"
    >

      <SettingGroup title="Subtitle Appearance">
        <SettingRow
          label="Subtitle Theme"
          description="How subtitles are displayed on video"
        >
          <select
            class="setting-select"
            value={settings.subtitleTheme}
            onChange={(e) => updateSettings({ subtitleTheme: e.currentTarget.value as any })}
          >
            <option value="shadow">Shadow</option>
            <option value="background">Background</option>
            <option value="marker">Marker</option>
          </select>
        </SettingRow>

        <SettingRow
          label="Font Size"
          description="Size of subtitle text"
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
          label="Font Weight"
          description="Thickness of subtitle text"
        >
          <select
            class="setting-select"
            value={settings.subtitle_font_weight}
            onChange={(e) => updateSettings({ subtitle_font_weight: parseInt(e.currentTarget.value) })}
          >
            <option value={100}>Thin (100)</option>
            <option value={200}>Extra Light (200)</option>
            <option value={300}>Light (300)</option>
            <option value={400}>Normal (400)</option>
            <option value={500}>Medium (500)</option>
            <option value={600}>Semi Bold (600)</option>
            <option value={700}>Bold (700)</option>
            <option value={800}>Extra Bold (800)</option>
            <option value={900}>Black (900)</option>
          </select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Subtitle Timing">
        <SettingRow
          label="Subtitle Offset"
          description="Adjust subtitle timing (milliseconds)"
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

      <SettingGroup title="Theme Preview">
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
