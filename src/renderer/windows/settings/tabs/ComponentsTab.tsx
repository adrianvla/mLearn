import { Component, createMemo, createSignal, Show } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { getOcrRuntimeConfig } from '../../../../shared/languageFeatures';
import { Panel, Btn, AlertBanner } from '../../../components/common';
import './ComponentsTab.css';

const KNOWN_OCR_ENGINE_LABEL_KEYS = {
  rapidocr: 'RapidOCR',
  paddleocr: 'PaddleOCR',
  mangaocr: 'MangaOCR',
} as const;

const KNOWN_TTS_ENGINE_LABEL_KEYS = {
  kokoro: 'KokoroTts',
  qwen3: 'QwenTts',
} as const;

const RUNTIME_LABEL_OVERRIDES: Record<string, string> = {
  ai: 'AI',
  llm: 'LLM',
  ocr: 'OCR',
  stt: 'STT',
  tts: 'TTS',
  qwen3: 'Qwen3',
};

function formatRuntimeIdentifier(identifier: string): string {
  return identifier
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => RUNTIME_LABEL_OVERRIDES[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function formatOcrEngineName(engine: string): string {
  return formatRuntimeIdentifier(engine).replace(/\s+OCR$/u, '');
}

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
  const { langData, languageDataCatalog } = useLanguage();
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
    const installedLanguages = Object.values(langData);
    const installedOcrEngines = new Set<string>();
    const installedTtsEngines = new Set<string>();
    let hasInstalledSttRuntime = false;
    for (const data of installedLanguages) {
      const engine = getOcrRuntimeConfig(data).recognitionEngine;
      if (engine) installedOcrEngines.add(engine);
      const ttsConfig = data.runtime?.tts;
      const ttsEngine = ttsConfig?.engine;
      if (ttsEngine) {
        installedTtsEngines.add(ttsEngine);
      }
      if (ttsConfig?.kokoroLangCode) installedTtsEngines.add('kokoro');
      if (ttsConfig?.qwen3LanguageName) installedTtsEngines.add('qwen3');
      if (data.runtime?.stt?.whisperLanguage) hasInstalledSttRuntime = true;
    }

    const ocrItems: InstalledComponentGroup['items'] = [];
    for (const engine of Array.from(installedOcrEngines).sort()) {
      if (engine in KNOWN_OCR_ENGINE_LABEL_KEYS) {
        const label = KNOWN_OCR_ENGINE_LABEL_KEYS[engine as keyof typeof KNOWN_OCR_ENGINE_LABEL_KEYS];
        ocrItems.push({
          title: t(`mlearn.ComponentsTab.Items.${label}.Title`),
          description: t(`mlearn.ComponentsTab.Items.${label}.Description`),
        });
        continue;
      }
      ocrItems.push({
        title: t('mlearn.ComponentsTab.Items.GenericOCR.Title', { engine: formatOcrEngineName(engine) }),
        description: t('mlearn.ComponentsTab.Items.GenericOCR.Description'),
      });
    }

    const voiceItems: InstalledComponentGroup['items'] = [];
    if (hasInstalledSttRuntime) {
      voiceItems.push(
        {
          title: t('mlearn.ComponentsTab.Items.WhisperSmall.Title'),
          description: t('mlearn.ComponentsTab.Items.WhisperSmall.Description'),
        },
        {
          title: t('mlearn.ComponentsTab.Items.SileroVad.Title'),
          description: t('mlearn.ComponentsTab.Items.SileroVad.Description'),
        },
      );
    }
    for (const engine of Array.from(installedTtsEngines).sort()) {
      if (engine in KNOWN_TTS_ENGINE_LABEL_KEYS) {
        const label = KNOWN_TTS_ENGINE_LABEL_KEYS[engine as keyof typeof KNOWN_TTS_ENGINE_LABEL_KEYS];
        voiceItems.push({
          title: t(`mlearn.ComponentsTab.Items.${label}.Title`),
          description: t(`mlearn.ComponentsTab.Items.${label}.Description`),
        });
        continue;
      }
      voiceItems.push({
        title: t('mlearn.ComponentsTab.Items.GenericTTS.Title', { engine: formatRuntimeIdentifier(engine) }),
        description: t('mlearn.ComponentsTab.Items.GenericTTS.Description'),
      });
    }

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
      items: ocrItems,
    },
    ];

    if (voiceItems.length > 0) {
      groups.push({
        key: 'voice',
        title: t('mlearn.ComponentsTab.Groups.Voice.Title'),
        description: t('mlearn.ComponentsTab.Groups.Voice.Description'),
        enabled: () => settings.voiceEnabled,
        toggle: (v: boolean) => updateSettings({ voiceEnabled: v }),
        items: voiceItems,
      });
    }

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
