/**
 * General Settings Tab
 */

import { Component } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, GlassBtn, Select } from '../../../components/common';

export const GeneralTab: Component = () => {
  const { settings, updateSettings } = useSettings();

  return (
    <TabContent
      header={{
        title: 'General Settings',
        description: 'Configure basic application settings',
        icon: '⚙️',
      }}
      padding="lg"
    >

      <SettingGroup title="Language">
        <SettingRow
          label="Target Language"
          description="The language you're learning"
        >
          <Select
            class="setting-select"
            value={settings.language}
            onChange={(e) => updateSettings({ language: e.currentTarget.value })}
          >
            <option value="ja">Japanese</option>
            <option value="de">German</option>
          </Select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Appearance">
        <SettingRow
          label="Dark Mode"
          description="Use dark theme for the interface"
        >
          <ToggleSwitch
            checked={settings.dark_mode}
            onChange={(checked) => updateSettings({ dark_mode: checked })}
          />
        </SettingRow>

        <SettingRow
          label="Developer Mode"
          description="Enable developer tools and debugging"
        >
          <ToggleSwitch
            checked={settings.devMode}
            onChange={(checked) => updateSettings({ devMode: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Data">
        <SettingRow
          label="Export Settings"
          description="Save your settings to a file"
        >
          <GlassBtn size="sm" onClick={() => exportSettings()}>
            Export
          </GlassBtn>
        </SettingRow>

        <SettingRow
          label="Import Settings"
          description="Load settings from a file"
        >
          <GlassBtn size="sm" onClick={() => importSettings()}>
            Import
          </GlassBtn>
        </SettingRow>

        <SettingRow
          label="Reset to Defaults"
          description="Restore all settings to their default values"
        >
          <GlassBtn size="sm" variant="danger" onClick={() => resetSettings()}>
            Reset
          </GlassBtn>
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};

function exportSettings() {
  // TODO: Implement export
  console.log('Export settings');
}

function importSettings() {
  // TODO: Implement import
  console.log('Import settings');
}

function resetSettings() {
  if (confirm('Are you sure you want to reset all settings to defaults?')) {
    // TODO: Implement reset
    console.log('Reset settings');
  }
}
