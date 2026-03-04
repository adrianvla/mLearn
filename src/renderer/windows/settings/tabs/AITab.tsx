/**
 * AI Settings Tab
 * Configure AI provider (built-in vs Ollama), model download, and connection settings.
 */

import { Component, Show, createSignal, createEffect, onCleanup, For } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import {
  SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText,
  BotIcon
} from '../../../components/common';
import { getBridge } from '../../../../shared/bridges';
import { CloudLLMAdapter } from '../../../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../../../shared/backends';
import type { LLMProvider, LLMModelStatus, OCRProvider } from '../../../../shared/types';
import '../SettingsForm.css';
import './AITab.css';

export const AITab: Component = () => {
  const { settings, updateSettings } = useSettings();
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

  // Cloud LLM state
  const [testingCloudLLM, setTestingCloudLLM] = createSignal(false);
  const [cloudLLMStatus, setCloudLLMStatus] = createSignal<'idle' | 'success' | 'error'>('idle');

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
    const bridge = getBridge();

    const cleanupProgress = bridge.llm.onLLMDownloadProgress((status: LLMModelStatus) => {
      setModelStatus(status);
    });

    const cleanupStatus = bridge.llm.onLLMModelStatus((status: LLMModelStatus) => {
      setModelStatus(status);
    });

    onCleanup(() => {
      cleanupProgress();
      cleanupStatus();
    });
  });

  async function checkModelStatus() {
    try {
      const status = await getBridge().llm.llmCheckModel();
      setModelStatus(status);
    } catch {
      // Ignore — status will remain default
    }
  }

  function handleProviderChange(provider: LLMProvider) {
    updateSettings({ llmProvider: provider, llmConfigured: true });
  }

  async function handleDownloadModel() {
    setModelStatus((prev) => ({ ...prev, downloading: true, progress: 0, error: undefined }));
    try {
      await getBridge().llm.llmDownloadModel();
    } catch (e) {
      setModelStatus((prev) => ({ ...prev, downloading: false, error: String(e) }));
    }
  }

  async function handleTestOllama() {
    setOllamaTesting(true);
    setOllamaConnected(null);
    setOllamaTestSuccess(false);
    try {
      const ok = await getBridge().llm.ollamaCheck();
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
    setLoadingModels(true);
    try {
      const models = await getBridge().llm.ollamaListModels();
      const modelList = (models || []) as string[];
      setOllamaModels(modelList);
      // If the current model isn't in the available list, auto-select the first available
      if (modelList.length > 0 && !modelList.includes(settings.ollamaModel)) {
        updateSettings({ ollamaModel: modelList[0] });
      }
    } catch {
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleTestCloudLLM() {
    setTestingCloudLLM(true);
    setCloudLLMStatus('idle');
    try {
      const cloudApiUrl = resolveCloudApiUrl(settings);
      const adapter = new CloudLLMAdapter(
        cloudApiUrl,
        settings.cloudAuthAccessToken || settings.cloudAuthToken,
      );
      const ok = await adapter.checkAvailability();
      setCloudLLMStatus(ok ? 'success' : 'error');
    } catch {
      setCloudLLMStatus('error');
    } finally {
      setTestingCloudLLM(false);
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
        icon: <BotIcon size={20} />,
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
            onChange={(e) => handleProviderChange(e.currentTarget.value as LLMProvider)}
            options={[
              { value: 'builtin', label: t('mlearn.AI.Settings.Provider.Builtin') },
              { value: 'ollama', label: t('mlearn.AI.Settings.Provider.Ollama') },
              { value: 'cloud', label: t('mlearn.AI.Settings.Provider.Cloud') },
            ]}
          />
        </SettingRow>
      </SettingGroup>

      {/* Built-in Model Section */}
      <Show when={settings.llmProvider === 'builtin'}>
        <SettingGroup title={t('mlearn.AI.Settings.BuiltinModel.Title')}>
          <SettingRow
            label={t('mlearn.AI.Settings.BuiltinModel.ModelName')}
            description={t('mlearn.AI.Settings.BuiltinModel.DiskSpace', { size: '~5.7 GB' })}
          >
            <span class="setting-value">{settings.builtinModel || 'Qwen3.5-9B-Q4_K_M.gguf'}</span>
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
            <Btn
              size="sm"
              variant={ollamaTestSuccess() ? 'success' : ollamaConnected() === false ? 'danger' : 'default'}
              onClick={handleTestOllama}
              disabled={ollamaTesting()}
              loading={ollamaTesting()}
              icon={ollamaTestSuccess() ? 'check' : undefined}
            >
              {ollamaTestSuccess()
                ? t('mlearn.AI.Settings.OllamaConfig.ConnectionSuccess')
                : ollamaConnected() === false
                  ? t('mlearn.Connection.Unreachable')
                  : t('mlearn.AI.Settings.OllamaConfig.TestConnection')
              }
            </Btn>
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

      {/* Cloud LLM Configuration */}
      <Show when={settings.llmProvider === 'cloud'}>
        <SettingGroup title={t('mlearn.AI.Settings.CloudConfig.Title')}>
          <SettingRow
            label={t('mlearn.Connection.AuthStatus') || 'Cloud Account'}
            description={t('mlearn.AI.Settings.CloudConfig.TokenHint')}
          >
            <span class="setting-value">
              {settings.cloudAuthStatus === 'signed-in'
                ? (settings.cloudAuthUserEmail || (t('mlearn.Connection.Connected') || 'Connected'))
                : (t('mlearn.Connection.SignIn') || 'Sign in from Connection settings')}
            </span>
          </SettingRow>

          <SettingRow
            label={t('mlearn.AI.Settings.CloudConfig.TestConnection')}
            description=""
          >
            <Btn
              size="sm"
              variant={cloudLLMStatus() === 'success' ? 'success' : cloudLLMStatus() === 'error' ? 'danger' : 'default'}
              onClick={handleTestCloudLLM}
              disabled={testingCloudLLM()}
              loading={testingCloudLLM()}
              icon={cloudLLMStatus() === 'success' ? 'check' : undefined}
            >
              {cloudLLMStatus() === 'success'
                ? t('mlearn.AI.Settings.CloudConfig.ConnectionSuccess')
                : cloudLLMStatus() === 'error'
                  ? t('mlearn.Connection.Unreachable')
                  : t('mlearn.AI.Settings.CloudConfig.TestConnection')
              }
            </Btn>
          </SettingRow>

          <HintText>
            {t('mlearn.AI.Settings.CloudConfig.ApiUrlHint')}
          </HintText>
        </SettingGroup>
      </Show>


      <SettingGroup title={t('mlearn.AI.Settings.OCR.Title')}>
        <SettingRow
            label={t('mlearn.AI.Settings.OCR.Provider.Label')}
            description={t('mlearn.AI.Settings.OCR.Provider.Description')}
        >
          <Select
              class="setting-select"
              value={settings.ocrProvider ?? 'local'}
              onChange={(e) => updateSettings({ ocrProvider: e.currentTarget.value as OCRProvider })}
              options={[
                { value: 'local', label: t('mlearn.AI.Settings.OCR.Provider.Local') },
                { value: 'cloud', label: t('mlearn.AI.Settings.OCR.Provider.Cloud') },
              ]}
          />
        </SettingRow>
      </SettingGroup>

    </TabContent>
  );
};
