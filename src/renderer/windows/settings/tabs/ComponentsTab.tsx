import { Component, createSignal, Show } from 'solid-js';
import { useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { Panel, Btn, AlertBanner } from '../../../components/common';
import './ComponentsTab.css';

export const ComponentsTab: Component = () => {
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const [installing, setInstalling] = createSignal(false);
  const [installError, setInstallError] = createSignal<string | null>(null);

  const components = [
    {
      key: 'llm',
      title: t('mlearn.Installer.Components.ExplainAi.Title'),
      description: t('mlearn.Installer.Components.ExplainAi.Description'),
      enabled: () => settings.llmEnabled,
      toggle: (v: boolean) => updateSettings({ llmEnabled: v }),
    },
    {
      key: 'ocr',
      title: t('mlearn.Installer.Components.Reader.Title'),
      description: t('mlearn.Installer.Components.Reader.Description'),
      enabled: () => settings.ocrEnabled,
      toggle: (v: boolean) => updateSettings({ ocrEnabled: v }),
    },
    {
      key: 'voice',
      title: t('mlearn.Installer.Components.Voice.Title'),
      description: t('mlearn.Installer.Components.Voice.Description'),
      enabled: () => settings.voiceEnabled,
      toggle: (v: boolean) => updateSettings({ voiceEnabled: v }),
    },
  ];

  const handleReinstall = () => {
    setInstalling(true);
    setInstallError(null);
    try {
      getBridge().installer.startInstall({
        includeLLM: settings.llmEnabled,
        includeOCR: settings.ocrEnabled,
        includeVoice: settings.voiceEnabled,
      });
    } catch (e) {
      setInstallError(t('mlearn.Installer.Status.CouldNotStart'));
      setInstalling(false);
    }
  };

  return (
    <div class="components-tab">
      <h2 class="components-tab__title">{t('mlearn.Settings.Tabs.Components')}</h2>

      <Panel variant="default" rounded="lg" padding="lg" class="components-tab__panel">
        <p class="components-tab__description">
          {t('mlearn.ComponentsTab.Description')}
        </p>

        <div class="components-tab__list">
          {components.map((comp) => (
            <div class="components-tab__item">
              <div class="components-tab__item-header">
                <span class="components-tab__item-title">{comp.title}</span>
                <label class="components-tab__toggle">
                  <input
                    type="checkbox"
                    checked={comp.enabled()}
                    onChange={(e) => comp.toggle(e.currentTarget.checked)}
                  />
                  <span class="components-tab__toggle-slider" />
                </label>
              </div>
              <p class="components-tab__item-desc">{comp.description}</p>
            </div>
          ))}
        </div>

        <Show when={installError()}>
          <AlertBanner
            variant="error"
            title={t('mlearn.Installer.Alerts.NetworkError')}
            message={installError()!}
            closable
            onClose={() => setInstallError(null)}
            class="components-tab__alert"
          />
        </Show>

        <Btn
          variant="primary"
          onClick={handleReinstall}
          disabled={installing()}
          class="components-tab__action"
        >
          {installing()
            ? t('mlearn.Installer.Buttons.Installing')
            : t('mlearn.ComponentsTab.Reinstall')}
        </Btn>

        <p class="components-tab__note">
          {t('mlearn.ComponentsTab.RestartNote')}
        </p>
      </Panel>
    </div>
  );
};

export default ComponentsTab;
