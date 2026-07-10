import { Component, createMemo, createSignal, Show } from 'solid-js';
import { useLanguage, useLocalization, useSettings } from '../../../context';
import { getBridge } from '../../../../shared/bridges';
import { getOcrRuntimeConfig } from '../../../../shared/languageFeatures';
import { Panel, Btn, AlertBanner, ManagedSettingNotice } from '../../../components/common';
import type { LanguageDataCatalogStatus } from '../../../../shared/types';
import type { PolicySettingKey } from '../../../../shared/managementPolicy';
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

type CatalogAssetStatus = LanguageDataCatalogStatus['assets'][number];
type CatalogDictionaryPackStatus = NonNullable<LanguageDataCatalogStatus['dictionaryPacks']>[number];

type InstalledComponentGroup = {
  key: string;
  policySettingKey: PolicySettingKey;
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

type LanguagePackRow = {
  key: string;
  kind: 'language' | 'dictionary';
  language: string;
  dictionaryTargetLanguage?: string;
  title: string;
  description: string;
  installed: boolean;
  outdated: boolean;
  totalBytes: number;
  installedBytes: number;
  missingRequiredAssets: string[];
  assets: CatalogAssetStatus[];
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

function normalizeTtsEngine(engine: string): string {
  const lower = engine.toLowerCase();
  if (lower.includes('qwen3')) return 'qwen3';
  if (lower.includes('kokoro')) return 'kokoro';
  return engine;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function getPackHealth(row: Pick<LanguagePackRow, 'installed' | 'outdated'>): 'installed' | 'outdated' | 'missing' {
  if (row.outdated) return 'outdated';
  return row.installed ? 'installed' : 'missing';
}

function getAssetHealth(asset: CatalogAssetStatus): 'installed' | 'outdated' | 'error' | 'missing' {
  if (asset.validationIssue) return 'error';
  if (asset.outdated) return 'outdated';
  return asset.installed ? 'installed' : 'missing';
}

function getAssetDisplayPath(asset: CatalogAssetStatus): string {
  return asset.path.replace(/^.*\/language-data[\\/]/u, '');
}

export const ComponentsTab: Component = () => {
  const { t } = useLocalization();
  const { settings, updateSettings, getManagedSettingSource } = useSettings();
  const {
    langData,
    languageDataCatalog,
    installLanguageData,
    isLanguageDataInstalling,
    languageDataInstallError,
  } = useLanguage();
  const [runtimeInstalling, setRuntimeInstalling] = createSignal(false);
  const [runtimeInstallError, setRuntimeInstallError] = createSignal<string | null>(null);

  const runtimeGroups = createMemo<InstalledComponentGroup[]>(() => {
    const installedLanguages = Object.values(langData);
    const installedOcrEngines = new Set<string>();
    const installedTtsEngines = new Set<string>();
    let hasInstalledSttRuntime = false;
    for (const data of installedLanguages) {
      const engine = getOcrRuntimeConfig(data).recognitionEngine;
      if (engine) installedOcrEngines.add(engine);
      const ttsConfig = data.runtime?.tts;
      const ttsEngine = ttsConfig?.engine;
      if (ttsEngine) installedTtsEngines.add(normalizeTtsEngine(ttsEngine));
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
        policySettingKey: 'llmEnabled',
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
        policySettingKey: 'ocrEnabled',
        title: t('mlearn.ComponentsTab.Groups.Reader.Title'),
        description: t('mlearn.ComponentsTab.Groups.Reader.Description'),
        enabled: () => settings.ocrEnabled,
        toggle: (v: boolean) => updateSettings({ ocrEnabled: v }),
        items: ocrItems,
      },
    ];

    if (voiceItems.length > 0 || getManagedSettingSource('voiceEnabled')) {
      groups.push({
        key: 'voice',
        policySettingKey: 'voiceEnabled',
        title: t('mlearn.ComponentsTab.Groups.Voice.Title'),
        description: t('mlearn.ComponentsTab.Groups.Voice.Description'),
        enabled: () => settings.voiceEnabled,
        toggle: (v: boolean) => updateSettings({ voiceEnabled: v }),
        items: voiceItems,
      });
    }

    return groups;
  });

  const languagePackRows = createMemo<LanguagePackRow[]>(() => {
    const rows: LanguagePackRow[] = [];
    for (const status of languageDataCatalog()) {
      rows.push({
        key: status.language,
        kind: 'language',
        language: status.language,
        title: t('mlearn.ComponentsTab.LanguageData.CoreTitle', {
          language: status.nameTranslated ?? status.name,
        }),
        description: t('mlearn.ComponentsTab.LanguageData.CoreDescription', {
          language: status.name,
        }),
        installed: status.installed,
        outdated: status.outdated,
        totalBytes: status.totalBytes,
        installedBytes: status.installedBytes,
        missingRequiredAssets: status.missingRequiredAssets,
        assets: status.assets,
      });

      for (const pack of status.dictionaryPacks ?? []) {
        rows.push(buildDictionaryPackRow(status, pack, t));
      }
    }
    return rows.sort((left, right) => {
      if (left.language !== right.language) return left.language.localeCompare(right.language);
      if (left.kind !== right.kind) return left.kind === 'language' ? -1 : 1;
      return left.title.localeCompare(right.title);
    });
  });

  const handleRuntimeRepair = () => {
    setRuntimeInstalling(true);
    setRuntimeInstallError(null);
    try {
      getBridge().installer.startInstall({
        includeLLM: settings.llmEnabled,
        includeOCR: settings.ocrEnabled,
        includeVoice: settings.voiceEnabled,
      });
    } catch {
      setRuntimeInstallError(t('mlearn.Installer.Status.CouldNotStart'));
      setRuntimeInstalling(false);
    }
  };

  const handleInstallLanguagePack = (row: LanguagePackRow) => {
    installLanguageData(row.language, row.dictionaryTargetLanguage);
  };

  const renderPackStatus = (row: LanguagePackRow) => {
    const health = getPackHealth(row);
    return (
      <span class={`components-tab__status components-tab__status--${health}`}>
        {t(`mlearn.ComponentsTab.Status.${health}`)}
      </span>
    );
  };

  const renderAssetStatus = (asset: CatalogAssetStatus) => {
    const health = getAssetHealth(asset);
    return (
      <span class={`components-tab__asset-status components-tab__asset-status--${health}`}>
        {t(`mlearn.ComponentsTab.Status.${health}`)}
      </span>
    );
  };

  const renderLanguagePackRow = (row: LanguagePackRow) => {
    const isInstalling = isLanguageDataInstalling(row.language, row.dictionaryTargetLanguage);
    const installError = languageDataInstallError();
    const hasInstallError = installError?.language === row.language
      && installError.dictionaryTargetLanguage === row.dictionaryTargetLanguage;
    const needsInstall = !row.installed || row.outdated;
    return (
      <section class="components-tab__language-pack">
        <div class="components-tab__language-pack-header">
          <div class="components-tab__language-pack-copy">
            <div class="components-tab__language-pack-title-row">
              <h3 class="components-tab__group-title">{row.title}</h3>
              {renderPackStatus(row)}
            </div>
            <p class="components-tab__group-desc">{row.description}</p>
            <p class="components-tab__pack-meter">
              {t('mlearn.ComponentsTab.LanguageData.SizeStatus', {
                installed: formatBytes(row.installedBytes),
                total: formatBytes(row.totalBytes),
              })}
            </p>
          </div>
          <Show when={needsInstall}>
            <Btn
              variant="secondary"
              onClick={() => handleInstallLanguagePack(row)}
              disabled={isInstalling}
              class="components-tab__pack-action"
            >
              {isInstalling
                ? t('mlearn.Installer.Buttons.Installing')
                : row.outdated
                  ? t('mlearn.ComponentsTab.Actions.Update')
                  : t('mlearn.ComponentsTab.Actions.Install')}
            </Btn>
          </Show>
        </div>

        <Show when={hasInstallError}>
          <AlertBanner
            variant="error"
            title={t('mlearn.ComponentsTab.InstallErrorTitle')}
            message={installError!.error}
            class="components-tab__alert"
          />
        </Show>

        <div class="components-tab__asset-list">
          {row.assets.map((asset) => (
            <div class="components-tab__asset">
              <div class="components-tab__asset-copy">
                <span class="components-tab__asset-title">{asset.id}</span>
                <span class="components-tab__asset-path">{getAssetDisplayPath(asset)}</span>
                <Show when={asset.validationIssue}>
                  <span class="components-tab__asset-error">{asset.validationIssue}</span>
                </Show>
              </div>
              <div class="components-tab__asset-meta">
                <span class="components-tab__asset-size">{formatBytes(asset.sizeBytes ?? 0)}</span>
                {renderAssetStatus(asset)}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div class="components-tab">
      <h2 class="components-tab__title">{t('mlearn.Settings.Tabs.Components')}</h2>

      <Panel variant="default" rounded="lg" padding="lg" class="components-tab__panel">
        <p class="components-tab__description">
          {t('mlearn.ComponentsTab.Description')}
        </p>

        <section class="components-tab__section">
          <div class="components-tab__section-header">
            <h3 class="components-tab__section-title">{t('mlearn.ComponentsTab.Sections.Runtime.Title')}</h3>
            <p class="components-tab__section-desc">{t('mlearn.ComponentsTab.Sections.Runtime.Description')}</p>
          </div>
          <div class="components-tab__groups">
            {runtimeGroups().map((group) => (
              <section class="components-tab__group">
                <div class="components-tab__group-header">
                  <div>
                    <h3 class="components-tab__group-title">{group.title}</h3>
                    <p class="components-tab__group-desc">{group.description}</p>
                  </div>
                  <Show when={group.toggle}>
                    {(toggle) => (
                      <div class="components-tab__managed-toggle">
                        <label class="components-tab__toggle">
                          <input
                            type="checkbox"
                            checked={group.enabled()}
                            disabled={Boolean(getManagedSettingSource(group.policySettingKey))}
                            aria-label={`${group.title}: ${group.enabled()
                              ? t('mlearn.ComponentsTab.Enabled')
                              : t('mlearn.ComponentsTab.Disabled')}`}
                            onChange={(e) => toggle()(e.currentTarget.checked)}
                          />
                          <span class="components-tab__toggle-slider" />
                        </label>
                        <Show when={getManagedSettingSource(group.policySettingKey)}>
                          {(source) => <ManagedSettingNotice sourceGroupName={source().sourceGroupName} />}
                        </Show>
                      </div>
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
                      <span class={`components-tab__status ${(item.enabled?.() ?? group.enabled()) ? 'components-tab__status--installed' : 'components-tab__status--disabled'}`}>
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

          <Show when={runtimeInstallError()}>
            <AlertBanner
              variant="error"
              title={t('mlearn.Installer.Alerts.NetworkError')}
              message={runtimeInstallError()!}
              closable
              onClose={() => setRuntimeInstallError(null)}
              class="components-tab__alert"
            />
          </Show>

          <Btn
            variant="secondary"
            onClick={handleRuntimeRepair}
            disabled={runtimeInstalling()}
            class="components-tab__action"
          >
            {runtimeInstalling()
              ? t('mlearn.Installer.Buttons.Installing')
              : t('mlearn.ComponentsTab.Actions.RepairRuntime')}
          </Btn>
        </section>

        <section class="components-tab__section">
          <div class="components-tab__section-header">
            <h3 class="components-tab__section-title">{t('mlearn.ComponentsTab.Sections.LanguageData.Title')}</h3>
            <p class="components-tab__section-desc">{t('mlearn.ComponentsTab.Sections.LanguageData.Description')}</p>
          </div>
          <div class="components-tab__language-packs">
            {languagePackRows().map(renderLanguagePackRow)}
          </div>
        </section>

        <p class="components-tab__note">
          {t('mlearn.ComponentsTab.RestartNote')}
        </p>
      </Panel>
    </div>
  );
};

function buildDictionaryPackRow(
  status: LanguageDataCatalogStatus,
  pack: CatalogDictionaryPackStatus,
  t: (key: string, params?: Record<string, string | number>) => string,
): LanguagePackRow {
  return {
    key: `${status.language}:${pack.targetLanguage}`,
    kind: 'dictionary',
    language: status.language,
    dictionaryTargetLanguage: pack.targetLanguage,
    title: pack.name,
    description: t('mlearn.ComponentsTab.LanguageData.DictionaryDescription', {
      language: status.nameTranslated ?? status.name,
      target: pack.targetLanguage.toUpperCase(),
    }),
    installed: pack.installed,
    outdated: pack.outdated,
    totalBytes: pack.totalBytes,
    installedBytes: pack.installedBytes,
    missingRequiredAssets: pack.missingRequiredAssets,
    assets: pack.assets,
  };
}

export default ComponentsTab;
