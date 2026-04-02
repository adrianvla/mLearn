// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';

const translations: Record<string, string> = {
  'mlearn.ConversationAgent.Connection.Title': 'Connection',
  'mlearn.ConversationAgent.Connection.Hint': 'Configure the Ollama endpoint used by the chat.',
  'mlearn.ConversationAgent.Connection.ServerUrl': 'Server URL',
  'mlearn.ConversationAgent.Connection.ServerUrlHint': 'The Ollama server address.',
  'mlearn.ConversationAgent.Connection.Model': 'Model',
  'mlearn.ConversationAgent.Connection.ModelHint': 'The default model to use.',
  'mlearn.ConversationAgent.Connection.Testing': 'Testing',
  'mlearn.ConversationAgent.Connection.ConnectionSuccess': 'Connection success',
  'mlearn.ConversationAgent.Connection.ConnectionFailed': 'Connection failed',
  'mlearn.ConversationAgent.Connection.TestConnection': 'Test connection',
  'mlearn.ConversationAgent.Connection.Save': 'Save',
  'mlearn.ConversationAgent.Connection.Saved': 'Saved',
  'mlearn.ConversationAgent.Connection.AvailableModels': 'Available models',
  'mlearn.ConversationAgent.Connection.LoadingModels': 'Loading models',
  'mlearn.ConversationAgent.Connection.FetchModels': 'Fetch models',
  'mlearn.ConversationAgent.Connection.NoModelsFound': 'No models found',
};

let mockSettings: { ollamaUrl: string; ollamaModel: string };
const mockUpdateSetting = vi.fn<(key: string, value: string) => void>();
const mockOllamaCheck = vi.fn<() => Promise<boolean>>();
const mockOllamaListModels = vi.fn<() => Promise<unknown[]>>();

vi.mock('../../context', () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSetting: mockUpdateSetting,
  }),
  useLocalization: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('../../../shared/bridges', () => ({
  getBridge: () => ({
    llm: {
      ollamaCheck: mockOllamaCheck,
      ollamaListModels: mockOllamaListModels,
    },
  }),
}));

vi.mock('../../components/common', () => ({
  FormField: (props: { label?: string; hint?: string; children?: any }) => (
    <label>
      <span>{props.label}</span>
      <span>{props.hint}</span>
      {props.children}
    </label>
  ),
  Input: (props: Record<string, unknown>) => (
    <input
      value={props.value as string}
      onInput={props.onInput as (event: InputEvent) => void}
      placeholder={props.placeholder as string}
    />
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
  EmptyState: (props: { title?: string }) => <div>{props.title}</div>,
  TabHeader: (props: { title?: string; description?: string }) => (
    <div>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
    </div>
  ),
  Select: (props: Record<string, unknown>) => (
    <select
      value={props.value as string}
      onChange={props.onChange as (event: Event) => void}
    >
      {((props.options as Array<{ value: string; label: string }>) || []).map((option) => (
        <option value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ConnectionTab', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    mockSettings = {
      ollamaUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.2',
    };

    mockUpdateSetting.mockReset();
    mockUpdateSetting.mockImplementation((key, value) => {
      mockSettings = { ...mockSettings, [key]: value };
    });

    mockOllamaCheck.mockReset();
    mockOllamaCheck.mockResolvedValue(true);
    mockOllamaListModels.mockReset();
    mockOllamaListModels.mockResolvedValue([]);
  });

  afterEach(() => {
    container.remove();
  });

  async function renderConnectionTab() {
    const { ConnectionTab } = await import('./ConnectionTab');
    const dispose = render(() => <ConnectionTab />, container);
    await flushPromises();
    return { dispose };
  }

  it('keeps the test result visible until the form changes', async () => {
    const { dispose } = await renderConnectionTab();

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

  it('keeps the saved state visible until the form changes', async () => {
    const { dispose } = await renderConnectionTab();

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save'),
    );

    expect(saveButton).toBeTruthy();
    saveButton!.click();
    await flushPromises();

    expect(container.textContent).toContain('Saved');

    const modelInput = Array.from(container.querySelectorAll('input')).find((input) =>
      input.getAttribute('placeholder') === 'llama3.2',
    );

    expect(modelInput).toBeTruthy();
    modelInput!.value = 'qwen3:8b';
    modelInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    expect(container.textContent).toContain('Save');
    expect(container.textContent).not.toContain('Saved');

    dispose();
  });
});