// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';

const translations: Record<string, string> = {
  'mlearn.AI.Settings.Title': 'AI',
  'mlearn.AI.Settings.Description': 'Configure AI providers.',
  'mlearn.AI.Settings.Provider.Title': 'Provider',
  'mlearn.AI.Settings.Provider.Description': 'Choose the LLM provider.',
  'mlearn.AI.Settings.Provider.Builtin': 'Built-in',
  'mlearn.AI.Settings.Provider.Ollama': 'Ollama',
  'mlearn.AI.Settings.Provider.Cloud': 'Cloud',
  'mlearn.AI.Settings.BuiltinModel.Title': 'Built-in model',
  'mlearn.AI.Settings.BuiltinModel.ModelName': 'Model',
  'mlearn.AI.Settings.BuiltinModel.Status': 'Status',
  'mlearn.AI.Settings.BuiltinModel.Redownload': 'Redownload',
  'mlearn.AI.Settings.BuiltinModel.Details': '{quantization} · ~{downloadSize} GB download · ~{runningFootprint} GB running · {targetMemory} GB+ system memory',
  'mlearn.AI.Settings.BuiltinModel.Tiers.Lite': 'Lite',
  'mlearn.AI.Settings.BuiltinModel.Tiers.Recommended': 'Recommended',
  'mlearn.AI.ModelReady': 'Model ready',
  'mlearn.AI.ModelNotDownloaded': 'Model not downloaded',
  'mlearn.AI.DownloadModel': 'Download model',
  'mlearn.AI.Settings.OllamaConfig.Title': 'Ollama',
  'mlearn.AI.Settings.OllamaConfig.ServerUrl': 'Server URL',
  'mlearn.AI.Settings.OllamaConfig.ServerUrlHint': 'The Ollama server address.',
  'mlearn.AI.Settings.OllamaConfig.Model': 'Model',
  'mlearn.AI.Settings.OllamaConfig.ModelHint': 'Choose an Ollama model.',
  'mlearn.AI.Settings.OllamaConfig.LoadingModels': 'Loading models',
  'mlearn.AI.Settings.OllamaConfig.TestConnection': 'Test connection',
  'mlearn.AI.Settings.OllamaConfig.ConnectionSuccess': 'Connection success',
  'mlearn.Connection.Unreachable': 'Unreachable',
  'mlearn.AI.Settings.OllamaConfig.InstallHintPrefix': 'Install Ollama from',
  'mlearn.AI.Settings.OllamaConfig.InstallHintSuffix': 'to use a local server.',
  'mlearn.AI.OllamaInstallGuide': 'the Ollama guide',
  'mlearn.AI.OllamaInstallGuideUrl': 'https://ollama.com/',
  'mlearn.AI.Settings.CloudConfig.Title': 'Cloud',
  'mlearn.Connection.AuthStatus': 'Cloud account',
  'mlearn.AI.Settings.CloudConfig.TokenHint': 'Sign in through the connection settings.',
  'mlearn.Connection.Connected': 'Connected',
  'mlearn.AI.Settings.CloudConfig.TestConnection': 'Test cloud connection',
  'mlearn.AI.Settings.CloudConfig.ConnectionSuccess': 'Cloud connection success',
  'mlearn.AI.Settings.CloudConfig.ApiUrlHint': 'Cloud requests use the configured API endpoint.',
  'mlearn.AI.Settings.AgentMemory.Title': 'Agent memory',
  'mlearn.AI.Settings.AgentMemory.Enable.Label': 'Enable memory',
  'mlearn.AI.Settings.AgentMemory.Enable.Description': 'Allow the tutor to store memories.',
  'mlearn.AI.Settings.AgentMemory.Shared.Label': 'Shared memory',
  'mlearn.AI.Settings.AgentMemory.Shared.Description': 'Share memories across agents.',
  'mlearn.AI.Settings.Checker.Title': 'Checker Agent',
  'mlearn.AI.Settings.Checker.SecondPass.Label': 'Second pass enabled',
  'mlearn.AI.Settings.Checker.SecondPass.Description': 'A separate LLM pass runs when at least one checker feature is active.',
  'mlearn.AI.Settings.Checker.Mistake.Label': 'Mistake checker',
  'mlearn.AI.Settings.Checker.Mistake.Description': 'Use a second pass to detect and correct mistakes.',
  'mlearn.AI.Settings.Checker.Safety.Label': 'Safety agent',
  'mlearn.AI.Settings.Checker.Safety.Description': 'Use a second pass to detect safety risks.',
  'mlearn.AI.Settings.OCR.Title': 'OCR',
  'mlearn.AI.Settings.OCR.Provider.Label': 'OCR provider',
  'mlearn.AI.Settings.OCR.Provider.Description': 'Choose the OCR backend.',
  'mlearn.AI.Settings.OCR.Provider.Local': 'Local',
  'mlearn.AI.Settings.OCR.Provider.Cloud': 'Cloud',
};

const builtinModels = [
  {
    modelFile: 'small.gguf',
    tier: 'Lite',
    displayName: 'Small Model',
    quantization: 'Official QAT Q4_0',
    fileSizeGb: 1,
    estimatedMemoryGbMin: 3,
    estimatedMemoryGbMax: 4,
    targetMemoryGb: 8,
  },
  {
    modelFile: 'large.gguf',
    tier: 'Recommended',
    displayName: 'Large Model',
    quantization: 'Official QAT Q4_0',
    fileSizeGb: 4,
    estimatedMemoryGbMin: 6,
    estimatedMemoryGbMax: 8,
    targetMemoryGb: 16,
  },
];

type TestSettings = {
  llmProvider: 'builtin' | 'ollama' | 'cloud';
  builtinModel: string;
  builtinModelAutoselected: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  cloudAuthAccessToken: string;
  cloudAuthToken: string;
  cloudAuthStatus: string;
  cloudAuthUserEmail: string;
  agentMemoryEnabled: boolean;
  agentMemoryShared: boolean;
  agentMistakeChecker: boolean;
  agentSafetyChecker: boolean;
  ocrProvider: 'local' | 'cloud';
  cloudApiUrl: string;
  overrideCloudEndpointUrl: boolean;
};

let settingsStore: TestSettings;
let setSettingsStore: ((partial: Partial<TestSettings>) => void) | null = null;
const mockUpdateSettings = vi.fn<(partial: Partial<TestSettings>) => void>();
const mockLlmCheckModel = vi.fn<() => Promise<Record<string, unknown>>>();
const mockOnLLMDownloadProgress = vi.fn(() => () => undefined);
const mockOnLLMModelStatus = vi.fn(() => () => undefined);
const mockLlmGetSystemMemory = vi.fn<() => Promise<Record<string, unknown>>>();
const mockLlmListDownloadedModels = vi.fn<() => Promise<Array<{ modelFile: string; sizeBytes: number }>>>();
const mockLlmDeleteModel = vi.fn<(modelFile: string) => Promise<void>>();
const mockLlmUnloadModel = vi.fn<() => void>();
const mockLlmDownloadModel = vi.fn<(url: string, modelFile: string) => void>();
const mockOllamaCheck = vi.fn<() => Promise<boolean>>();
const mockOllamaListModels = vi.fn<() => Promise<string[]>>();
const mockAutoselectBuiltinModel = vi.fn<(memoryInfo: unknown) => (typeof builtinModels)[number]>((_) => builtinModels[1]);
const mockResolveCloudApiUrl = vi.fn<(settings: unknown) => string>((_) => 'https://cloud.example.com');
const mockCloudCheckAvailability = vi.fn<() => Promise<boolean>>();
const mockEnsureCloudAccessToken = vi.fn<() => Promise<string | null>>();
const mockHandleCloudSessionError = vi.fn<(error: unknown, openModal?: boolean) => boolean>();

vi.mock('../../../context', () => ({
  useSettings: () => ({
    settings: settingsStore,
    updateSettings: mockUpdateSettings,
  }),
  useLocalization: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      let value = translations[key] ?? key;
      for (const [param, replacement] of Object.entries(params ?? {})) {
        value = value.replaceAll(`{${param}}`, String(replacement));
      }
      return value;
    },
  }),
}));

vi.mock('../../../../shared/bridges', () => ({
  getBridge: () => ({
    llm: {
      llmCheckModel: mockLlmCheckModel,
      onLLMDownloadProgress: mockOnLLMDownloadProgress,
      onLLMModelStatus: mockOnLLMModelStatus,
      llmGetSystemMemory: mockLlmGetSystemMemory,
      llmListDownloadedModels: mockLlmListDownloadedModels,
      llmDeleteModel: mockLlmDeleteModel,
      llmUnloadModel: mockLlmUnloadModel,
      llmDownloadModel: mockLlmDownloadModel,
      ollamaCheck: mockOllamaCheck,
      ollamaListModels: mockOllamaListModels,
    },
  }),
}));

vi.mock('../../../../shared/backends', () => ({
  resolveCloudApiUrl: (settings: unknown) => mockResolveCloudApiUrl(settings),
}));

vi.mock('../../../../shared/backends/cloudLLMAdapter', () => ({
  CloudLLMAdapter: vi.fn().mockImplementation(() => ({
    checkAvailability: mockCloudCheckAvailability,
  })),
}));

vi.mock('../../../services/cloudSessionManager', () => ({
  ensureCloudAccessToken: () => mockEnsureCloudAccessToken(),
  handleCloudSessionError: (error: unknown, openModal?: boolean) => mockHandleCloudSessionError(error, openModal),
}));

vi.mock('../../../../shared/builtinModels', () => ({
  BUILTIN_MODELS: builtinModels,
  autoselectBuiltinModel: (memoryInfo: unknown) => mockAutoselectBuiltinModel(memoryInfo),
  getModelUrl: () => 'https://example.com/models/selected.gguf',
}));

vi.mock('../../../components/common', () => ({
  SettingRow: (props: { label?: string; description?: string; children?: any }) => (
    <div>
      <div>{props.label}</div>
      <div>{props.description}</div>
      {props.children}
    </div>
  ),
  SettingGroup: (props: { title?: string; children?: any }) => (
    <section>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  ),
  Btn: (props: Record<string, unknown>) => (
    <button
      type="button"
      disabled={props.disabled as boolean | undefined}
      data-variant={props.variant as string | undefined}
      onClick={props.onClick as (event: MouseEvent) => void}
    >
      {props.children as any}
    </button>
  ),
  Select: (props: Record<string, unknown>) => (
    <select
      class={props.class as string | undefined}
      value={props.value as string}
      onChange={props.onChange as (event: Event) => void}
    >
      {((props.options as Array<{ value: string; label: string }>) || []).map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
  Input: (props: Record<string, unknown>) => (
    <input
      value={props.value as string}
      onInput={props.onInput as (event: InputEvent) => void}
      placeholder={props.placeholder as string}
    />
  ),
  TabContent: (props: { header?: { title?: string; description?: string }; children?: any }) => (
    <div>
      <h1>{props.header?.title}</h1>
      <p>{props.header?.description}</p>
      {props.children}
    </div>
  ),
  HintText: (props: { children?: any }) => <div>{props.children as any}</div>,
  ToggleSwitch: (props: Record<string, unknown>) => (
    <input type="checkbox" checked={props.checked as boolean} onChange={() => undefined} />
  ),
  ConnectionStatus: (props: { status?: string }) => <div>{props.status}</div>,
  BotIcon: () => <span>bot</span>,
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('AITab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    const [store, setStore] = createStore<TestSettings>({
      llmProvider: 'builtin',
      builtinModel: 'small.gguf',
      builtinModelAutoselected: true,
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
      cloudAuthAccessToken: '',
      cloudAuthToken: '',
      cloudAuthStatus: 'signed-out',
      cloudAuthUserEmail: '',
      agentMemoryEnabled: true,
      agentMemoryShared: false,
      agentMistakeChecker: false,
      agentSafetyChecker: false,
      ocrProvider: 'local',
      cloudApiUrl: 'https://cloud.example.com',
      overrideCloudEndpointUrl: false,
    });

    settingsStore = store;
    setSettingsStore = (partial) => setStore(partial);

    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockImplementation((partial) => {
      setSettingsStore?.(partial);
    });

    mockLlmCheckModel.mockReset();
    mockLlmCheckModel.mockResolvedValue({
      downloaded: false,
      downloading: false,
      progress: 0,
      downloadedBytes: 0,
      expectedBytes: 0,
      loaded: false,
    });
    mockOnLLMDownloadProgress.mockClear();
    mockOnLLMModelStatus.mockClear();
    mockLlmGetSystemMemory.mockReset();
    mockLlmGetSystemMemory.mockResolvedValue({
      hasDiscreteGpu: false,
      totalRamBytes: 8 * 1024 ** 3,
      dedicatedVramBytes: 0,
    });
    mockLlmListDownloadedModels.mockReset();
    mockLlmListDownloadedModels.mockResolvedValue([]);
    mockLlmDeleteModel.mockReset();
    mockLlmDeleteModel.mockResolvedValue();
    mockLlmUnloadModel.mockReset();
    mockLlmDownloadModel.mockReset();
    mockOllamaCheck.mockReset();
    mockOllamaCheck.mockResolvedValue(true);
    mockOllamaListModels.mockReset();
    mockOllamaListModels.mockResolvedValue(['llama3.2']);
    mockAutoselectBuiltinModel.mockClear();
    mockResolveCloudApiUrl.mockClear();
    mockCloudCheckAvailability.mockReset();
    mockCloudCheckAvailability.mockResolvedValue(true);
    mockEnsureCloudAccessToken.mockReset();
    mockEnsureCloudAccessToken.mockResolvedValue('cloud-access-token');
    mockHandleCloudSessionError.mockReset();
    mockHandleCloudSessionError.mockReturnValue(false);
  });

  afterEach(() => {
    container.remove();
  });

  async function renderAITab() {
    const { AITab } = await import('./AITab');
    const dispose = render(() => <AITab />, container);
    await flushPromises();
    return { dispose };
  }

  it('keeps the Ollama success state visible until the server URL changes', async () => {
    setSettingsStore?.({ llmProvider: 'ollama' });
    const { dispose } = await renderAITab();
    await flushPromises();

    const testButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Test connection'),
    );

    expect(testButton).toBeTruthy();
    testButton!.click();
    await flushPromises();

    expect(mockOllamaCheck).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Connection success');

    const serverInput = Array.from(container.querySelectorAll('input')).find((input) =>
      input.getAttribute('placeholder') === 'http://localhost:11434',
    );

    expect(serverInput).toBeTruthy();
    serverInput!.value = 'http://127.0.0.1:11434';
    serverInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    expect(container.textContent).toContain('Test connection');
    expect(container.textContent).not.toContain('Connection success');

    dispose();
  });

  it('keeps the autoselect message visible until the built-in model changes', async () => {
    setSettingsStore?.({
      llmProvider: 'builtin',
      builtinModelAutoselected: false,
      builtinModel: 'small.gguf',
    });

    const { dispose } = await renderAITab();
    await flushPromises();

    expect(container.textContent).toContain('Detected 8 GB unified memory');

    const modelSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.querySelectorAll('option')).some((option) => option.textContent?.includes('Large Model')),
    );

    expect(modelSelect).toBeTruthy();
    modelSelect!.value = 'small.gguf';
    modelSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(container.textContent).not.toContain('Detected 8 GB unified memory');

    dispose();
  });

  it('shows model tiers, quantization, download size, and memory guidance', async () => {
    const { dispose } = await renderAITab();

    expect(container.textContent).toContain('Lite — Small Model');
    expect(container.textContent).toContain('Recommended — Large Model');
    expect(container.textContent).toContain('Official QAT Q4_0 · ~1 GB download · ~3–4 GB running · 8 GB+ system memory');

    dispose();
  });

  it('shows sign in when cloud testing has no valid session', async () => {
    setSettingsStore?.({
      llmProvider: 'cloud',
      cloudAuthStatus: 'signed-out',
    });
    mockEnsureCloudAccessToken.mockResolvedValueOnce(null);

    const { dispose } = await renderAITab();

    const testButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Test cloud connection'),
    );

    expect(testButton).toBeTruthy();
    testButton!.click();
    await flushPromises();

    expect(mockEnsureCloudAccessToken).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Sign in');

    dispose();
  });

  it('shows sign in when cloud testing hits an auth error', async () => {
    setSettingsStore?.({
      llmProvider: 'cloud',
      cloudAuthStatus: 'signed-in',
      cloudAuthAccessToken: 'cloud-access-token',
    });
    mockCloudCheckAvailability.mockRejectedValueOnce(new Error('401 unauthorized'));
    mockHandleCloudSessionError.mockReturnValueOnce(true);

    const { dispose } = await renderAITab();

    const testButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Test cloud connection'),
    );

    expect(testButton).toBeTruthy();
    testButton!.click();
    await flushPromises();

    expect(mockHandleCloudSessionError).toHaveBeenCalledWith(expect.any(Error), true);
    expect(container.textContent).toContain('Sign in');

    dispose();
  });
});
