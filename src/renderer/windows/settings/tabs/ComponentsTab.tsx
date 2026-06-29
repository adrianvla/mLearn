import { Component, createMemo, createSignal, Show } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { Panel, Btn, AlertBanner } from '../../../components/common';
import './ComponentsTab.css';

type InstalledComponentGroup = {
  key: string;
  title: string;
  description: string;
  enabled: () => boolean;
  toggle?: (value: boolean) => void;
  items: Array<{
    title: string;
    description: string;
    enabled?: () => boolean;
  }>;
};

export const ComponentsTab: Component = () => {
  const { t } = useLocalization();
  const { settings, updateSettings } = useSettings();
  const { languageDataCatalog } = useLanguage();
  const [installing, setInstalling] = createSignal(false);
  const [installError, setInstallError] = createSignal<string | null>(null);

  const installedDictionaryItems = createMemo(() => (
    languageDataCatalog().flatMap((status) => (
      (status.dictionaryPacks ?? [])
        .filter((pack) => pack.installed)
        .map((pack) => ({
          title: pack.name,
          description: t('mlearn.ComponentsTab.Items.DictionaryPack.Description', {
            language: status.nameTranslated ?? status.name,
          }),
          enabled: () => true,
        }))
    ))
  ));

  const componentGroups = createMemo<InstalledComponentGroup[]>(() => {
    const groups: InstalledComponentGroup[] = [
    {
      key: 'llm',
      title: t('mlearn.ComponentsTab.Groups.AI.Title'),
      description: t('mlearn.ComponentsTab.Groups.AI.Description'),
      enabled: () => settings.llmEnabled,
      toggle: (v: boolean) => updateSettings({ llmEnabled: v }),
      items: [
        {
          title: t('mlearn.ComponentsTab.Items.BuiltinChatRuntime.Title'),
          description: t('mlearn.ComponentsTab.Items.BuiltinChatRuntime.Description'),
        },
        {
          title: t('mlearn.ComponentsTab.Items.TransformersSupport.Title'),
          description: t('mlearn.ComponentsTab.Items.TransformersSupport.Description'),
        },
      ],
    },
    {
      key: 'ocr',
      title: t('mlearn.ComponentsTab.Groups.Reader.Title'),
      description: t('mlearn.ComponentsTab.Groups.Reader.Description'),
      enabled: () => settings.ocrEnabled,
      toggle: (v: boolean) => updateSettings({ ocrEnabled: v }),
      items: [
        {
          title: t('mlearn.ComponentsTab.Items.RapidOCR.Title'),
          description: t('mlearn.ComponentsTab.Items.RapidOCR.Description'),
        },
        {
          title: t('mlearn.ComponentsTab.Items.PaddleOCR.Title'),
          description: t('mlearn.ComponentsTab.Items.PaddleOCR.Description'),
        },
        {
          title: t('mlearn.ComponentsTab.Items.MangaOCR.Title'),
          description: t('mlearn.ComponentsTab.Items.MangaOCR.Description'),
        },
      ],
    },
    {
      key: 'voice',
      title: t('mlearn.ComponentsTab.Groups.Voice.Title'),
      description: t('mlearn.ComponentsTab.Groups.Voice.Description'),
      enabled: () => settings.voiceEnabled,
      toggle: (v: boolean) => updateSettings({ voiceEnabled: v }),
      items: [
        {
          title: t('mlearn.ComponentsTab.Items.WhisperSmall.Title'),
          description: t('mlearn.ComponentsTab.Items.WhisperSmall.Description'),
        },
        {
          title: t('mlearn.ComponentsTab.Items.KokoroTts.Title'),
          description: t('mlearn.ComponentsTab.Items.KokoroTts.Description'),
        },
        {
          title: t('mlearn.ComponentsTab.Items.SileroVad.Title'),
          description: t('mlearn.ComponentsTab.Items.SileroVad.Description'),
        },
        {
          title: t('mlearn.ComponentsTab.Items.QwenTts.Title'),
          description: t('mlearn.ComponentsTab.Items.QwenTts.Description'),
        },
      ],
    },
    ];

    const dictionaryItems = installedDictionaryItems();
    if (dictionaryItems.length > 0) {
      groups.push({
        key: 'dictionaries',
        title: t('mlearn.ComponentsTab.Groups.Dictionaries.Title'),
        description: t('mlearn.ComponentsTab.Groups.Dictionaries.Description'),
        enabled: () => true,
        items: dictionaryItems,
      });
    }

    return groups;
  });

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

        <div class="components-tab__groups">
          {componentGroups().map((group) => (
            <section class="components-tab__group">
              <div class="components-tab__group-header">
                <div>
                  <h3 class="components-tab__group-title">{group.title}</h3>
                  <p class="components-tab__group-desc">{group.description}</p>
                </div>
                <Show when={group.toggle}>
                  {(toggle) => (
                    <label class="components-tab__toggle">
                      <input
                        type="checkbox"
                        checked={group.enabled()}
                        aria-label={group.enabled()
                          ? t('mlearn.ComponentsTab.Enabled')
                          : t('mlearn.ComponentsTab.Disabled')}
                        onChange={(e) => toggle()(e.currentTarget.checked)}
                      />
                      <span class="components-tab__toggle-slider" />
                    </label>
                  )}
                </Show>
              </div>

              <div class="components-tab__item-list">
                {group.items.map((item) => (
                  <div class="components-tab__item">
                    <div class="components-tab__item-copy">
                      <span class="components-tab__item-title">{item.title}</span>
                      <p class="components-tab__item-desc">{item.description}</p>
                    </div>
                    <span class={`components-tab__status ${(item.enabled?.() ?? group.enabled()) ? 'components-tab__status--enabled' : 'components-tab__status--disabled'}`}>
                      {(item.enabled?.() ?? group.enabled())
                        ? t('mlearn.ComponentsTab.Enabled')
                        : t('mlearn.ComponentsTab.Disabled')}
                    </span>
                  </div>
                ))}
              </div>
            </section>
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
