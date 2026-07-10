/**
 * AI Settings Tab
 * Configure AI provider (built-in vs Ollama), model download, and connection settings.
 */

import { Component, Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import {
  SettingRow, SettingGroup, Btn, Select, Input, TabContent, HintText, ToggleSwitch, ConnectionStatus,
  BotIcon
} from '../../../components/common';
import { getBridge } from '../../../../shared/bridges';
import { CloudLLMAdapter } from '../../../../shared/backends/cloudLLMAdapter';
import { resolveCloudApiUrl } from '../../../../shared/backends';
import { BUILTIN_MODELS, autoselectBuiltinModel, getModelUrl } from '../../../../shared/builtinModels';
import { DEFAULT_SETTINGS, type LLMProvider, type LLMModelStatus, type OCRProvider, type SystemMemoryInfo } from '../../../../shared/types';
import { ensureCloudAccessToken, handleCloudSessionError } from '../../../services/cloudSessionManager';
import '../SettingsForm.css';
import './AITab.css';
import { getLogger } from '../../../../shared/utils/logger';

const log = getLogger("renderer.settings.ai");

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
  const [ollamaModels, setOllamaModels] = createSignal<string[]>([]);
  const [loadingModels, setLoadingModels] = createSignal(false);

  // Cloud LLM state
  const [testingCloudLLM, setTestingCloudLLM] = createSignal(false);
  const [cloudLLMStatus, setCloudLLMStatus] = createSignal<'idle' | 'success' | 'error' | 'auth'>('idle');

  // Autoselect state
  const [autoselectMsg, setAutoselectMsg] = createSignal<string | null>(null);
  const [autoselecting, setAutoselecting] = createSignal(false);

  // Downloaded models manager
  const [downloadedModels, setDownloadedModels] = createSignal<Array<{ modelFile: string; sizeBytes: number }>>([]);
  const [deletingModel, setDeletingModel] = createSignal<string | null>(null);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = createSignal<string | null>(null);

  const clearBuiltinStatusMessages = () => {
    setAutoselectMsg(null);
    setDeleteConfirmMsg(null);
  };

  const resetOllamaConnectionState = () => {
    setOllamaConnected(null);
  };

  // Check model status on mount
  createEffect(() => {
    checkModelStatus();
  });

  createEffect(() => {
    if (settings.llmProvider !== 'ollama') return;
    void handleFetchOllamaModels();
  });

  createEffect(() => {
    const provider = settings.llmProvider;

    if (provider !== 'builtin') {
      clearBuiltinStatusMessages();
    }

    if (provider !== 'ollama') {
      resetOllamaConnectionState();
    }

    if (provider !== 'cloud') {
      setCloudLLMStatus('idle');
    }
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
    } catch (e) {
      log.error("error", e);
      // Ignore — status will remain default
    }
  }

  async function runAutoselect() {
    const bridge = getBridge();
    if (!bridge.llm.llmGetSystemMemory) return;
    setAutoselecting(true);
    clearBuiltinStatusMessages();
    try {
      const memInfo: SystemMemoryInfo = await bridge.llm.llmGetSystemMemory();
      const selected = autoselectBuiltinModel(memInfo);
      const memGb = memInfo.hasDiscreteGpu
        ? Math.round(memInfo.dedicatedVramBytes / 1024 ** 3)
        : Math.round(memInfo.totalRamBytes / 1024 ** 3);
      const memLabel = memInfo.hasDiscreteGpu ? 'VRAM' : 'unified memory';
      updateSettings({ builtinModel: selected.modelFile, builtinModelAutoselected: true });
      setAutoselectMsg(`Detected ${memGb} GB ${memLabel} — selected ${selected.displayName}`);
      await checkModelStatus(selected.modelFile);
    } catch (e) {
      log.error("error", e);
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
    } catch (e) {
      log.error("error", e);
      setDownloadedModels([]);
    }
  }

  async function handleDeleteModel(modelFile: string) {
    const bridge = getBridge();
    if (!bridge.llm.llmDeleteModel) return;
    setDeletingModel(modelFile);
    setDeleteConfirmMsg(null);
    try {
      await bridge.llm.llmDeleteModel(modelFile);
      const model = BUILTIN_MODELS.find((m) => m.modelFile === modelFile);
      if (model) {
        setDeleteConfirmMsg(`Deleted ${model.displayName}`);
      }
      await fetchDownloadedModels();
    } catch (e) {
      log.error("error", e);
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
      log.error("error", e);
      setModelStatus((prev) => ({ ...prev, downloading: false, error: String(e) }));
    }
  }

  async function handleTestOllama() {
    setOllamaTesting(true);
    resetOllamaConnectionState();
    try {
      const ok = await getBridge().llm.ollamaCheck();
      setOllamaConnected(ok);
    } catch (e) {
      log.error("error", e);
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
    } catch (e) {
      log.error("error", e);
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  }

  async function handleTestCloudLLM() {
    setTestingCloudLLM(true);
    setCloudLLMStatus('idle');
    try {
      const accessToken = await ensureCloudAccessToken();
      if (!accessToken) {
        setCloudLLMStatus('auth');
        return;
      }

      const cloudApiUrl = resolveCloudApiUrl(settings);
      const adapter = new CloudLLMAdapter(
        cloudApiUrl,
        accessToken,
      );
      const ok = await adapter.checkAvailability();
      setCloudLLMStatus(ok ? 'success' : 'error');
    } catch (e) {
      log.error("error", e);
      const requiresSignIn = handleCloudSessionError(e, true);
      setCloudLLMStatus(requiresSignIn ? 'auth' : 'error');
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
                  clearBuiltinStatusMessages();
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
              onInput={(e) => {
                resetOllamaConnectionState();
                updateSettings({ ollamaUrl: e.currentTarget.value });
              }}
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
                    onInput={(e) => {
                      resetOllamaConnectionState();
                      updateSettings({ ollamaModel: e.currentTarget.value });
                    }}
                    placeholder="qwen3:8b"
                    size="md"
                  />
                }
              >
                <Select
                  class="setting-select"
                  value={settings.ollamaModel}
                  onChange={(e) => {
                    resetOllamaConnectionState();
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
              variant={ollamaConnected() === true ? 'success' : ollamaConnected() === false ? 'danger' : 'default'}
              onClick={handleTestOllama}
              disabled={ollamaTesting()}
              loading={ollamaTesting()}
              icon={ollamaConnected() === true ? 'check' : undefined}
            >
              {ollamaConnected() === true
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
            <Show
              when={settings.cloudAuthStatus === 'signed-in'}
              fallback={<ConnectionStatus status="disconnected" size="sm" />}
            >
              <span class="setting-value">
                {settings.cloudAuthUserEmail || (t('mlearn.Connection.Connected') || 'Connected')}
              </span>
            </Show>
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
                : cloudLLMStatus() === 'auth'
                  ? (t('mlearn.Connection.SignIn') || 'Sign in')
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

        <SettingGroup title={t('mlearn.AI.Settings.CloudTiers.Title')}>
          <SettingRow
            label={t('mlearn.AI.Settings.CloudTiers.Conversation.Label')}
            description={t('mlearn.AI.Settings.CloudTiers.Conversation.Description')}
          >
            <Select
              class="setting-select"
              value={settings.cloudLLMTierConversation}
              onChange={(e) => updateSettings({ cloudLLMTierConversation: e.currentTarget.value as 'cheap' | 'fast' })}
              options={[
                { value: 'cheap', label: t('mlearn.AI.Settings.CloudTiers.Cheap') },
                { value: 'fast', label: t('mlearn.AI.Settings.CloudTiers.Fast') },
              ]}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.AI.Settings.CloudTiers.Voice.Label')}
            description={t('mlearn.AI.Settings.CloudTiers.Voice.Description')}
          >
            <Select
              class="setting-select"
              value={settings.cloudLLMTierVoice}
              onChange={(e) => updateSettings({ cloudLLMTierVoice: e.currentTarget.value as 'cheap' | 'fast' })}
              options={[
                { value: 'cheap', label: t('mlearn.AI.Settings.CloudTiers.Cheap') },
                { value: 'fast', label: t('mlearn.AI.Settings.CloudTiers.Fast') },
              ]}
            />
          </SettingRow>

          <SettingRow
            label={t('mlearn.AI.Settings.CloudTiers.Explanation.Label')}
            description={t('mlearn.AI.Settings.CloudTiers.Explanation.Description')}
          >
            <Select
              class="setting-select"
              value={settings.cloudLLMTierExplanation}
              onChange={(e) => updateSettings({ cloudLLMTierExplanation: e.currentTarget.value as 'cheap' | 'fast' })}
              options={[
                { value: 'cheap', label: t('mlearn.AI.Settings.CloudTiers.Cheap') },
                { value: 'fast', label: t('mlearn.AI.Settings.CloudTiers.Fast') },
              ]}
            />
          </SettingRow>
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
      <SettingGroup title={t('mlearn.AI.Settings.Checker.Title')}>
        <SettingRow
          label={t('mlearn.AI.Settings.Checker.SecondPass.Label')}
          description={t('mlearn.AI.Settings.Checker.SecondPass.Description')}
        >
          <ToggleSwitch
            checked={settings.agentMistakeChecker || settings.agentSafetyChecker}
            onChange={() => {}}
            disabled
          />
        </SettingRow>
        <SettingRow
          label={t('mlearn.AI.Settings.Checker.Mistake.Label')}
          description={t('mlearn.AI.Settings.Checker.Mistake.Description')}
        >
          <ToggleSwitch
            checked={settings.agentMistakeChecker}
            onChange={(checked) => updateSettings({ agentMistakeChecker: checked })}
          />
        </SettingRow>
        <SettingRow
          label={t('mlearn.AI.Settings.Checker.Safety.Label')}
          description={t('mlearn.AI.Settings.Checker.Safety.Description')}
        >
          <ToggleSwitch
            checked={settings.agentSafetyChecker}
            onChange={(checked) => updateSettings({ agentSafetyChecker: checked })}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.AI.Settings.OCR.Title')}>
        <SettingRow
            label={t('mlearn.AI.Settings.OCR.Provider.Label')}
            description={t('mlearn.AI.Settings.OCR.Provider.Description')}
          settingKey="ocrProvider"
        >
          <Select
              class="setting-select"
              value={settings.ocrProvider ?? DEFAULT_SETTINGS.ocrProvider}
              onChange={(e) => updateSettings({ ocrProvider: e.currentTarget.value as OCRProvider })}
              options={[
                { value: 'local', label: t('mlearn.AI.Settings.OCR.Provider.Local') },
                { value: 'cloud', label: t('mlearn.AI.Settings.OCR.Provider.Cloud') },
              ]}
          />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t('mlearn.AI.Settings.Speech.Title')}>
        <SettingRow
          label={t('mlearn.AI.Settings.Speech.Label')}
          description={t('mlearn.AI.Settings.Speech.Description')}
        >
          <ToggleSwitch
            checked={settings.speechEnabled}
            onChange={(checked) => updateSettings({ speechEnabled: checked })}
          />
        </SettingRow>

        <Show when={settings.speechEnabled}>
          <SettingRow
            label={t('mlearn.AI.Settings.AutoSpeak.Label')}
            description={t('mlearn.AI.Settings.AutoSpeak.Description')}
          >
            <ToggleSwitch
              checked={settings.autoSpeak}
              onChange={(checked) => updateSettings({ autoSpeak: checked })}
            />
          </SettingRow>
        </Show>
      </SettingGroup>

    </TabContent>
  );
};
