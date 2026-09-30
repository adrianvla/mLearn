/**
 * AI Settings Tab
 * Configure AI provider (built-in vs Ollama), model download, and connection settings.
 */

import { Component, Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { useSettings, useLocalization } from '../../../context';
import { Button, SettingRow, SettingGroup, Select, Input, TabContent, HintText, ToggleSwitch, ConnectionStatus, BotIcon } from '../../../components/common';
import { getBridge } from '../../../../shared/bridges';
import { isElectron } from '../../../../shared/platform';
import type { LocalGuardStatus } from '../../../../shared/conversationReview';
import {
  probeProvider,
  providerTestLabel,
  providerTestVariant,
  type ProviderFailure,
} from '../../../services/providerFailure';
import { BUILTIN_MODELS, autoselectBuiltinModel, getModelUrl } from '../../../../shared/builtinModels';
import {
  DEFAULT_SETTINGS,
  type BuiltinModelConfig,
  type LLMProvider,
  type LLMModelStatus,
  type OCRProvider,
  type SystemMemoryInfo,
} from '../../../../shared/types';
import '../SettingsForm.css';
import './AITab.css';
import { getLogger } from '../../../../shared/utils/logger';

const log = getLogger("renderer.settings.ai");

export const AITab: Component = () => {
  const { settings, updateSettings, isLoading } = useSettings();
  const { t } = useLocalization();

  // Built-in model state
  const [modelStatus, setModelStatus] = createSignal<LLMModelStatus>({
    downloaded: false,
    runtimeAvailable: false,
    ready: false,
    downloading: false,
    progress: 0,
    downloadedBytes: 0,
    expectedBytes: 0,
    loaded: false,
  });

  // Ollama state
  //
  // Held as a classification for the same reason as the openai-compatible test
  // above: a boolean cannot distinguish "not tested" from "tested and failed",
  // which is why this section and that one disagreed about whether a failure
  // should change the button's wording. Both now read the same record.
  const [ollamaFailure, setOllamaFailure] = createSignal<ProviderFailure | null>(null);
  const [ollamaTested, setOllamaTested] = createSignal(false);
  const [ollamaTesting, setOllamaTesting] = createSignal(false);
  const [ollamaModels, setOllamaModels] = createSignal<string[]>([]);
  const [loadingModels, setLoadingModels] = createSignal(false);
  const [guardStatus, setGuardStatus] = createSignal<LocalGuardStatus>();
  const [guardInstalling, setGuardInstalling] = createSignal(false);
  const [guardError, setGuardError] = createSignal('');
  const refreshGuard = async (): Promise<void> => {
    try { setGuardStatus(await getBridge().world.getLocalGuardStatus()); setGuardError(''); }
    catch (failure) { setGuardError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const installGuard = async (): Promise<void> => {
    setGuardInstalling(true); setGuardError('');
    try { await getBridge().world.installLocalGuard(); await refreshGuard(); }
    catch (failure) { setGuardError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setGuardInstalling(false); }
  };

  // Cloud LLM state
  const [testingCloudLLM, setTestingCloudLLM] = createSignal(false);
  /**
   * The last cloud connection-test outcome, as a classification.
   *
   * The third private tri-state in this tab, and the only one that had grown a
   * fourth state ('auth') to say "sign in again" - which is exactly the
   * distinction the shared record already makes, and exactly the one the other
   * two sections could not make at all.
   */
  const [cloudLLMFailure, setCloudLLMFailure] = createSignal<ProviderFailure | null>(null);
  const [cloudLLMTested, setCloudLLMTested] = createSignal(false);
  /**
   * The last connection-test outcome, kept as a classification.
   *
   * This was a private `'idle' | 'success' | 'error'` tri-state, which can say
   * *that* the test failed but not *why*, and the button rendered no reason at
   * all - it just turned red and kept saying "Test connection". A rejected API
   * key, a model the endpoint does not serve and an unreachable host all looked
   * identical. `probeProvider` already decides which of those it is, so the
   * outcome is stored as the record it returns and the button labels itself
   * from it.
   */
  const [compatibleFailure, setCompatibleFailure] = createSignal<ProviderFailure | null>(null);
  const [compatibleTested, setCompatibleTested] = createSignal(false);
  const [testingCompatible, setTestingCompatible] = createSignal(false);

  const testCompatible = async () => {
    setTestingCompatible(true);
    try {
      const classified = await probeProvider({
        ...settings,
        // The test button is about the openai-compatible section it lives in,
        // so it probes that provider rather than whatever is selected.
        llmProvider: 'openai-compatible',
      });
      setCompatibleFailure(classified);
      setCompatibleTested(true);
    } finally {
      setTestingCompatible(false);
    }
  };

  // Autoselect state
  const [autoselectMsg, setAutoselectMsg] = createSignal<string | null>(null);
  const [autoselecting, setAutoselecting] = createSignal(false);

  // Downloaded models manager
  const [downloadedModels, setDownloadedModels] = createSignal<Array<{ modelFile: string; sizeBytes: number }>>([]);
  const [deletingModel, setDeletingModel] = createSignal<string | null>(null);
  const [deleteConfirmMsg, setDeleteConfirmMsg] = createSignal<string | null>(null);

  const resetCompatibleTest = () => {
    setCompatibleFailure(null);
    setCompatibleTested(false);
  };

  const isBuiltinModelReady = () => modelStatus().ready;

  const clearBuiltinStatusMessages = () => {
    setAutoselectMsg(null);
    setDeleteConfirmMsg(null);
  };

  const resetOllamaConnectionState = () => {
    setOllamaFailure(null);
    setOllamaTested(false);
  };

  // Check model status on mount
  createEffect(() => {
    if (!isLoading()) void checkModelStatus();
  });
  createEffect(() => { if (!isLoading() && isElectron()) void refreshGuard(); });

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
      setCloudLLMFailure(null);
      setCloudLLMTested(false);
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
    if (isLoading()) return;
    if (settings.llmProvider === 'builtin' && !settings.builtinModelAutoselected) {
      void runAutoselect();
    }
  });

  // Re-check model status whenever the selected model changes
  createEffect(() => {
    if (isLoading()) return;
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
    updateSettings({ llmProvider: provider });
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
      // Probed through the shared owner so a failure here is classified by the
      // same rules as a failure anywhere else, rather than this section
      // deciding on its own what "not connected" means.
      const classified = await probeProvider({ ...settings, llmProvider: 'ollama' });
      setOllamaFailure(classified);
      setOllamaTested(true);
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
    setCloudLLMFailure(null);
    setCloudLLMTested(false);
    try {
      // Probed through the shared owner, which also performs the session
      // recovery when the session is the thing that died. The old inline catch
      // called `handleCloudSessionError` itself - one more place that had to
      // remember to.
      const classified = await probeProvider({ ...settings, llmProvider: 'cloud' });
      setCloudLLMFailure(classified);
      setCloudLLMTested(true);
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

  function formatRunningMemory(minGb: number, maxGb: number): string {
    return minGb === maxGb ? `${minGb}` : `${minGb}–${maxGb}`;
  }

  function modelTierLabel(tier: BuiltinModelConfig['tier']): string {
    return t(`mlearn.AI.Settings.BuiltinModel.Tiers.${tier}`);
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
        <Show when={settings.llmProvider === 'builtin' || settings.llmProvider === 'ollama'}>
          <SettingRow
            label={t('mlearn.AI.Settings.Provider.EnableLocal.Label')}
            description={t('mlearn.AI.Settings.Provider.EnableLocal.Description')}
            settingKey="llmEnabled"
          >
            <ToggleSwitch checked={settings.llmEnabled} onChange={(checked) => updateSettings({ llmEnabled: checked })} />
          </SettingRow>
        </Show>
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
              { value: 'openai-compatible', label: t('mlearn.AI.Settings.Provider.OpenAICompatible') },
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
                options={BUILTIN_MODELS.map((m) => ({
                  value: m.modelFile,
                  label: `${modelTierLabel(m.tier)} — ${m.displayName}`,
                }))}
              />
              <Show when={getBridge().llm.llmGetSystemMemory}>
                <Button
                  size="sm"
                  onClick={() => void runAutoselect()}
                  disabled={autoselecting()}
                  loading={autoselecting()}
                >
                  Autoselect
                </Button>
              </Show>
            </div>
            <Show when={settings.builtinModel}>
              {(() => {
                const model = BUILTIN_MODELS.find((m) => m.modelFile === settings.builtinModel);
                return model ? (
                  <HintText>
                    {t('mlearn.AI.Settings.BuiltinModel.Details', {
                      quantization: model.quantization,
                      downloadSize: model.fileSizeGb,
                      runningFootprint: formatRunningMemory(model.estimatedMemoryGbMin, model.estimatedMemoryGbMax),
                      targetMemory: model.targetMemoryGb,
                    })}
                  </HintText>
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

              <Show when={!modelStatus().downloading && isBuiltinModelReady()}>
                <span class="ai-status-ok">{t('mlearn.AI.ModelReady')}</span>
                <Button size="sm" onClick={handleDownloadModel}>
                  {t('mlearn.AI.Settings.BuiltinModel.Redownload')}
                </Button>
              </Show>

              <Show when={!modelStatus().downloading && modelStatus().downloaded && !isBuiltinModelReady()}>
                <span class="ai-status-error">
                  {modelStatus().runtimeError ?? 'Built-in runtime unavailable'}
                </span>
              </Show>

              <Show when={!modelStatus().downloading && !modelStatus().downloaded}>
                <span class="ai-status-missing">{t('mlearn.AI.ModelNotDownloaded')}</span>
                <Button size="sm" variant="primary" onClick={handleDownloadModel}>
                  {t('mlearn.AI.DownloadModel')}
                </Button>
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
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void handleDeleteModel(item.modelFile)}
                      disabled={deletingModel() === item.modelFile}
                      loading={deletingModel() === item.modelFile}
                    >
                      Delete
                    </Button>
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
            <Button
              size="sm"
              variant={providerTestVariant(ollamaTested(), ollamaFailure())}
              onClick={handleTestOllama}
              disabled={ollamaTesting()}
              loading={ollamaTesting()}
              icon={ollamaTested() && !ollamaFailure() ? 'check' : undefined}
            >
              {providerTestLabel(ollamaTested(), ollamaFailure(), t,
                'mlearn.AI.Settings.OllamaConfig.ConnectionSuccess',
                'mlearn.AI.Settings.OllamaConfig.TestConnection')}
            </Button>
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

      <Show when={settings.llmProvider === 'openai-compatible'}>
        <SettingGroup title={t('mlearn.AI.Settings.CompatibleConfig.Title')}>
          <SettingRow label={t('mlearn.AI.Settings.CompatibleConfig.BaseUrl')} description="">
            <Input value={settings.compatibleApiBaseUrl} type="url" size="md"
              onInput={(event) => { resetCompatibleTest(); updateSettings({ compatibleApiBaseUrl: event.currentTarget.value }); }} />
          </SettingRow>
          <SettingRow label={t('mlearn.AI.Settings.CompatibleConfig.ApiKey')} description="">
            <Input value={settings.compatibleApiKey} type="password" autocomplete="off" size="md"
              onInput={(event) => { resetCompatibleTest(); updateSettings({ compatibleApiKey: event.currentTarget.value }); }} />
          </SettingRow>
          <SettingRow label={t('mlearn.AI.Settings.CompatibleConfig.Model')} description="">
            <Input value={settings.compatibleModel} size="md"
              onInput={(event) => { resetCompatibleTest(); updateSettings({ compatibleModel: event.currentTarget.value }); }} />
          </SettingRow>
          <SettingRow label="" description="">
            <Button size="sm"
              variant={providerTestVariant(compatibleTested(), compatibleFailure())}
              disabled={testingCompatible()} loading={testingCompatible()} onClick={() => void testCompatible()}>
              {providerTestLabel(compatibleTested(), compatibleFailure(), t,
                'mlearn.AI.Settings.CompatibleConfig.ConnectionSuccess',
                'mlearn.AI.Settings.CompatibleConfig.TestConnection')}
            </Button>
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
            <Button
              size="sm"
              variant={providerTestVariant(cloudLLMTested(), cloudLLMFailure())}
              onClick={handleTestCloudLLM}
              disabled={testingCloudLLM()}
              loading={testingCloudLLM()}
              icon={cloudLLMTested() && !cloudLLMFailure() ? 'check' : undefined}
            >
              {providerTestLabel(cloudLLMTested(), cloudLLMFailure(), t,
                'mlearn.AI.Settings.CloudConfig.ConnectionSuccess',
                'mlearn.AI.Settings.CloudConfig.TestConnection')}
            </Button>
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
              onChange={(e) => updateSettings({ cloudLLMTierConversation: e.currentTarget.value as 'standard' | 'realtime' })}
              options={[
                { value: 'standard', label: t('mlearn.AI.Settings.CloudTiers.Standard') },
                { value: 'realtime', label: t('mlearn.AI.Settings.CloudTiers.Realtime') },
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
              onChange={(e) => updateSettings({ cloudLLMTierVoice: e.currentTarget.value as 'standard' | 'realtime' })}
              options={[
                { value: 'standard', label: t('mlearn.AI.Settings.CloudTiers.Standard') },
                { value: 'realtime', label: t('mlearn.AI.Settings.CloudTiers.Realtime') },
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
              onChange={(e) => updateSettings({ cloudLLMTierExplanation: e.currentTarget.value as 'standard' | 'realtime' })}
              options={[
                { value: 'standard', label: t('mlearn.AI.Settings.CloudTiers.Standard') },
                { value: 'realtime', label: t('mlearn.AI.Settings.CloudTiers.Realtime') },
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
      </SettingGroup>

      {/* Checker Agent */}
      <Show when={isElectron()}><SettingGroup title={t('mlearn.AI.Settings.Boundary.Title')}>
        <SettingRow label={t('mlearn.AI.Settings.Boundary.Provider')} description={t('mlearn.AI.Settings.Boundary.Description')}>
          <Select value={settings.conversationGuardProvider ?? DEFAULT_SETTINGS.conversationGuardProvider}
            onChange={event => updateSettings({ conversationGuardProvider: event.currentTarget.value as 'actor' | 'local' })}
            options={[{ value: 'actor', label: t('mlearn.AI.Settings.Boundary.Actor') },
              { value: 'local', label: t('mlearn.AI.Settings.Boundary.Local') }]} />
        </SettingRow>
        <Show when={(settings.conversationGuardProvider ?? DEFAULT_SETTINGS.conversationGuardProvider) === 'local'}>
          <SettingRow label={guardStatus()?.model ?? t('mlearn.AI.Settings.Boundary.Local')} description={t('mlearn.AI.Settings.Boundary.LocalDescription')}>
            <Show when={guardStatus()?.verified} fallback={<Button loading={guardInstalling()} onClick={() => { void installGuard(); }}>{t('mlearn.AI.Settings.Boundary.Install')}</Button>}>
              <HintText>{t('mlearn.AI.Settings.Boundary.Installed')}</HintText>
            </Show>
          </SettingRow>
          <Show when={guardError()}><HintText>{guardError()}</HintText></Show>
        </Show>
      </SettingGroup></Show>
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
