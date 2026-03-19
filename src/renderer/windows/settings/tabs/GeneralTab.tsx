/**
 * General Settings Tab
 */

import { Component, createSignal } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, ToggleSwitch, TabContent, Btn, Select, SettingsIcon } from '../../../components/common';
import { DEFAULT_SETTINGS, type Settings } from '../../../../shared/types';
import { type AppTheme } from '../../../../shared/constants';
import { getBridge } from '../../../../shared/bridges';
import '../SettingsForm.css';

export const GeneralTab: Component = () => {
  const { settings, updateSettings, saveSettings } = useSettings();
  const { t } = useLocalization();
  const [exportError, setExportError] = createSignal<string | null>(null);
  const [importError, setImportError] = createSignal<string | null>(null);
  const [dataExportError, setDataExportError] = createSignal<string | null>(null);
  const [dataImportError, setDataImportError] = createSignal<string | null>(null);
  const [dataExporting, setDataExporting] = createSignal(false);
  const [dataImporting, setDataImporting] = createSignal(false);

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
      setExportError(t('mlearn.Settings.UI.SaveError'));
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
        
        alert(t('mlearn.Global.Success'));
      } catch (e) {
        console.error('Failed to import settings:', e);
        setImportError(t('mlearn.Settings.UI.SaveError'));
      }
    };
    input.click();
  };

  const handleExportData = async () => {
    setDataExportError(null);
    setDataExporting(true);
    try {
      const result = await getBridge().data.dataExport();
      if (!result.success) {
        if (result.error) {
          setDataExportError(result.error);
        }
      }
    } catch (e) {
      console.error('Failed to export data:', e);
      setDataExportError(String(e));
    } finally {
      setDataExporting(false);
    }
  };

  const handleImportData = async () => {
    setDataImportError(null);
    if (!confirm(t('mlearn.Settings.Data.ImportAllData.Confirm'))) return;
    setDataImporting(true);
    try {
      const result = await getBridge().data.dataImport();
      if (result.success) {
        alert(t('mlearn.Settings.Data.ImportAllData.Success'));
        // Restart to reload all imported data
        getBridge().server.restartApp();
      } else if (result.error) {
        setDataImportError(result.error);
      }
    } catch (e) {
      console.error('Failed to import data:', e);
      setDataImportError(String(e));
    } finally {
      setDataImporting(false);
    }
  };

  const handleResetSettings = () => {
    if (confirm(t('mlearn.Settings.UI.ResetConfirm'))) {
      updateSettings(DEFAULT_SETTINGS);
      saveSettings();
      alert(t('mlearn.Settings.UI.ResetSuccess'));
    }
  };

  return (
    <TabContent
      header={{
        title: t('mlearn.Settings.UI.Title'),
        description: t('mlearn.Settings.UI.Description'),
        icon: <SettingsIcon size={20} />,
      }}
      padding="lg"
    >

      <SettingGroup title={t('mlearn.Settings.Groups.Language')}>
        <SettingRow
          label={t('mlearn.Settings.Language.AppLanguage.Label')}
          description={t('mlearn.Settings.Language.AppLanguage.Description')}
        >
          <Select
            class="setting-select"
            value={settings.uiLanguage || 'en'}
            onChange={(e) => {
              const lang = e.currentTarget.value;
              updateSettings({ uiLanguage: lang });
              saveSettings();
            }}
          >
            <option value="en">{t('mlearn.LocaleNames.en')}</option>
            <option value="ja">{t('mlearn.LocaleNames.ja')}</option>
            <option value="de">{t('mlearn.LocaleNames.de')}</option>
            <option value="fr">{t('mlearn.LocaleNames.fr')}</option>
            <option value="ru">{t('mlearn.LocaleNames.ru')}</option>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Language.LearningLanguage.Label')}
          description={t('mlearn.Settings.Language.LearningLanguage.Description')}
        >
          <Select
            class="setting-select"
            value={settings.language}
            onChange={(e) => updateSettings({ language: e.currentTarget.value })}
          >
            <option value="ja">{t('mlearn.Languages.ja')}</option>
            <option value="de">{t('mlearn.Languages.de')}</option>
          </Select>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.Appearance')}>
        <SettingRow
          label={t('mlearn.Settings.Appearance.Theme.Label')}
          description={t('mlearn.Settings.Appearance.Theme.Description')}
        >
          <Select
            class="setting-select"
            value={settings.theme}
            onChange={(e) => updateSettings({ theme: e.currentTarget.value as AppTheme })}
          >
            <option value="light">{t('mlearn.Settings.Appearance.Theme.Light')}</option>
            <option value="dark">{t('mlearn.Settings.Appearance.Theme.Dark')}</option>
            <option value="darker">{t('mlearn.Settings.Appearance.Theme.Darker')}</option>
            <option value="light-high-contrast">{t('mlearn.Settings.Appearance.Theme.LightHighContrast')}</option>
            <option value="dark-high-contrast">{t('mlearn.Settings.Appearance.Theme.DarkHighContrast')}</option>
            <option value="glass-light">{t('mlearn.Settings.Appearance.Theme.GlassLight')}</option>
            <option value="glass-dark">{t('mlearn.Settings.Appearance.Theme.GlassDark')}</option>
          </Select>
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Performance.DevMode.Label')}
          description={import.meta.env.DEV
            ? t('mlearn.Settings.Performance.DevMode.AutoEnabled')
            : t('mlearn.Settings.Performance.DevMode.Description')
          }
        >
          <ToggleSwitch
            checked={import.meta.env.DEV || settings.devMode}
            onChange={(checked) => updateSettings({ devMode: checked })}
            disabled={import.meta.env.DEV}
          />
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Performance.LowBatteryMode.Label')}
          description={t('mlearn.Settings.Performance.LowBatteryMode.Description')}
        >
          <ToggleSwitch
            checked={settings.lowBatteryMode}
            onChange={(checked) => updateSettings({ lowBatteryMode: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.Settings')}>
        <SettingRow
          label={t('mlearn.Settings.Data.ExportSettings.Label')}
          description={t('mlearn.Settings.Data.ExportSettings.Description')}
        >
          <Btn size="sm" onClick={handleExportSettings}>
            {t('mlearn.Global.Export')}
          </Btn>
          {exportError() && <span class="setting-error">{exportError()}</span>}
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Data.ImportSettings.Label')}
          description={t('mlearn.Settings.Data.ImportSettings.Description')}
        >
          <Btn size="sm" onClick={handleImportSettings}>
            {t('mlearn.Global.Import')}
          </Btn>
          {importError() && <span class="setting-error">{importError()}</span>}
        </SettingRow>

        <SettingRow
          label={t('mlearn.Settings.Data.ResetSettings.Label')}
          description={t('mlearn.Settings.Data.ResetSettings.Description')}
        >
          <Btn size="sm" variant="danger" onClick={handleResetSettings}>
            {t('mlearn.Global.Reset')}
          </Btn>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.Settings.Groups.Data')}>
          <SettingRow
            label={t('mlearn.Settings.Data.ExportAllData.Label')}
            description={t('mlearn.Settings.Data.ExportAllData.Description')}
          >
            <Btn size="sm" onClick={handleExportData} disabled={dataExporting()}>
              {dataExporting() ? t('mlearn.Global.Loading') : t('mlearn.Global.Export')}
            </Btn>
            {dataExportError() && <span class="setting-error">{dataExportError()}</span>}
          </SettingRow>

          <SettingRow
            label={t('mlearn.Settings.Data.ImportAllData.Label')}
            description={t('mlearn.Settings.Data.ImportAllData.Description')}
          >
            <Btn size="sm" variant="danger" onClick={handleImportData} disabled={dataImporting()}>
              {dataImporting() ? t('mlearn.Global.Loading') : t('mlearn.Global.Import')}
            </Btn>
            {dataImportError() && <span class="setting-error">{dataImportError()}</span>}
          </SettingRow>
        </SettingGroup>
    </TabContent>
  );
};
