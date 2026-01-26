/**
 * General Settings Tab
 */

import { Component, createSignal } from 'solid-js';
import { useSettings } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, GlassBtn, Select } from '../../../components/common';
import { DEFAULT_SETTINGS, type Settings } from '../../../../shared/types';

export const GeneralTab: Component = () => {
  const { settings, updateSettings, saveSettings } = useSettings();
  const [exportError, setExportError] = createSignal<string | null>(null);
  const [importError, setImportError] = createSignal<string | null>(null);

  const handleExportSettings = async () => {
    setExportError(null);
    try {
      const settingsData = JSON.stringify(settings, null, 2);
      const blob = new Blob([settingsData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `mlearn-settings-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to export settings:', e);
      setExportError('Failed to export settings');
    }
  };

  const handleImportSettings = () => {
    setImportError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        const imported = JSON.parse(text) as Partial<Settings>;
        
        // Validate that it looks like a settings object
        if (typeof imported !== 'object' || imported === null) {
          throw new Error('Invalid settings file format');
        }
        
        // Only import known settings keys
        const validKeys = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
        const filteredSettings: Partial<Settings> = {};
        
        for (const key of validKeys) {
          if (key in imported) {
            (filteredSettings as any)[key] = imported[key];
          }
        }
        
        // Update settings
        updateSettings(filteredSettings);
        saveSettings();
        
        alert('Settings imported successfully!');
      } catch (e) {
        console.error('Failed to import settings:', e);
        setImportError('Failed to import settings. Make sure the file is valid.');
      }
    };
    input.click();
  };

  const handleResetSettings = () => {
    if (confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
      updateSettings(DEFAULT_SETTINGS);
      saveSettings();
      alert('Settings have been reset to defaults.');
    }
  };

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
          <GlassBtn size="sm" onClick={handleExportSettings}>
            Export
          </GlassBtn>
          {exportError() && <span class="setting-error">{exportError()}</span>}
        </SettingRow>

        <SettingRow
          label="Import Settings"
          description="Load settings from a file"
        >
          <GlassBtn size="sm" onClick={handleImportSettings}>
            Import
          </GlassBtn>
          {importError() && <span class="setting-error">{importError()}</span>}
        </SettingRow>

        <SettingRow
          label="Reset to Defaults"
          description="Restore all settings to their default values"
        >
          <GlassBtn size="sm" variant="danger" onClick={handleResetSettings}>
            Reset
          </GlassBtn>
        </SettingRow>
      </SettingGroup>
    </TabContent>
  );
};
