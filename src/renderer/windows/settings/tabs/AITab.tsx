/**
 * AI Settings Tab
 * Configure AI provider (built-in vs Ollama), model download, and connection settings.
 */

import { Component, Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import {
  SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText, ToggleSwitch,
  BotIcon
} from '../../../components/common';
import { getBridge } from '../../../../shared/bridges';
import { CloudLLMAdapter } from '../../../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../../../shared/backends';
import { BUILTIN_MODELS, autoselectBuiltinModel, getModelUrl } from '../../../../shared/builtinModels';
import type { LLMProvider, LLMModelStatus, OCRProvider, SystemMemoryInfo } from '../../../../shared/types';
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

  // Autoselect state
  const [autoselectMsg, setAutoselectMsg] = createSignal<string | null>(null);
  const [autoselecting, setAutoselecting] = createSignal(false);

  // Downloaded models manager
  const [downloadedModels, setDownloadedModels] = createSignal<Array<{ modelFile: string; sizeBytes: number }>>([]);
  const [deletingModel, setDeletingModel] = createSignal<string | null>(null);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = createSignal<string | null>(null);

  // Check model status on mount
  createEffect(() => {
    checkModelStatus();
  });

  createEffect(() => {
    if (settings.llmProvider !== 'ollama') return;
    void handleFetchOllamaModels();
  });

  // Listen for download progress updates only
  createEffect(() => {
    const bridge = getBridge();

    const cleanupProgress = bridge.llm.onLLMDownloadProgress((status: LLMModelStatus) => {
      setModelStatus(status);
    });

    onCleanup(() => {
      cleanupProgress();
    });
  });

  // First-launch autoselect
  createEffect(() => {
    if (settings.llmProvider === 'builtin' && !settings.builtinModelAutoselected) {
      void runAutoselect();
    }
  });

  // Re-check model status whenever the selected model changes
  createEffect(() => {
    const modelFile = settings.builtinModel;
    if (settings.llmProvider === 'builtin' && modelFile) {
      void checkModelStatus(modelFile);
    }
  });

  // Fetch downloaded models list when on builtin provider
  createEffect(() => {
    if (settings.llmProvider === 'builtin') {
      void fetchDownloadedModels();
    }
  });

  // Refresh downloaded models list after a download completes
  createEffect(() => {
    const bridge = getBridge();

    const cleanupStatus = bridge.llm.onLLMModelStatus((status: LLMModelStatus) => {
      setModelStatus(status);
      if (status.downloaded) {
        void fetchDownloadedModels();
      }
    });

    onCleanup(() => {
      cleanupStatus();
    });
  });

  async function checkModelStatus(modelFile?: string) {
    try {
      const status = await getBridge().llm.llmCheckModel(modelFile ?? settings.builtinModel);
      setModelStatus(status);
    } catch {
      // Ignore — status will remain default
    }
  }

  async function runAutoselect() {
    const bridge = getBridge();
    if (!bridge.llm.llmGetSystemMemory) return;
    setAutoselecting(true);
    setAutoselectMsg(null);
    try {
      const memInfo: SystemMemoryInfo = await bridge.llm.llmGetSystemMemory();
      const selected = autoselectBuiltinModel(memInfo);
      const memGb = memInfo.hasDiscreteGpu
        ? Math.round(memInfo.dedicatedVramBytes / 1024 ** 3)
        : Math.round(memInfo.totalRamBytes / 1024 ** 3);
      const memLabel = memInfo.hasDiscreteGpu ? 'VRAM' : 'unified memory';
      updateSettings({ builtinModel: selected.modelFile, builtinModelAutoselected: true });
      setAutoselectMsg(`Detected ${memGb} GB ${memLabel} — selected ${selected.displayName}`);
      setTimeout(() => setAutoselectMsg(null), 5000);
      await checkModelStatus(selected.modelFile);
    } catch {
      setAutoselectMsg(null);
    } finally {
      setAutoselecting(false);
    }
  }

  async function fetchDownloadedModels() {
    const bridge = getBridge();
    if (!bridge.llm.llmListDownloadedModels) return;
    try {
      const list = await bridge.llm.llmListDownloadedModels();
      setDownloadedModels(list);
    } catch {
      setDownloadedModels([]);
    }
  }

  async function handleDeleteModel(modelFile: string) {
    const bridge = getBridge();
    if (!bridge.llm.llmDeleteModel) return;
    setDeletingModel(modelFile);
    try {
      await bridge.llm.llmDeleteModel(modelFile);
      const model = BUILTIN_MODELS.find((m) => m.modelFile === modelFile);
      if (model) {
        setDeleteConfirmMsg(`Deleted ${model.displayName}`);
        setTimeout(() => setDeleteConfirmMsg(null), 3000);
      }
      await fetchDownloadedModels();
    } catch {
      // silently ignore
    } finally {
      setDeletingModel(null);
    }
  }

  function handleProviderChange(provider: LLMProvider) {
    updateSettings({ llmProvider: provider, llmConfigured: true });
  }

  async function handleDownloadModel() {
    const model = BUILTIN_MODELS.find((m) => m.modelFile === settings.builtinModel)
      ?? BUILTIN_MODELS[BUILTIN_MODELS.length - 1];
    setModelStatus((prev) => ({ ...prev, downloading: true, progress: 0, error: undefined }));
    try {
      getBridge().llm.llmDownloadModel(getModelUrl(model), model.modelFile);
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
          {/* Model chooser */}
          <SettingRow
            label={t('mlearn.AI.Settings.BuiltinModel.ModelName')}
            description=""
          >
            <div class="ai-model-chooser-row">
              <Select
                class="setting-select"
                value={settings.builtinModel}
                onChange={(e) => {
                  const modelFile = e.currentTarget.value;
                  updateSettings({ builtinModel: modelFile, builtinModelAutoselected: true });
                  getBridge().llm.llmUnloadModel();
                  void checkModelStatus(modelFile);
                }}
                options={BUILTIN_MODELS.map((m) => ({ value: m.modelFile, label: m.displayName }))}
              />
              <Show when={getBridge().llm.llmGetSystemMemory}>
                <Btn
                  size="sm"
                  onClick={() => void runAutoselect()}
                  disabled={autoselecting()}
                  loading={autoselecting()}
                >
                  Autoselect
                </Btn>
              </Show>
            </div>
            <Show when={settings.builtinModel}>
              {(() => {
                const model = BUILTIN_MODELS.find((m) => m.modelFile === settings.builtinModel);
                return model ? (
                  <HintText>~{model.fileSizeGb} GB download · Requires ~{model.requiredMemoryGb} GB RAM</HintText>
                ) : null;
              })()}
            </Show>
            <Show when={autoselectMsg()}>
              <HintText>{autoselectMsg()}</HintText>
            </Show>
          </SettingRow>

          {/* Model download status */}
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

        {/* Downloaded models manager */}
        <SettingGroup title="Downloaded Models">
          <Show
            when={downloadedModels().length > 0}
            fallback={<HintText>No models downloaded.</HintText>}
          >
            <For each={downloadedModels()}>
              {(item) => {
                const modelConfig = BUILTIN_MODELS.find((m) => m.modelFile === item.modelFile);
                if (!modelConfig) return null;
                return (
                  <SettingRow
                    label={modelConfig.displayName}
                    description={formatBytes(item.sizeBytes)}
                  >
                    <Btn
                      size="sm"
                      variant="danger"
                      onClick={() => void handleDeleteModel(item.modelFile)}
                      disabled={deletingModel() === item.modelFile}
                      loading={deletingModel() === item.modelFile}
                    >
                      Delete
                    </Btn>
                  </SettingRow>
                );
              }}
            </For>
            <Show when={deleteConfirmMsg()}>
              <HintText>{deleteConfirmMsg()}</HintText>
            </Show>
          </Show>
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
                  options={ollamaModels().map((model) => ({ value: model, label: model }))}
                />
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


      {/* Agent Memory */}
      <SettingGroup title={t('mlearn.AI.Settings.AgentMemory.Title')}>
        <SettingRow
          label={t('mlearn.AI.Settings.AgentMemory.Enable.Label')}
          description={t('mlearn.AI.Settings.AgentMemory.Enable.Description')}
        >
          <ToggleSwitch
            checked={settings.agentMemoryEnabled}
            onChange={(checked) => updateSettings({ agentMemoryEnabled: checked })}
          />
        </SettingRow>
        <SettingRow
          label={t('mlearn.AI.Settings.AgentMemory.Shared.Label')}
          description={t('mlearn.AI.Settings.AgentMemory.Shared.Description')}
        >
          <ToggleSwitch
            checked={settings.agentMemoryShared}
            onChange={(checked) => updateSettings({ agentMemoryShared: checked })}
          />
        </SettingRow>
      </SettingGroup>

      {/* Checker Agent */}
      <SettingGroup title={t('mlearn.AI.Settings.SplitChecker.Title')}>
        <SettingRow
          label={t('mlearn.AI.Settings.SplitChecker.Label')}
          description={t('mlearn.AI.Settings.SplitChecker.Description')}
        >
          <ToggleSwitch
            checked={settings.agentSplitChecker}
            onChange={(checked) => updateSettings({ agentSplitChecker: checked })}
          />
        </SettingRow>
      </SettingGroup>

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
