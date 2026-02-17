/**
 * AI Settings Tab
 * Configure AI provider (built-in vs Ollama), model download, and connection settings.
 */

import { Component, Show, createSignal, createEffect, onCleanup, For } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText } from '../../../components/common';
import type { LLMProvider, LLMModelStatus } from '../../../../shared/types';

export const AITab: Component = () => {
  const { settings, updateSettings, updateSetting } = useSettings();
  const { t } = useLocalization();

  // Built-in model state
  const [modelStatus, setModelStatus] = createSignal<LLMModelStatus>({
    downloaded: false,
    downloading: false,
    progress: 0,
    downloadedBytes: 0,
    expectedBytes: 0,
    loaded: false,
  });

  // Ollama state
  const [ollamaConnected, setOllamaConnected] = createSignal<boolean | null>(null);
  const [ollamaTesting, setOllamaTesting] = createSignal(false);
  const [ollamaTestSuccess, setOllamaTestSuccess] = createSignal(false);
  const [ollamaModels, setOllamaModels] = createSignal<string[]>([]);
  const [loadingModels, setLoadingModels] = createSignal(false);

  // Check model status on mount
  createEffect(() => {
    checkModelStatus();
  });

  createEffect(() => {
    if (settings.llmProvider !== 'ollama') return;
    void handleFetchOllamaModels();
  });

  // Listen for download progress and model status updates
  createEffect(() => {
    const ipc = window.mLearnIPC;
    if (!ipc) return;

    const cleanupProgress = ipc.onLLMDownloadProgress((status: LLMModelStatus) => {
      setModelStatus(status);
    });

    const cleanupStatus = ipc.onLLMModelStatus((status: LLMModelStatus) => {
      setModelStatus(status);
    });

    onCleanup(() => {
      cleanupProgress();
      cleanupStatus();
    });
  });

  async function checkModelStatus() {
    const ipc = window.mLearnIPC;
    if (!ipc) return;
    try {
      const status = await ipc.llmCheckModel();
      setModelStatus(status);
    } catch {
      // Ignore — status will remain default
    }
  }

  function handleProviderChange(provider: LLMProvider) {
    updateSetting('llmProvider', provider);
    updateSetting('llmConfigured', true);
  }

  async function handleDownloadModel() {
    const ipc = window.mLearnIPC;
    if (!ipc) return;
    setModelStatus((prev) => ({ ...prev, downloading: true, progress: 0, error: undefined }));
    try {
      await ipc.llmDownloadModel();
    } catch (e) {
      setModelStatus((prev) => ({ ...prev, downloading: false, error: String(e) }));
    }
  }

  async function handleTestOllama() {
    const ipc = window.mLearnIPC;
    if (!ipc) return;
    setOllamaTesting(true);
    setOllamaConnected(null);
    setOllamaTestSuccess(false);
    try {
      const ok = await ipc.ollamaCheck();
      setOllamaConnected(ok);
      if (ok) {
        setOllamaTestSuccess(true);
        setTimeout(() => setOllamaTestSuccess(false), 3000);
      }
    } catch {
      setOllamaConnected(false);
    } finally {
      setOllamaTesting(false);
    }
  }

  async function handleFetchOllamaModels() {
    const ipc = window.mLearnIPC;
    if (!ipc) return;
    setLoadingModels(true);
    try {
      const models = await ipc.ollamaListModels();
      setOllamaModels((models || []) as string[]);
    } catch {
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  return (
    <TabContent
      header={{
        title: t('mlearn.AI.Settings.Title'),
        description: t('mlearn.AI.Settings.Description'),
        icon: '✨',
      }}
      padding="lg"
    >
      {/* Provider Selection */}
      <SettingGroup title={t('mlearn.AI.Settings.Provider.Title')}>
        <SettingRow
          label={t('mlearn.AI.Settings.Provider.Title')}
          description={t('mlearn.AI.Settings.Provider.Description')}
        >
          <Select
            class="setting-select"
            value={settings.llmProvider}
            onInput={(e) => handleProviderChange(e.currentTarget.value as LLMProvider)}
          >
            <option value="builtin">
              {t('mlearn.AI.Settings.Provider.Builtin')}
            </option>
            <option value="ollama">
              {t('mlearn.AI.Settings.Provider.Ollama')}
            </option>
          </Select>
        </SettingRow>
      </SettingGroup>

      {/* Built-in Model Section */}
      <Show when={settings.llmProvider === 'builtin'}>
        <SettingGroup title={t('mlearn.AI.Settings.BuiltinModel.Title')}>
          <SettingRow
            label={t('mlearn.AI.Settings.BuiltinModel.ModelName')}
            description={t('mlearn.AI.Settings.BuiltinModel.DiskSpace', { size: '~2.8 GB' })}
          >
            <span class="setting-value">{settings.builtinModel || 'Qwen3-4B-Instruct-Q4_K_M.gguf'}</span>
          </SettingRow>

          <SettingRow
            label={t('mlearn.AI.Settings.BuiltinModel.Status')}
            description=""
          >
            <div class="ai-model-status">
              <Show when={modelStatus().downloading}>
                <div class="ai-download-progress">
                  <div class="ai-progress-bar">
                    <div
                      class="ai-progress-fill"
                      style={{ width: `${Math.round(modelStatus().progress * 100)}%` }}
                    />
                  </div>
                  <span class="ai-progress-text">
                    {Math.round(modelStatus().progress * 100)}% — {formatBytes(modelStatus().downloadedBytes)} / {formatBytes(modelStatus().expectedBytes)}
                  </span>
                </div>
              </Show>

              <Show when={!modelStatus().downloading && modelStatus().downloaded}>
                <span class="ai-status-ok">{t('mlearn.AI.ModelReady')}</span>
                <Btn size="sm" onClick={handleDownloadModel}>
                  {t('mlearn.AI.Settings.BuiltinModel.Redownload')}
                </Btn>
              </Show>

              <Show when={!modelStatus().downloading && !modelStatus().downloaded}>
                <span class="ai-status-missing">{t('mlearn.AI.ModelNotDownloaded')}</span>
                <Btn size="sm" variant="primary" onClick={handleDownloadModel}>
                  {t('mlearn.AI.DownloadModel')}
                </Btn>
              </Show>

              <Show when={modelStatus().error}>
                <span class="ai-status-error">{modelStatus().error}</span>
              </Show>
            </div>
          </SettingRow>
        </SettingGroup>
      </Show>

      {/* Ollama Configuration */}
      <Show when={settings.llmProvider === 'ollama'}>
        <SettingGroup title={t('mlearn.AI.Settings.OllamaConfig.Title')}>
          <SettingRow
            label={t('mlearn.AI.Settings.OllamaConfig.ServerUrl')}
            description={t('mlearn.AI.Settings.OllamaConfig.ServerUrlHint')}
          >
            <Input
              value={settings.ollamaUrl}
              onInput={(e) => updateSettings({ ollamaUrl: e.currentTarget.value })}
              placeholder="http://localhost:11434"
              size="md"
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.AI.Settings.OllamaConfig.Model')}
            description={t('mlearn.AI.Settings.OllamaConfig.ModelHint')}
          >
            <div class="ai-ollama-model-row">
              <Show
                when={ollamaModels().length > 0}
                fallback={
                  <Input
                    value={settings.ollamaModel}
                    onInput={(e) => updateSettings({ ollamaModel: e.currentTarget.value })}
                    placeholder="qwen3:8b"
                    size="md"
                  />
                }
              >
                <Select
                  class="setting-select"
                  value={settings.ollamaModel}
                  onChange={(e) => {
                    updateSettings({ ollamaModel: e.currentTarget.value });
                  }}
                >
                  <For each={ollamaModels()}>
                    {(model) => <option value={model}>{model}</option>}
                  </For>
                </Select>
              </Show>
            </div>
            <Show when={loadingModels()}>
              <HintText>{t('mlearn.AI.Settings.OllamaConfig.LoadingModels')}</HintText>
            </Show>
          </SettingRow>

          <SettingRow
            label={t('mlearn.AI.Settings.OllamaConfig.TestConnection')}
            description=""
          >
            <div class="ai-connection-test">
              <Btn
                size="sm"
                variant={ollamaTestSuccess() ? 'success' : 'default'}
                onClick={handleTestOllama}
                disabled={ollamaTesting()}
                loading={ollamaTesting()}
                icon={ollamaTestSuccess() ? 'check' : undefined}
              >
                {ollamaTestSuccess()
                  ? t('mlearn.AI.Settings.OllamaConfig.ConnectionSuccess')
                  : t('mlearn.AI.Settings.OllamaConfig.TestConnection')
                }
              </Btn>
              <Show when={ollamaConnected() === false}>
                <span class="ai-status-error">{t('mlearn.AI.Settings.OllamaConfig.ConnectionFailed')}</span>
              </Show>
            </div>
          </SettingRow>

          <SettingRow
            label=""
            description=""
          >
            <HintText>
              {t('mlearn.AI.Settings.OllamaConfig.InstallHintPrefix')}{' '}
              <a href={t('mlearn.AI.OllamaInstallGuideUrl')} target="_blank">
                {t('mlearn.AI.OllamaInstallGuide')}
              </a>{' '}
              {t('mlearn.AI.Settings.OllamaConfig.InstallHintSuffix')}
            </HintText>
          </SettingRow>
        </SettingGroup>
      </Show>
    </TabContent>
  );
};
